"use client";

import { useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ActionError, Avatar, Badge, Button, Card, Disclosure, Notice } from "../components/ui";
import { ExchangeRate } from "@/domain/fx/ExchangeRate";
import { ReceiptView, useEvent, useInlineAction } from "./EventContext";
import { EqualReceiptSplit } from "@/domain/receipt/EqualReceiptSplit";
import { everyoneAnswered } from "./todo";
import { namesList } from "./next";
import { NextCard } from "./NextCard";

/**
 * Allocation wizard: one receipt at a time, the person claims only their
 * OWN items (shared-equal tick or whole pieces) or explicitly says they got
 * nothing. Unanswered is never treated as zero. Once you've answered, the
 * receipt folds into a short summary and the "Next for you" card says what
 * comes next (D53); the items stay one tap away behind "See items".
 */
export function ClaimTab() {
  const { view, me, event, focus } = useEvent();
  const [index, setIndex] = useState(() => {
    // Opened from a Next card at a specific receipt; otherwise the first one you haven't answered.
    const focused = focus?.receiptId ? view.receipts.findIndex((r) => r.id === focus.receiptId) : -1;
    if (focused >= 0) return focused;
    const first = view.receipts.findIndex((r) => !myAck(r, me.memberId));
    return first >= 0 ? first : 0;
  });
  // Opened from a Next card at a specific receipt.
  const [seenFocus, setSeenFocus] = useState(focus?.seq ?? 0);
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    const i = focus.receiptId ? view.receipts.findIndex((r) => r.id === focus.receiptId) : -1;
    if (i >= 0 && i !== index) setIndex(i);
  }
  // After a save, move straight on to the next receipt you still need to answer, if there is one.
  const [advance, setAdvance] = useState(false);
  if (advance) {
    setAdvance(false);
    const n = view.next;
    const target = n.kind === "claim" || n.kind === "recheck" ? view.receipts.findIndex((r) => r.id === n.receiptId) : -1;
    if (target >= 0 && target !== index) setIndex(target);
  }

  if (!view.receipts.length) return <EmptyState />;

  const r = view.receipts[Math.min(index, view.receipts.length - 1)];
  const done = view.receipts.filter((x) => myAck(x, me.memberId)).length;

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h2 className="text-[22px] font-bold">What did you have?</h2>
        <p className="text-[14px] text-muted">
          {done} of {view.receipts.length} receipts answered
        </p>
      </div>
      <nav aria-label="Receipts" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {view.receipts.map((x, i) => {
          const ack = myAck(x, me.memberId);
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? "true" : undefined}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold ${i === index ? "border-violet bg-violet-soft text-violet" : "border-line bg-surface"}`}
            >
              {ack ? <Icon name="check" size={16} className="text-receive" label="answered" /> : <span className="size-2 rounded-full bg-coral" aria-label="not answered" />}
              {x.label}
            </button>
          );
        })}
      </nav>
      <ReceiptClaimer key={`${r.id}-${r.version}-${view.me.claimVersion}`} receipt={r} readOnly={!(event.phase === "COLLECTING" || event.phase === "ALLOCATING") || event.cancelled} onSaved={() => setAdvance(true)} />
    </div>
  );
}

function myAck(r: ReceiptView, memberId: string) {
  const a = r.acks.find((x) => x.memberId === memberId);
  return a && a.kind && !a.stale ? a.kind : null;
}

function ReceiptClaimer({ receipt: r, readOnly, onSaved }: { receipt: ReceiptView; readOnly: boolean; onSaved: () => void }) {
  const { view, me, event, name, seq, money } = useEvent();
  const php = (v: string | bigint) => money(v, r.currency);
  const { run, error } = useInlineAction();
  const initial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of r.lines) {
      const mine = l.claims.find((c) => c.memberId === me.memberId);
      if (mine) m[l.id] = mine.units; // includes stale drafts so you can re-confirm quickly
    }
    return m;
  }, [r, me.memberId]);
  const [draft, setDraft] = useState<Record<string, number>>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const ack = myAck(r, me.memberId);
  const staleDraft = r.lines.some((l) => l.claims.some((c) => c.memberId === me.memberId && c.stale));
  const dirty = JSON.stringify(draft) !== JSON.stringify(Object.fromEntries(Object.entries(initial).filter(([, v]) => v > 0)));
  const active = view.members.filter((m) => m.active);
  const answered = active.filter((m) => r.acks.some((a) => a.memberId === m.id && a.kind && !a.stale));
  const agreed = active.filter((m) => r.acks.some((a) => a.memberId === m.id && a.kind === "FINISHED" && !a.stale));
  const notYet = active.filter((m) => !answered.includes(m)).map((m) => m.id);
  const waitingFor = notYet.filter((id) => id !== me.memberId);
  const waitingSummary = waitingFor.length <= 1 ? ` · waiting for ${namesList(waitingFor, name) || "you"}` : "";
  const equalShare = r.equalSplit ? (new EqualReceiptSplit().totals(BigInt(r.payable), active.map((m) => m.id)).get(me.memberId) ?? 0n) : null;
  const itemShare = !r.equalSplit && view.calculation.ok && everyoneAnswered(view, r.id) ? view.calculation.receipts.find((x) => x.receiptId === r.id)?.shares.find((s) => s.memberId === me.memberId)?.total : null;
  const share = equalShare ?? (itemShare ? BigInt(itemShare) : null);
  // The same share in the settle-up currency: exact once the split calculates, else "≈" at the receipt's rate.
  const settleExact = r.currency !== event.currency && view.calculation.ok ? view.calculation.receipts.find((x) => x.receiptId === r.id)?.settleShares[me.memberId] : undefined;
  const settleShare = r.currency === event.currency || share === null ? null : settleExact !== undefined ? money(settleExact) : r.rate ? `≈ ${money(ExchangeRate.fromWire(r.rate).convert(share))}` : null;
  const joiningOpen = event.phase === "COLLECTING" && !event.rosterLockedAt;
  const folded = Boolean(ack) && !staleDraft && !dirty;

  const save = async (status: "finish" | "none" | "draft") => {
    setBusy(status);
    const claims = status === "none" ? [] : Object.entries(draft).filter(([, u]) => u > 0).map(([lineId, units]) => ({ lineId, units }));
    const success =
      status === "none" ? (r.equalSplit ? "Saved. Tell the organizer what needs changing." : `Saved: nothing from ${r.label}`) : status === "finish" ? (r.equalSplit ? "Share confirmed" : "Items saved") : "Draft saved";
    const res = await run(
      () => api.put(`/api/receipts/${r.id}/claims`, { receiptVersion: r.version, expectedClaimVersion: view.me.claimVersion, status, claims, ...(r.equalSplit && status === "finish" ? { acceptEqualSplit: true } : {}) }),
      success,
    );
    setBusy(null);
    if (res !== undefined && status !== "draft") onSaved();
    return res;
  };

  const badge = ack ? (
    <Badge tone={ack === "NONE" && r.equalSplit ? "warn" : "receive"}>{ack === "NONE" ? (r.equalSplit ? "Disagreed" : "✓ Got nothing") : "✓ Share confirmed"}</Badge>
  ) : (
    <Badge tone="coral">Your turn</Badge>
  );
  const myItems = r.lines
    .filter((l) => (draft[l.id] ?? 0) > 0)
    .map((l) => ({ id: l.id, label: l.mode === "UNITS" ? `${l.label} ×${draft[l.id]}` : l.label }));
  const showMyItems = folded && !r.equalSplit && ack === "FINISHED" && myItems.length > 0;

  const lines = (
    <ul className="space-y-2">
      {r.lines.map((l) => {
        const mine = draft[l.id] ?? 0;
        const others = l.claims.filter((c) => c.memberId !== me.memberId && !c.stale);
        const otherUnits = others.reduce((a, c) => a + c.units, 0);
        const left = l.quantity - otherUnits - mine;
        return (
          <li key={l.id} className={`card p-4 ${mine > 0 && !r.equalSplit ? "border-violet ring-2 ring-violet-soft" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {l.quantity > 1 && <span className="tnum text-muted">{l.quantity}× </span>}
                  {l.label}
                </p>
                <p className="tnum text-[14px] text-muted">
                  {php(l.amount)}
                  {!r.equalSplit && (l.mode === "SHARED" ? " · shared equally" : ` · ${otherUnits + mine} of ${l.quantity} claimed`)}
                </p>
              </div>
              {!r.equalSplit && (l.mode === "SHARED" ? (
                <button
                  type="button"
                  disabled={readOnly}
                  role="switch"
                  aria-checked={mine > 0}
                  aria-label={`I had some ${l.label}`}
                  onClick={() => setDraft((d) => ({ ...d, [l.id]: mine > 0 ? 0 : 1 }))}
                  className={`inline-flex min-h-11 min-w-24 items-center justify-center gap-1 rounded-full px-3 text-[14px] font-semibold ${mine > 0 ? "bg-violet text-violet-ink" : "border border-line bg-surface"}`}
                >
                  {mine > 0 ? (
                    <>
                      <Icon name="check" size={16} /> I had some
                    </>
                  ) : (
                    "I had some"
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-1" role="group" aria-label={`Pieces of ${l.label} you had`}>
                  <button type="button" disabled={readOnly || mine === 0} onClick={() => setDraft((d) => ({ ...d, [l.id]: Math.max(0, mine - 1) }))} className="stepper-btn" aria-label="One less">
                    <Icon name="minus" size={22} />
                  </button>
                  <span className="tnum w-8 text-center text-[18px] font-bold" aria-live="polite">
                    {mine}
                  </span>
                  <button type="button" disabled={readOnly || left <= 0} onClick={() => setDraft((d) => ({ ...d, [l.id]: mine + 1 }))} className="stepper-btn" aria-label="One more">
                    <Icon name="plus" size={22} />
                  </button>
                </div>
              ))}
            </div>
            {others.length > 0 && !r.equalSplit && (
              <Disclosure summary={`Other claims (${others.length})`} icon="users">
                <ul className="space-y-1 text-[13px] text-muted">
                  {others.map((c) => (
                    <li key={c.memberId} className="flex items-center gap-1.5">
                      <Avatar name={name(c.memberId)} seq={seq(c.memberId)} size={22} />
                      <span className="min-w-0 break-words">{name(c.memberId)}{l.mode === "UNITS" && ` ×${c.units}`}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {l.mode === "UNITS" && left < 0 && <p className="mt-1 text-[13px] text-pay">More than available — reduce your pieces.</p>}
          </li>
        );
      })}
      {r.equalSplit && <li className="px-1 text-[14px] text-muted">Split equally among {active.length} people. Shares can differ by {php(1n)}.</li>}
      {r.adjustments.length > 0 && (
        <li className="px-1">
          <Disclosure summary={`Discounts & charges (${r.adjustments.length})`}>
            <ul className="space-y-1 text-[14px] text-muted">
              {r.adjustments.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">{a.label}</span>
                  <span className="tnum shrink-0">{a.kind === "DISCOUNT" ? "−" : "+"}{php(a.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[14px] text-muted">{r.equalSplit ? "Included in the equal split." : "Split by what each person had."}</p>
          </Disclosure>
        </li>
      )}
    </ul>
  );

  const itemButtons = !readOnly && !r.equalSplit && (
    <div className="space-y-2 pt-1">
      <Button full busy={busy === "finish"} busyLabel="Saving…" disabled={!Object.values(draft).some((u) => u > 0) || busy !== null} onClick={() => save("finish")}>
        {`Save my items${ack ? "" : " & next"}`}
      </Button>
      <Button full variant="secondary" busy={busy === "none"} busyLabel="Saving…" disabled={busy !== null} onClick={() => save("none")}>
        I got nothing from this receipt
      </Button>
      {dirty && (
        <Button full variant="tonal" busy={busy === "draft"} busyLabel="Saving…" disabled={busy !== null} onClick={() => save("draft")}>
          Save as draft (not finished)
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-1.5" as="section">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-[18px] font-bold">{r.label}</p>
          {badge}
        </div>
        <p className="text-[14px] text-muted">
          Paid by {name(r.payerId)} · {php(r.payable)}
        </p>
        {share !== null && (
          <p className="tnum flex items-baseline justify-between text-[16px]" data-testid="my-share">
            <span>Your share</span>
            <b className="text-[20px]">{php(share)}</b>
          </p>
        )}
        {settleShare && (
          <p className="tnum text-right text-[14px] text-muted" data-testid="my-share-settle">
            {settleShare}
          </p>
        )}
        <p className="text-[14px] text-muted" data-testid="receipt-progress">
          {notYet.length === 0
            ? r.equalSplit
              ? agreed.length === active.length
                ? `Everyone confirmed (${agreed.length} of ${active.length})`
                : `${agreed.length} of ${active.length} confirmed`
              : `Everyone answered (${answered.length} of ${active.length})`
            : `${r.equalSplit ? agreed.length : answered.length} of ${active.length} ${r.equalSplit ? "confirmed" : "answered"}${waitingSummary}`}
        </p>
        {waitingFor.length > 1 && (
          <Disclosure summary={`Waiting for ${notYet.length}`} icon="clock">
            <ul className="list-inside list-disc text-[14px] text-muted">
              {notYet.map((id) => <li key={id} className="break-words">{id === me.memberId ? "You" : name(id)}</li>)}
            </ul>
          </Disclosure>
        )}
        {r.equalSplit && joiningOpen && <p className="text-[13px] text-muted">Can change if someone else joins.</p>}
        {showMyItems && myItems.length === 1 && <p className="break-words text-[14px] text-muted">You had: {myItems[0].label}</p>}
        {showMyItems && myItems.length > 1 && (
          <Disclosure summary={`Your items (${myItems.length})`} icon="hand">
            <ul className="list-inside list-disc text-[14px] text-muted">
              {myItems.map((item) => <li key={item.id} className="break-words">{item.label}</li>)}
            </ul>
          </Disclosure>
        )}
      </Card>

      {staleDraft && <Notice tone="warn" title="This receipt changed">Your earlier picks are shown as a draft. Check them and save again.</Notice>}
      {r.equalSplit && ack === "NONE" && <Notice tone="warn" title="You disagreed">Tell the organizer what needs changing. The bill can’t freeze until everyone agrees or the receipt changes.</Notice>}

      {/* Equal split: the items are information, not choices. */}
      {r.equalSplit && (
        <>
          {!readOnly && ack !== "FINISHED" && ack !== "NONE" && (
            <>
              <Button full busy={busy === "finish"} busyLabel="Confirming…" onClick={() => save("finish")}>
                Confirm my equal share
              </Button>
              <ActionError message={error} />
            </>
          )}
          {ack === "FINISHED" && !readOnly && <NextCard where="claim" />}
          <Disclosure summary={`See items (${r.lines.length})`} className="px-1">
            {lines}
          </Disclosure>
          {!readOnly && (
            <Disclosure summary={ack === "FINISHED" ? "Change my answer" : "Don’t agree with splitting this equally?"} className="px-1">
              {ack === "FINISHED" && <p className="text-[14px] text-muted">If you didn’t share this receipt, tell the organizer so they can change it to item-by-item.</p>}
              {ack !== "NONE" && (
                <Button full variant="secondary" busy={busy === "none"} busyLabel="Saving…" onClick={() => save("none")}>
                  I disagree — ask organizer to change it
                </Button>
              )}
            </Disclosure>
          )}
          {ack === "NONE" && !readOnly && <NextCard where="claim" />}
        </>
      )}

      {/* Item by item: the list is the action until you've answered; then it folds away. */}
      {!r.equalSplit &&
        (folded && !readOnly ? (
          <>
            <NextCard where="claim" />
            <Disclosure summary={`See items (${r.lines.length})`} className="px-1">
              {lines}
              {itemButtons}
              <ActionError message={error} />
            </Disclosure>
          </>
        ) : (
          <>
            {lines}
            {itemButtons}
            <ActionError message={error} />
          </>
        ))}

      {readOnly && <Notice tone="info">{event.cancelled ? "This event was cancelled; claims are closed." : "Claims are frozen with the bill."}</Notice>}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="mt-6 py-10 text-center">
      <Icon name="hand" size={40} className="mx-auto text-muted" />
      <p className="mt-3 font-semibold">No receipts yet</p>
      <p className="mx-auto mt-1 max-w-[320px] text-[15px] text-muted">You can claim items as receipts are added.</p>
    </Card>
  );
}
