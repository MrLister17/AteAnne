"use client";

import { useEffect, useRef } from "react";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/ui";
import { php, phpAbs } from "../format";
import { useEvent, View } from "./EventContext";

type Share = { memberId: string; lines: Record<string, string>; discountTotal: string; chargeTotal: string; total: string };
type ReceiptFacts = { id: string; label: string; lines: { id: string; label: string; quantity: number; mode: string }[] };

/** One person's items and totals, from the frozen statement when there is one, else the live split. */
function shareRows(view: View, memberId: string) {
  const frozen = view.settlement?.facts as { receipts: (ReceiptFacts & { shares: Share[] })[] } | undefined;
  const receipts: (ReceiptFacts & { shares: Share[] })[] = frozen
    ? frozen.receipts
    : view.calculation.ok
      ? view.receipts.map((r) => ({ id: r.id, label: r.label, lines: r.lines, shares: (view.calculation.receipts.find((x) => x.receiptId === r.id)?.shares ?? []) as Share[] }))
      : [];
  return receipts
    .map((r) => {
      const s = r.shares.find((x) => x.memberId === memberId);
      if (!s || s.total === "0") return null;
      const items = r.lines.filter((l) => s.lines[l.id] && s.lines[l.id] !== "0").map((l) => ({ label: l.label, amount: s.lines[l.id] }));
      return { id: r.id, label: r.label, items, discount: s.discountTotal, charges: s.chargeTotal, total: s.total };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * A big, simple screen to SHOW someone what they owe or are owed: large
 * type, one headline amount, English with Tagalog underneath, no buttons to
 * press by mistake. Made for people without a phone, people not used to
 * apps, and lolas reading without their glasses. All numbers are the
 * server's; nothing is calculated here.
 */
export function PersonScreen({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const { view, name, seq } = useEvent();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const person = view.members.find((m) => m.id === memberId);
  if (!person) return null;

  const s = view.settlement;
  const pos = s?.positions.find((p) => p.memberId === memberId) ?? (view.calculation.ok ? view.calculation.positions.find((p) => p.memberId === memberId) : undefined);
  const pays = s ? s.edges.filter((e) => e.from === memberId) : [];
  const gets = s ? s.edges.filter((e) => e.to === memberId) : [];
  const rows = shareRows(view, memberId);
  const done = view.event.phase === "DONE";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={`${person.displayName}’s amount`}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-bg p-0 text-ink"
      data-testid="person-screen"
    >
      <div className="flex h-full flex-col">
        <header className="safe-top border-b border-line">
          <div className="mx-auto flex max-w-[520px] items-center gap-2 px-2 py-1">
            <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center gap-1 rounded-2xl px-3 text-[17px] font-semibold text-violet active:bg-violet-soft">
              <Icon name="back" /> Close
            </button>
            <p className="ml-auto truncate pr-2 text-[14px] text-muted">{view.event.title}</p>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[520px] flex-1 overflow-y-auto px-5 pt-6 pb-10">
          <div className="flex items-center gap-4">
            <Avatar name={person.displayName} seq={person.seq} size={64} />
            <div className="min-w-0">
              <p className="text-[15px] text-muted">For / Para kay</p>
              <h2 className="text-[32px] leading-tight font-bold break-words">{person.displayName}</h2>
            </div>
          </div>

          {s ? (
            <div className="mt-8 space-y-4">
              {pays.map((e) => (
                <Big
                  key={e.id}
                  tone={e.settled ? "done" : "pay"}
                  title={e.settled ? `Paid ${name(e.to)}` : `Pay ${name(e.to)}`}
                  tagalog={e.settled ? `Bayad na kay ${name(e.to)}` : `Babayaran mo si ${name(e.to)}`}
                  amount={e.settled ? e.amount : e.outstanding}
                  note={e.settled ? "Confirmed received ✓" : BigInt(e.verified) > 0n ? `${php(e.verified)} already received · ${php(e.amount)} in all` : BigInt(e.pending) > 0n ? `${php(e.pending)} sent, waiting for ${name(e.to)} to confirm` : undefined}
                  avatar={{ name: name(e.to), seq: seq(e.to) }}
                />
              ))}
              {gets.map((e) => (
                <Big
                  key={e.id}
                  tone={e.settled ? "done" : "receive"}
                  title={e.settled ? `Got it from ${name(e.from)}` : `${name(e.from)} pays you`}
                  tagalog={e.settled ? `Natanggap na mula kay ${name(e.from)}` : `Babayaran ka ni ${name(e.from)}`}
                  amount={e.settled ? e.amount : e.outstanding}
                  note={e.settled ? "Confirmed received ✓" : BigInt(e.pending) > 0n ? `${php(e.pending)} sent, check it arrived` : undefined}
                  avatar={{ name: name(e.from), seq: seq(e.from) }}
                />
              ))}
              {pays.length === 0 && gets.length === 0 && <Big tone="done" title="Nothing to pay" tagalog="Wala kang babayaran" amount="0" note="Your share was covered by what you paid." />}
              {done && <p className="text-center text-[17px] font-semibold text-receive">All settled · Tapos na ang hatian</p>}
            </div>
          ) : pos ? (
            <div className="mt-8 space-y-4">
              <Big tone="neutral" title="Your share so far" tagalog="Ang parte mo sa ngayon" amount={pos.cost} note="Not final yet — everyone still has to agree. / Hindi pa ito pinal." />
              {BigInt(pos.funding) > 0n && <Line label="You paid the store / Binayaran mo sa tindahan" value={php(pos.funding)} />}
              {BigInt(pos.funding) > 0n && (
                <Line
                  label={BigInt(pos.net) >= 0n ? "So you get back / Kaya ibabalik sa iyo" : "So you still pay / Kaya babayaran mo pa"}
                  value={phpAbs(pos.net)}
                  strong
                />
              )}
            </div>
          ) : (
            <p className="mt-8 text-[20px] text-muted">Nothing to show yet. Your amount appears once the items are claimed. / Wala pa. Lalabas ito kapag na-claim na ang mga item.</p>
          )}

          {rows.length > 0 && (
            <section className="mt-10">
              <h3 className="text-[20px] font-bold">What you had</h3>
              <p className="text-[15px] text-muted">Mga kinain o ginamit mo</p>
              <ul className="mt-3 space-y-4">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-line p-4">
                    <p className="text-[15px] font-semibold text-muted">{r.label}</p>
                    <ul className="mt-2 space-y-2">
                      {r.items.map((it, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-3 text-[19px]">
                          <span className="min-w-0 break-words">{it.label}</span>
                          <span className="tnum shrink-0 font-semibold">{php(it.amount)}</span>
                        </li>
                      ))}
                      {r.discount !== "0" && (
                        <li className="flex items-baseline justify-between gap-3 text-[17px] text-receive">
                          <span>Discount / Diskwento</span>
                          <span className="tnum shrink-0">−{php(r.discount)}</span>
                        </li>
                      )}
                      {r.charges !== "0" && (
                        <li className="flex items-baseline justify-between gap-3 text-[17px] text-muted">
                          <span>Service charge / Serbisyo</span>
                          <span className="tnum shrink-0">+{php(r.charges)}</span>
                        </li>
                      )}
                    </ul>
                    <p className="mt-3 flex items-baseline justify-between border-t border-line pt-2 text-[19px] font-bold">
                      <span>Your part</span>
                      <span className="tnum">{php(r.total)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button type="button" onClick={onClose} className="mt-10 min-h-14 w-full rounded-2xl bg-violet text-[18px] font-semibold text-violet-ink active:opacity-90">
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Big({ tone, title, tagalog, amount, note, avatar }: { tone: "pay" | "receive" | "done" | "neutral"; title: string; tagalog: string; amount: string; note?: string; avatar?: { name: string; seq: number } }) {
  const tones = {
    pay: "bg-pay-soft text-pay",
    receive: "bg-receive-soft text-receive",
    done: "bg-surface-2 text-receive",
    neutral: "bg-violet-soft text-violet",
  }[tone];
  return (
    <div className={`rounded-3xl p-5 ${tones}`}>
      <div className="flex items-center gap-3">
        {avatar && <Avatar name={avatar.name} seq={avatar.seq} size={44} />}
        <div className="min-w-0">
          <p className="text-[22px] leading-tight font-bold text-ink">{title}</p>
          <p className="text-[16px] text-muted">{tagalog}</p>
        </div>
      </div>
      <p className="tnum mt-3 text-[clamp(32px,11vw,48px)] leading-none font-extrabold" data-testid="person-amount">
        {php(amount)}
      </p>
      {note && <p className="mt-2 text-[16px] text-ink">{note}</p>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex items-baseline justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-[18px] ${strong ? "font-bold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="tnum shrink-0">{value}</span>
    </p>
  );
}
