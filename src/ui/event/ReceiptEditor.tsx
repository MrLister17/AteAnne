"use client";

import { useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Button, Field, MoneyInput, Notice, Sheet } from "../components/ui";
import { php, toCentavos, toInput } from "../format";
import { ReceiptView, useAction, useEvent } from "./EventContext";

type LineDraft = { id?: string; label: string; quantity: string; amount: string; unitPrice: string; mode: "SHARED" | "UNITS" };
type AdjDraft = { kind: "DISCOUNT" | "SERVICE" | "CHARGE"; label: string; amount: string; scope: "ALL" | number[] };

const KIND_LABEL = { DISCOUNT: "Discount", SERVICE: "Service charge", CHARGE: "Other charge" } as const;

type Draft = { label: string; payerMemberId: string; payable: string; lines: LineDraft[]; adjustments: AdjDraft[] };

function fromReceipt(r: ReceiptView | null, myId: string): Draft {
  if (!r) {
    return {
      label: "",
      payerMemberId: myId,
      payable: "",
      lines: [{ label: "", quantity: "1", amount: "", unitPrice: "", mode: "SHARED" }],
      adjustments: [],
    };
  }
  return {
    label: r.label,
    payerMemberId: r.payerId,
    payable: toInput(r.payable),
    lines: r.lines.map((l) => ({ id: l.id, label: l.label, quantity: String(l.quantity), amount: toInput(l.amount), unitPrice: l.unitPrice ? toInput(l.unitPrice) : "", mode: l.mode })),
    adjustments: r.adjustments.map((a) => ({
      kind: a.kind,
      label: a.label,
      amount: toInput(a.amount),
      scope: a.scopeAll ? ("ALL" as const) : a.eligibleLineIds.map((id) => r.lines.findIndex((l) => l.id === id)).filter((i) => i >= 0),
    })),
  };
}

/**
 * Manual receipt entry. The entered line total is authoritative; unit price
 * is a convenience. A live reconciliation bar shows whether
 * items − discounts + charges equals the exact payable total.
 */
