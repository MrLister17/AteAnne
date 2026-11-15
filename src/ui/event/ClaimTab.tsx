"use client";

import { useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Avatar, Badge, Button, Card, Notice } from "../components/ui";
import { php } from "../format";
import { ReceiptView, useAction, useEvent } from "./EventContext";

/**
 * Allocation wizard: one receipt at a time, the person claims only their
 * OWN items (shared-equal tick or whole pieces) or explicitly says they got
 * nothing. Unanswered is never treated as zero.
 */
export function ClaimTab() {
  const { view, me, event } = useEvent();
  const [index, setIndex] = useState(() => {
    const first = view.receipts.findIndex((r) => !myAck(r, me.memberId));
    return first >= 0 ? first : 0;
  });

  if (event.phase === "COLLECTING") {
    return (
      <EmptyState title="Claiming starts after receipts are in" text="Once everyone has entered what they paid, the organizer locks the roster and you’ll pick what you had here." />
    );
  }
  if (!view.receipts.length) return <EmptyState title="No receipts" text="Nothing to claim." />;

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
      <ReceiptClaimer key={`${r.id}-${r.version}-${view.me.claimVersion}`} receipt={r} readOnly={event.phase !== "ALLOCATING" || event.cancelled} onNext={() => setIndex((i) => Math.min(view.receipts.length - 1, i + 1))} />
    </div>
  );
}

function myAck(r: ReceiptView, memberId: string) {
  const a = r.acks.find((x) => x.memberId === memberId);
  return a && a.kind && !a.stale ? a.kind : null;
}

function ReceiptClaimer({ receipt: r, readOnly, onNext }: { receipt: ReceiptView; readOnly: boolean; onNext: () => void }) {
  const { view, me, name, seq } = useEvent();
  const act = useAction();
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
  const [conflict, setConflict] = useState<string | null>(null);

  const ack = myAck(r, me.memberId);
  const staleDraft = r.lines.some((l) => l.claims.some((c) => c.memberId === me.memberId && c.stale));
  const dirty = JSON.stringify(draft) !== JSON.stringify(Object.fromEntries(Object.entries(initial).filter(([, v]) => v > 0)));
  const share = view.calculation.ok ? view.calculation.receipts.find((x) => x.receiptId === r.id)?.shares.find((s) => s.memberId === me.memberId) : null;

  const save = async (status: "finish" | "none" | "draft") => {
    setBusy(status);
    setConflict(null);
    const claims = status === "none" ? [] : Object.entries(draft).filter(([, u]) => u > 0).map(([lineId, units]) => ({ lineId, units }));
    const res = await act(
      () => api.put(`/api/receipts/${r.id}/claims`, { receiptVersion: r.version, expectedClaimVersion: view.me.claimVersion, status, claims }),
      status === "none" ? "Saved: you got nothing from this receipt" : status === "finish" ? "Claims saved" : "Draft saved",
    );
    setBusy(null);
    if (res === undefined) setConflict("Not saved. Someone may have claimed the last piece — check the counts and try again.");
    else if (status !== "draft") onNext();
  };

  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold">{r.label}</p>
          <p className="text-[14px] text-muted">
            Paid by {name(r.payerId)} · total {php(r.payable)}
          </p>
        </div>
        {ack ? <Badge tone="receive">{ack === "NONE" ? "Got nothing" : "Claimed"}</Badge> : <Badge tone="coral">Your turn</Badge>}
      </Card>

      {staleDraft && <Notice tone="warn" title="This receipt was corrected">Your earlier picks are shown as a draft. Check them against the new version and save again.</Notice>}
      {conflict && <Notice tone="pay">{conflict}</Notice>}

      <ul className="space-y-2">
        {r.lines.map((l) => {
          const mine = draft[l.id] ?? 0;
          const others = l.claims.filter((c) => c.memberId !== me.memberId && !c.stale);
          const otherUnits = others.reduce((a, c) => a + c.units, 0);
          const left = l.quantity - otherUnits - mine;
          return (
            <li key={l.id} className={`card p-4 ${mine > 0 ? "border-violet ring-2 ring-violet-soft" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {l.quantity > 1 && <span className="tnum text-muted">{l.quantity}× </span>}
                    {l.label}
                  </p>
                  <p className="tnum text-[14px] text-muted">
                    {php(l.amount)} · {l.mode === "SHARED" ? "shared equally" : `${otherUnits + mine} of ${l.quantity} pieces claimed`}
                  </p>
                </div>
                {l.mode === "SHARED" ? (
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
                    <button type="button" disabled={readOnly || mine === 0} onClick={() => setDraft((d) => ({ ...d, [l.id]: Math.max(0, mine - 1) }))} className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface disabled:opacity-40" aria-label="One less">
                      <Icon name="minus" size={18} />
                    </button>
                    <span className="tnum w-8 text-center text-[18px] font-bold" aria-live="polite">
                      {mine}
                    </span>
                    <button type="button" disabled={readOnly || left <= 0} onClick={() => setDraft((d) => ({ ...d, [l.id]: mine + 1 }))} className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface disabled:opacity-40" aria-label="One more">
                      <Icon name="plus" size={18} />
                    </button>
                  </div>
                )}
              </div>
              {others.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
                  <span className="flex -space-x-1.5">
                    {others.slice(0, 5).map((c) => (
                      <Avatar key={c.memberId} name={name(c.memberId)} seq={seq(c.memberId)} size={22} />
                    ))}
                  </span>
                  {others.map((c) => `${name(c.memberId)}${l.mode === "UNITS" ? ` ×${c.units}` : ""}`).join(", ")}
                </div>
              )}
              {l.mode === "UNITS" && left < 0 && <p className="mt-1 text-[13px] text-pay">More than available — reduce your pieces.</p>}
            </li>
          );
        })}
      </ul>

      {r.adjustments.length > 0 && (
        <p className="px-1 text-[14px] text-muted">
          {r.adjustments.map((a) => `${a.label} ${a.kind === "DISCOUNT" ? "−" : "+"}${php(a.amount)}`).join(" · ")} — split by what each person had, after you all claim.
        </p>
      )}

      {share && !dirty && (
        <Card className="tnum flex items-center justify-between">
          <span className="text-[15px]">Your share of this receipt (est.)</span>
          <b>{php(share.total)}</b>
        </Card>
      )}

      {!readOnly && (
        <div className="space-y-2 pt-1">
          <Button full busy={busy === "finish"} disabled={!Object.values(draft).some((u) => u > 0)} onClick={() => void save("finish")}>
            Save my items{ack ? "" : " & next"}
          </Button>
          <Button full variant="secondary" busy={busy === "none"} onClick={() => void save("none")}>
            I got nothing from this receipt
          </Button>
          {dirty && (
            <Button full variant="ghost" busy={busy === "draft"} onClick={() => void save("draft")}>
              Save as draft (not finished)
            </Button>
          )}
        </div>
      )}
      {readOnly && <Notice tone="info">Claims are locked in this step.</Notice>}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card className="mt-6 py-10 text-center">
      <Icon name="hand" size={40} className="mx-auto text-muted" />
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-[320px] text-[15px] text-muted">{text}</p>
    </Card>
  );
}