export function ReceiptEditor({ receipt, open, onClose }: { receipt: ReceiptView | null; open: boolean; onClose: () => void }) {
  const { view, me, event } = useEvent();
  const act = useAction();
  const [d, setD] = useState<Draft>(() => fromReceipt(receipt, me.memberId));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const calc = useMemo(() => {
    const c = (s: string) => (s.trim() === "" ? null : toCentavos(s));
    let gross = 0n;
    let disc = 0n;
    let chg = 0n;
    let bad = false;
    for (const l of d.lines) {
      const v = c(l.amount);
      if (v === null) bad = true;
      else gross += BigInt(v);
    }
    for (const a of d.adjustments) {
      const v = c(a.amount);
      if (v === null) bad = true;
      else if (a.kind === "DISCOUNT") disc += BigInt(v);
      else chg += BigInt(v);
    }
    const computed = gross - disc + chg;
    const payable = c(d.payable);
    return { gross, disc, chg, computed, payable, bad, diff: payable === null ? null : BigInt(payable) - computed };
  }, [d]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setD((x) => {
      const lines = x.lines.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // Convenience: unit price × qty fills the line total when the total is empty or was derived.
        if ((patch.unitPrice !== undefined || patch.quantity !== undefined) && next.unitPrice && toCentavos(next.unitPrice) && Number(next.quantity) > 0) {
          const total = BigInt(toCentavos(next.unitPrice)!) * BigInt(Math.floor(Number(next.quantity)));
          if (!l.amount || (l.unitPrice && toCentavos(l.unitPrice) && BigInt(toCentavos(l.amount) ?? -1) === BigInt(toCentavos(l.unitPrice)!) * BigInt(Math.floor(Number(l.quantity) || 0)))) {
            next.amount = toInput(total.toString());
          }
        }
        return next;
      });
      return { ...x, lines };
    });
  const setAdj = (i: number, patch: Partial<AdjDraft>) => setD((x) => ({ ...x, adjustments: x.adjustments.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const submit = async () => {
    setTried(true);
    if (calc.bad || calc.payable === null || !d.label.trim() || d.lines.some((l) => !l.label.trim())) return;
    const body = {
      label: d.label,
      payerMemberId: d.payerMemberId,
      payable: calc.payable,
      lines: d.lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        label: l.label,
        quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
        amount: toCentavos(l.amount)!,
        unitPrice: l.unitPrice ? toCentavos(l.unitPrice) : null,
        mode: l.mode,
      })),
      adjustments: d.adjustments.map((a) => ({ kind: a.kind, label: a.label || KIND_LABEL[a.kind], amount: toCentavos(a.amount)!, eligibleLineIndexes: a.scope === "ALL" ? null : a.scope })),
    };
    setBusy(true);
    const ok = await act(
      () => (receipt ? api.put(`/api/receipts/${receipt.id}`, { ...body, expectedVersion: receipt.version }) : api.post(`/api/events/${event.id}/receipts`, body)),
      receipt ? "Receipt updated — claims and approvals reset" : "Receipt added",
    );
    setBusy(false);
    if (ok) onClose();
  };

  const err = (s: string, required = true) => (tried && ((required && !s.trim()) || (s.trim() && !toCentavos(s))) ? "Enter a peso amount (up to 2 decimals)" : null);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={receipt ? `Edit “${receipt.label}”` : "Add a receipt"}
      footer={
        <div className="space-y-2">
          <Reconciliation calc={calc} onUse={() => setD((x) => ({ ...x, payable: toInput(calc.computed.toString()) }))} />
          <Button full busy={busy} onClick={() => void submit()}>
            {receipt ? "Save changes" : "Save receipt"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-4">
        {receipt && <Notice tone="warn">Saving a change resets everyone’s claims on this receipt to drafts and clears all approvals. The payer must confirm the amount again.</Notice>}
        <Field label="Store or label" error={tried && !d.label.trim() ? "Required" : null}>
          {(p) => <input {...p} className="field" maxLength={80} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} placeholder="Kusina ni Ate / 7-Eleven snacks" />}
        </Field>
        <Field label="Who actually paid the merchant?" hint="Only this person can confirm the funding. You can enter receipts someone else paid.">
          {(p) => (
            <select {...p} className="field" value={d.payerMemberId} onChange={(e) => setD({ ...d, payerMemberId: e.target.value })}>
              {view.members
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.isMe ? " (me)" : ""}
                  </option>
                ))}
            </select>
          )}
        </Field>

        <div>
          <h3 className="mb-2 text-[15px] font-bold">Items</h3>
          <ol className="space-y-3">
            {d.lines.map((l, i) => (
              <li key={i} className="card space-y-3 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-muted">#{i + 1}</span>
                  <input aria-label={`Item ${i + 1} name`} className="field flex-1" maxLength={80} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Sisig / Rice / Coke 1.5L" aria-invalid={tried && !l.label.trim() ? true : undefined} />
                  {d.lines.length > 1 && (
                    <button type="button" className="inline-flex size-11 items-center justify-center rounded-full text-pay" aria-label={`Remove item ${i + 1}`} onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i), adjustments: d.adjustments.map((a) => ({ ...a, scope: a.scope === "ALL" ? "ALL" : a.scope.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) })) })}>
                      <Icon name="trash" size={20} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-[72px_1fr] gap-2">
                  <label className="text-[13px] text-muted">
                    Qty
                    <input className="field tnum mt-1 text-center" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                  </label>
                  <label className="text-[13px] text-muted">
                    Line total (as printed)
                    <div className="mt-1">
                      <MoneyInput value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} aria-invalid={err(l.amount) ? true : undefined} />
                    </div>
                  </label>
                </div>
                <label className="block text-[13px] text-muted">
                  Unit price (optional)
                  <div className="mt-1">
                    <MoneyInput value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                  </div>
                </label>
                {l.unitPrice && toCentavos(l.unitPrice) && toCentavos(l.amount) && BigInt(toCentavos(l.unitPrice)!) * BigInt(Number(l.quantity) || 0) !== BigInt(toCentavos(l.amount)!) && (
                  <p className="text-[13px] text-warn">Qty × unit price ≠ line total. The line total is used.</p>
                )}
                <fieldset>
                  <legend className="text-[13px] text-muted">How will people claim it?</legend>
                  <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
                    {(["SHARED", "UNITS"] as const).map((m) => (
                      <button key={m} type="button" aria-pressed={l.mode === m} onClick={() => setLine(i, { mode: m })} className={`min-h-11 rounded-lg text-[14px] font-semibold ${l.mode === m ? "bg-surface text-violet shadow-sm" : "text-muted"}`}>
                        {m === "SHARED" ? "Shared equally" : "By piece"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{l.mode === "SHARED" ? "Split equally among whoever ticks it (one person = solo)." : `Each person claims whole pieces; all ${l.quantity || "?"} must be claimed.`}</p>
                </fieldset>
              </li>
            ))}
          </ol>
          <Button variant="ghost" icon="plus" className="mt-2" disabled={d.lines.length >= 50} onClick={() => setD({ ...d, lines: [...d.lines, { label: "", quantity: "1", amount: "", unitPrice: "", mode: "SHARED" }] })}>
            Add item
          </Button>
        </div>

        <div>
          <h3 className="mb-1 text-[15px] font-bold">Discounts & charges</h3>
          <p className="mb-2 text-[13px] text-muted">Enter amounts exactly as printed. VAT already inside prices and card-payment lines are not added. Discounts printed on an ex-VAT base: enter the equivalent peso reduction so the total matches.</p>
          <ol className="space-y-3">
            {d.adjustments.map((a, i) => (
              <li key={i} className="card space-y-3 p-3">
                <div className="flex gap-2">
                  <select aria-label="Type" className="field w-auto" value={a.kind} onChange={(e) => setAdj(i, { kind: e.target.value as AdjDraft["kind"] })}>
                    <option value="DISCOUNT">Discount</option>
                    <option value="SERVICE">Service charge</option>
                    <option value="CHARGE">Other charge</option>
                  </select>
                  <button type="button" className="ml-auto inline-flex size-11 items-center justify-center rounded-full text-pay" aria-label="Remove" onClick={() => setD({ ...d, adjustments: d.adjustments.filter((_, j) => j !== i) })}>
                    <Icon name="trash" size={20} />
                  </button>
                </div>
                <input aria-label="Label" className="field" maxLength={80} value={a.label} onChange={(e) => setAdj(i, { label: e.target.value })} placeholder={KIND_LABEL[a.kind]} />
                <MoneyInput aria-label="Amount" value={a.amount} onChange={(e) => setAdj(i, { amount: e.target.value })} aria-invalid={err(a.amount) ? true : undefined} />
                <fieldset>
                  <legend className="text-[13px] text-muted">{a.kind === "DISCOUNT" ? "Which items does it apply to?" : "Proportional to spending on"}</legend>
                  <label className="mt-1 flex min-h-11 items-center gap-2 text-[15px]">
                    <input type="checkbox" className="size-5 accent-[var(--violet)]" checked={a.scope === "ALL"} onChange={(e) => setAdj(i, { scope: e.target.checked ? "ALL" : [] })} />
                    All items
                  </label>
                  {a.scope !== "ALL" &&
                    d.lines.map((l, li) => (
                      <label key={li} className="flex min-h-11 items-center gap-2 pl-6 text-[15px]">
                        <input
                          type="checkbox"
                          className="size-5 accent-[var(--violet)]"
                          checked={(a.scope as number[]).includes(li)}
                          onChange={(e) => setAdj(i, { scope: e.target.checked ? [...(a.scope as number[]), li] : (a.scope as number[]).filter((x) => x !== li) })}
                        />
                        {l.label || `Item #${li + 1}`}
                      </label>
                    ))}
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="ghost" icon="plus" onClick={() => setD({ ...d, adjustments: [...d.adjustments, { kind: "SERVICE", label: "Service charge", amount: "", scope: "ALL" }] })}>
              Service charge
            </Button>
            <Button variant="ghost" icon="plus" onClick={() => setD({ ...d, adjustments: [...d.adjustments, { kind: "DISCOUNT", label: "Discount", amount: "", scope: "ALL" }] })}>
              Discount
            </Button>
          </div>
        </div>

        <Field label="Total paid to the merchant" hint="The exact final amount on the receipt." error={err(d.payable)}>
          {(p) => <MoneyInput {...p} value={d.payable} onChange={(e) => setD({ ...d, payable: e.target.value })} />}
        </Field>
      </div>
    </Sheet>
  );
}

function Reconciliation({ calc, onUse }: { calc: { gross: bigint; disc: bigint; chg: bigint; computed: bigint; diff: bigint | null; bad: boolean }; onUse: () => void }) {
  if (calc.bad) return <p className="text-[14px] text-warn">Some amounts aren’t valid peso values yet.</p>;
  const ok = calc.diff === 0n;
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] ${ok ? "bg-receive-soft text-receive" : "bg-warn-soft text-warn"}`} role="status" aria-live="polite">
      <Icon name={ok ? "check" : "alert"} size={18} />
      <span className="tnum flex-1">
        Items {php(calc.gross)}
        {calc.disc > 0n && ` − ${php(calc.disc)}`}
        {calc.chg > 0n && ` + ${php(calc.chg)}`} = <b>{php(calc.computed)}</b>
        {calc.diff === null ? "" : ok ? " ✓ matches" : ` · off by ${php(calc.diff < 0n ? -calc.diff : calc.diff)}`}
      </span>
      {!ok && (
        <button type="button" className="min-h-9 shrink-0 rounded-lg bg-surface px-2 text-[13px] font-semibold text-ink" onClick={onUse}>
          Use this
        </button>
      )}
    </div>
  );
}
