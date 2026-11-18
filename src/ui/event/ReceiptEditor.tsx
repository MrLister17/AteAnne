"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Button, Field, MoneyInput, Notice, Sheet, useToast } from "../components/ui";
import { php, toCentavos, toInput } from "../format";
import { ReceiptView, useAction, useEvent } from "./EventContext";
import type { ScannedDraft } from "@/server/services/ReceiptScanService";
import { uploadName } from "../image";
import { EntryMath } from "@/domain/receipt/EntryMath";
import { ScanPanel } from "./ScanPanel";
import { useReceiptScanner } from "./useReceiptScanner";

/**
 * `autoTotal`: the line total follows quantity × price each until the person
 * types a total themselves (clearing it switches back to automatic).
 */
type LineDraft = { id?: string; label: string; quantity: string; amount: string; unitPrice: string; mode: "SHARED" | "UNITS"; autoTotal: boolean };
/** `byPercent`: the amount is `percent` % of the items it applies to (e.g. a 10% service charge). */
type AdjDraft = { kind: "DISCOUNT" | "SERVICE" | "CHARGE"; label: string; amount: string; byPercent: boolean; percent: string; scope: "ALL" | number[] };

const KIND_LABEL = { DISCOUNT: "Discount", SERVICE: "Service charge", CHARGE: "Other charge" } as const;

/** `payableAuto`: the total paid follows items − discounts + charges until the person types the printed total. */
type Draft = { label: string; payerMemberId: string; equalSplit: boolean; payable: string; payableAuto: boolean; lines: LineDraft[]; adjustments: AdjDraft[] };

const cv = (s: string): bigint | null => {
  const c = s.trim() === "" ? null : toCentavos(s);
  return c === null ? null : BigInt(c);
};
const qty = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
/** A stored line is "automatic" only if its total really is quantity × price each. */
const consistent = (unitPrice: string | null, quantity: number, amount: string) => unitPrice !== null && BigInt(unitPrice) * BigInt(quantity) === BigInt(amount);
const emptyLine = (): LineDraft => ({ label: "", quantity: "1", amount: "", unitPrice: "", mode: "SHARED", autoTotal: true });

/**
 * The numbers the form actually shows and saves: automatic line totals,
 * percentage charges and the automatic receipt total filled in. Pure and
 * exact (bigint centavos); the server recomputes everything again on save.
 */
function resolveDraft(d: Draft) {
  const lineAmounts = d.lines.map((l) => {
    if (l.autoTotal) {
      const t = EntryMath.lineTotal(cv(l.unitPrice), qty(l.quantity));
      if (t !== null) return toInput(t.toString());
    }
    return l.amount;
  });
  const lineCv = lineAmounts.map(cv);
  const adjAmounts = d.adjustments.map((a) => {
    if (!a.byPercent) return a.amount;
    if (!a.percent.trim()) return "";
    const idx = a.scope === "ALL" ? d.lines.map((_, i) => i) : a.scope;
    const base = idx.reduce((sum, i) => sum + (lineCv[i] ?? 0n), 0n);
    const v = EntryMath.percentOf(base, a.percent);
    return v === null ? "x" : toInput(v.toString()); // "x" = shown as invalid until the % is fixed
  });
  let gross = 0n;
  let disc = 0n;
  let chg = 0n;
  for (const v of lineCv) if (v !== null) gross += v;
  d.adjustments.forEach((a, i) => {
    const v = cv(adjAmounts[i]);
    if (v === null) return;
    if (a.kind === "DISCOUNT") disc += v;
    else chg += v;
  });
  const computed = gross - disc + chg;
  // Blank fields are "not finished yet"; only typed non-amounts are errors.
  const itemFields = [...lineAmounts, ...adjAmounts];
  const itemsEmpty = itemFields.some((f) => f.trim() === "");
  const payable = d.payableAuto ? (itemsEmpty || computed < 0n ? "" : toInput(computed.toString())) : d.payable;
  const fields = [...itemFields, payable];
  const empty = fields.some((f) => f.trim() === "");
  const invalid = fields.some((f) => f.trim() !== "" && toCentavos(f) === null);
  const payableCv = cv(payable);
  return {
    lineAmounts,
    adjAmounts,
    payable,
    calc: { gross, disc, chg, computed, payable: payableCv, auto: d.payableAuto, bad: invalid || empty, invalid, empty, diff: payableCv === null ? null : payableCv - computed },
  };
}

/** A scan result becomes an ordinary editable draft; nothing about it is trusted until saved. */
function fromScan(s: ScannedDraft, myId: string): Draft {
  return {
    label: s.label,
    payerMemberId: myId,
    equalSplit: false,
    // The printed total stays as read, so a misread line shows up as a mismatch.
    payable: toInput(s.payable),
    payableAuto: false,
    lines: s.lines.length
      ? s.lines.map((l) => ({ label: l.label, quantity: String(l.quantity), amount: toInput(l.amount), unitPrice: l.unitPrice ? toInput(l.unitPrice) : "", mode: "SHARED" as const, autoTotal: consistent(l.unitPrice, l.quantity, l.amount) }))
      : [emptyLine()],
    adjustments: s.adjustments.map((a) => ({ kind: a.kind, label: a.label, amount: toInput(a.amount), byPercent: false, percent: "", scope: "ALL" as const })),
  };
}

function fromReceipt(r: ReceiptView | null, myId: string): Draft {
  if (!r) {
    return {
      label: "",
      payerMemberId: myId,
      equalSplit: false,
      payable: "",
      payableAuto: true,
      lines: [emptyLine()],
      adjustments: [],
    };
  }
  return {
    label: r.label,
    payerMemberId: r.payerId,
    equalSplit: r.equalSplit,
    payable: toInput(r.payable),
    payableAuto: r.payable === r.reconciliation.computedPayable,
    lines: r.lines.map((l) => ({ id: l.id, label: l.label, quantity: String(l.quantity), amount: toInput(l.amount), unitPrice: l.unitPrice ? toInput(l.unitPrice) : "", mode: l.mode, autoTotal: consistent(l.unitPrice, l.quantity, l.amount) })),
    adjustments: r.adjustments.map((a) => ({
      kind: a.kind,
      label: a.label,
      amount: toInput(a.amount),
      byPercent: false,
      percent: "",
      scope: a.scopeAll ? ("ALL" as const) : a.eligibleLineIds.map((id) => r.lines.findIndex((l) => l.id === id)).filter((i) => i >= 0),
    })),
  };
}

/**
 * Manual receipt entry. The entered line total is authoritative; unit price
 * is a convenience. A live reconciliation bar shows whether
 * items − discounts + charges equals the exact payable total.
 */
export function ReceiptEditor({
  receipt,
  open,
  onClose,
  scanned,
  photo,
}: {
  receipt: ReceiptView | null;
  open: boolean;
  onClose: () => void;
  scanned?: ScannedDraft | null;
  photo?: Blob | null;
}) {
  const { view, me, event } = useEvent();
  const act = useAction();
  const [d, setD] = useState<Draft>(() => (scanned && !receipt ? fromScan(scanned, me.memberId) : fromReceipt(receipt, me.memberId)));
  // A scan can come from the Receipts tab (props) or from the button inside this form.
  const [scanState, setScanState] = useState<ScannedDraft | null>(scanned && !receipt ? scanned : null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(photo ?? null);
  const photoUrl = useMemo(() => (photoBlob ? URL.createObjectURL(photoBlob) : null), [photoBlob]);
  const [bigPhoto, setBigPhoto] = useState(false);
  const scanner = useReceiptScanner(event.id);
  const scroller = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const canScanHere = !receipt && view.features.receiptScan && event.phase === "COLLECTING";
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [initial] = useState(() => JSON.stringify(d));
  /** Something was typed by hand (used before a photo overwrites it). */
  const typed = !!d.label.trim() || !!d.payable.trim() || d.adjustments.length > 0 || d.lines.some((l) => l.label.trim() || l.amount.trim());
  const dirty = !!scanState || JSON.stringify(d) !== initial;
  const close = () => {
    if (busy) return;
    if (dirty && !confirm(receipt ? "Discard your changes to this receipt?" : "Discard this receipt? Nothing has been saved yet.")) return;
    scanner.cancel();
    onClose();
  };

  const resolved = useMemo(() => resolveDraft(d), [d]);
  const calc = resolved.calc;

  const setLine = (i: number, patch: Partial<LineDraft>) => setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const setAdj = (i: number, patch: Partial<AdjDraft>) => setD((x) => ({ ...x, adjustments: x.adjustments.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const submit = async () => {
    setTried(true);
    // A Save tap must never look dead: say what is missing and bring it into view.
    const missing = [
      !d.label.trim() && "the store name",
      d.lines.some((l) => !l.label.trim()) && "every item’s name",
      (calc.bad || calc.payable === null) && "every amount",
    ].filter(Boolean) as string[];
    if (missing.length) {
      toast(`Not saved yet. Fill in ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`, "error");
      requestAnimationFrame(() => {
        const first = scroller.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.scrollIntoView({ block: "center", behavior: "smooth" });
        first?.focus({ preventScroll: true });
      });
      return;
    }
    if (calc.payable === null) return;
    const body = {
      label: d.label,
      payerMemberId: d.payerMemberId,
      equalSplit: d.equalSplit,
      payable: calc.payable.toString(),
      lines: d.lines.map((l, i) => ({
        ...(l.id ? { id: l.id } : {}),
        label: l.label,
        quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
        amount: toCentavos(resolved.lineAmounts[i])!,
        unitPrice: l.unitPrice ? toCentavos(l.unitPrice) : null,
        mode: d.equalSplit ? "SHARED" : l.mode,
      })),
      adjustments: d.adjustments.map((a, i) => ({
        kind: a.kind,
        label: a.label || (a.byPercent ? `${KIND_LABEL[a.kind]} ${a.percent.trim().replace(/%$/, "")}%` : KIND_LABEL[a.kind]),
        amount: toCentavos(resolved.adjAmounts[i])!,
        eligibleLineIndexes: a.scope === "ALL" ? null : a.scope,
      })),
    };
    setBusy(true);
    const ok = await act(
      () => (receipt ? api.put(`/api/receipts/${receipt.id}`, { ...body, expectedVersion: receipt.version }) : api.post<{ receiptId: string }>(`/api/events/${event.id}/receipts`, body)),
      receipt ? "Receipt updated — claims and approvals reset" : "Receipt added",
    );
    if (ok && !receipt && photoBlob && "receiptId" in (ok as object)) {
      // Keep the scanned photo as private supporting evidence on the new receipt.
      const fd = new FormData();
      fd.set("file", photoBlob, uploadName(photoBlob));
      fd.set("kind", "RECEIPT");
      fd.set("receiptId", (ok as { receiptId: string }).receiptId);
      await act(() => api.post(`/api/events/${event.id}/assets`, fd), "Photo attached");
    }
    setBusy(false);
    if (ok) onClose();
  };

  const err = (s: string, required = true) => (tried && ((required && !s.trim()) || (s.trim() && !toCentavos(s))) ? "Enter a peso amount (up to 2 decimals)" : null);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={receipt ? `Edit “${receipt.label}”` : "Add a receipt"}
      footer={
        <div className="space-y-2">
          <Reconciliation calc={calc} onUse={() => setD((x) => ({ ...x, payable: "", payableAuto: true }))} />
          <Button full busy={busy} disabled={scanner.scanning} onClick={() => void submit()}>
            {busy ? "Saving…" : receipt ? "Save changes" : "Save receipt"}
          </Button>
        </div>
      }
    >
      <div ref={scroller} className="space-y-5 pb-4">
        {canScanHere && (
          <ScanPanel
            scanner={scanner}
            variant="form"
            rescan={!!scanState}
            onFile={async (f) => {
              // Never silently throw away what the person already typed.
              if (!scanState && typed && !confirm("Replace what you typed with the details from the photo?")) return;
              const result = await scanner.scan(f);
              if (result) {
                setScanState(result.draft);
                setPhotoBlob(result.photo);
                setD(fromScan(result.draft, d.payerMemberId));
                setTried(false);
                scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        )}
        {scanState && !receipt && (
          <Notice tone="warn" title="Drafted from your photo — please check it">
            <p>Compare every item, quantity and the total with the receipt before saving. Photos can be misread, and you decide what’s right.</p>
            {!scanState.reconciled && <p className="font-semibold">The items don’t add up to the total yet. Look for a missed or misread line; the bar above Save shows the gap.</p>}
            {scanState.warnings.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {scanState.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {photoUrl && (
          <div className="flex items-start gap-3">
            <img
              src={photoUrl}
              alt="The receipt photo you scanned"
              className={`${bigPhoto ? "max-h-[70vh] w-full" : "max-h-40 w-28"} rounded-xl border border-line bg-surface object-contain`}
            />
            <button type="button" className="btn btn-tonal !min-h-11 shrink-0 !px-4 !text-[15px]" onClick={() => setBigPhoto((v) => !v)}>
              {bigPhoto ? "Smaller photo" : "Bigger photo"}
            </button>
          </div>
        )}
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

        <div className="card space-y-2 p-4">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-violet" checked={d.equalSplit} onChange={(e) => setD({ ...d, equalSplit: e.target.checked })} />
            <span className="font-semibold">Split this receipt equally among everyone</span>
          </label>
          <p className="text-[14px] text-muted">Everyone on the locked roster confirms their own share with one tap. This includes all items, discounts and charges; totals differ by at most one centavo. Nobody is signed up for them.</p>
        </div>

        <div>
          <h3 className="mb-2 text-[15px] font-bold">Items</h3>
          <ol className="space-y-3">
            {d.lines.map((l, i) => (
              <li key={i} className="card space-y-3 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-muted">#{i + 1}</span>
                  <input aria-label={`Item ${i + 1} name`} className="field flex-1" maxLength={80} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Sisig / Rice / Coke 1.5L" aria-invalid={tried && !l.label.trim() ? true : undefined} />
                  {d.lines.length > 1 && (
                    <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove item ${i + 1}`} onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i), adjustments: d.adjustments.map((a) => ({ ...a, scope: a.scope === "ALL" ? "ALL" : a.scope.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) })) })}>
                      <Icon name="trash" size={20} />
                    </button>
                  )}
                </div>
                <LineAmounts
                  index={i}
                  line={l}
                  shownTotal={resolved.lineAmounts[i]}
                  invalid={!!err(resolved.lineAmounts[i])}
                  onChange={(patch) => setLine(i, patch)}
                />
                <fieldset disabled={d.equalSplit}>
                  <legend className="text-[13px] text-muted">How will people claim it?</legend>
                  <div className="segmented mt-1">
                    {(["SHARED", "UNITS"] as const).map((m) => (
                      <button key={m} type="button" aria-pressed={(d.equalSplit ? "SHARED" : l.mode) === m} onClick={() => setLine(i, { mode: m })} >
                        {m === "SHARED" ? "Shared equally" : "By piece"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{d.equalSplit ? "Included in everyone’s equal share of the whole receipt." : l.mode === "SHARED" ? "Split equally among whoever ticks it (one person = solo)." : `Each person claims whole pieces; all ${l.quantity || "?"} must be claimed.`}</p>
                </fieldset>
              </li>
            ))}
          </ol>
          <Button variant="add" icon="plus" className="mt-3" disabled={d.lines.length >= 50} onClick={() => setD({ ...d, lines: [...d.lines, emptyLine()] })}>
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
                  <button type="button" className="icon-btn icon-btn-danger ml-auto" aria-label="Remove" onClick={() => setD({ ...d, adjustments: d.adjustments.filter((_, j) => j !== i) })}>
                    <Icon name="trash" size={20} />
                  </button>
                </div>
                <input aria-label="Label" className="field" maxLength={80} value={a.label} onChange={(e) => setAdj(i, { label: e.target.value })} placeholder={KIND_LABEL[a.kind]} />
                <div className="segmented" role="group" aria-label="Enter as">
                  <button type="button" aria-pressed={!a.byPercent} onClick={() => a.byPercent && setAdj(i, { byPercent: false, amount: resolved.adjAmounts[i] === "x" ? "" : resolved.adjAmounts[i] })}>
                    Peso amount
                  </button>
                  <button type="button" aria-pressed={a.byPercent} onClick={() => !a.byPercent && setAdj(i, { byPercent: true, percent: a.percent || (a.kind === "SERVICE" ? "10" : "") })}>
                    Percent %
                  </button>
                </div>
                {a.byPercent ? (
                  <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                    <div className="relative">
                      <input
                        aria-label="Percent"
                        className="field tnum pr-8 text-right"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="10"
                        value={a.percent}
                        aria-invalid={resolved.adjAmounts[i] === "x" || (tried && !a.percent.trim()) ? true : undefined}
                        onChange={(e) => setAdj(i, { percent: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) })}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted">%</span>
                    </div>
                    <p className="tnum text-[15px]" aria-live="polite">
                      {resolved.adjAmounts[i] === "x" || !a.percent.trim() ? (
                        <span className="text-[14px] text-muted">Type a % like 10 or 12.5</span>
                      ) : (
                        <>
                          = <b>₱{resolved.adjAmounts[i]}</b> <span className="text-[13px] text-muted">of {a.scope === "ALL" ? "all items" : "the ticked items"}</span>
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <MoneyInput aria-label="Amount" value={a.amount} onChange={(e) => setAdj(i, { amount: e.target.value })} aria-invalid={err(a.amount) ? true : undefined} />
                )}
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
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="tonal" icon="plus" className="!px-2 !text-[15px] whitespace-nowrap" onClick={() => setD({ ...d, adjustments: [...d.adjustments, { kind: "SERVICE", label: "", amount: "", byPercent: true, percent: "10", scope: "ALL" }] })}>
              Service charge
            </Button>
            <Button variant="tonal" icon="plus" className="!px-2 !text-[15px] whitespace-nowrap" onClick={() => setD({ ...d, adjustments: [...d.adjustments, { kind: "DISCOUNT", label: "", amount: "", byPercent: false, percent: "", scope: "ALL" }] })}>
              Discount
            </Button>
          </div>
        </div>

        <Field
          label="Total paid to the merchant"
          hint={
            d.payableAuto
              ? "Filled in for you: items − discounts + charges. If there’s a printed receipt, type its total here to double-check."
              : "The exact final amount on the receipt. Clear it to fill it in automatically."
          }
          error={err(resolved.payable)}
        >
          {(p) => (
            <div className="relative">
              <MoneyInput {...p} value={resolved.payable} className={d.payableAuto ? "pr-20" : ""} onChange={(e) => setD({ ...d, payable: e.target.value, payableAuto: e.target.value.trim() === "" })} />
              {d.payableAuto && resolved.payable && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-violet-soft px-2 py-0.5 text-[12px] font-semibold text-violet">Auto</span>}
            </div>
          )}
        </Field>
      </div>
    </Sheet>
  );
}

function Reconciliation({ calc, onUse }: { calc: { gross: bigint; disc: bigint; chg: bigint; computed: bigint; diff: bigint | null; auto: boolean; bad: boolean; invalid: boolean; empty: boolean }; onUse: () => void }) {
  if (calc.invalid) return <p className="text-[14px] text-warn">Some amounts aren’t valid peso values. Use numbers like 120 or 120.50.</p>;
  if (calc.empty) return <p className="text-[14px] text-muted">Enter each item’s price. We’ll add everything up for you.</p>;
  if (calc.computed < 0n) return <p className="text-[14px] text-warn">Discounts are bigger than the items. Check the discount amounts.</p>;
  if (calc.auto) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-violet-soft px-3 py-2 text-[14px] text-violet" role="status" aria-live="polite">
        <Icon name="check" size={18} />
        <span className="tnum flex-1">
          Items {php(calc.gross)}
          {calc.disc > 0n && ` − ${php(calc.disc)}`}
          {calc.chg > 0n && ` + ${php(calc.chg)}`} = <b>{php(calc.computed)}</b> total
        </span>
      </div>
    );
  }
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
        <button type="button" className="btn btn-secondary !min-h-11 shrink-0 !rounded-xl !px-3 !text-[14px]" onClick={onUse}>
          Use this
        </button>
      )}
    </div>
  );
}

/**
 * Qty × Price each = Line total. The total fills itself in from quantity and
 * price; typing a different total (as printed) takes over, and a one-tap
 * button puts the automatic total back.
 */
function LineAmounts({ index, line, shownTotal, invalid, onChange }: { index: number; line: LineDraft; shownTotal: string; invalid: boolean; onChange: (patch: Partial<LineDraft>) => void }) {
  const unit = cv(line.unitPrice);
  const q = qty(line.quantity);
  const product = EntryMath.lineTotal(unit, q);
  const typed = cv(line.amount);
  const derived = line.autoTotal && product !== null;
  const mismatch = !line.autoTotal && product !== null && typed !== null && typed !== product;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[60px_1fr_1fr] items-end gap-2">
        <label className="text-[13px] text-muted">
          Qty
          <input
            aria-label={`Item ${index + 1} quantity`}
            className="field tnum mt-1 !px-2 text-center"
            inputMode="numeric"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </label>
        <label className="text-[13px] text-muted">
          Price each
          <div className="mt-1">
            <MoneyInput aria-label={`Item ${index + 1} price each`} value={line.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value })} />
          </div>
        </label>
        <label className="text-[13px] text-muted">
          <span className="flex items-center gap-1">
            Line total
            {derived && <span className="rounded-full bg-violet-soft px-1.5 text-[11px] font-semibold text-violet">auto</span>}
          </span>
          <div className="mt-1">
            <MoneyInput
              aria-label={`Item ${index + 1} line total`}
              value={shownTotal}
              aria-invalid={invalid ? true : undefined}
              // Typing a total over a known price means "this is what's printed": stop following qty × price.
              onChange={(e) => onChange({ amount: e.target.value, autoTotal: e.target.value.trim() === "" || unit === null })}
            />
          </div>
        </label>
      </div>
      {mismatch && (
        <div className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <span className="tnum flex-1">
            {q} × {php(unit!)} = {php(product!)}, but the line total says {php(typed!)}. The line total is used.
          </span>
          <button type="button" className="btn btn-secondary !min-h-11 shrink-0 !rounded-xl !px-3 !text-[14px]" onClick={() => onChange({ amount: "", autoTotal: true })}>
            Use {php(product!)}
          </button>
        </div>
      )}
      {!derived && !mismatch && unit === null && <p className="text-[12px] text-muted">Type the price each and we’ll multiply, or type the line total as printed.</p>}
    </div>
  );
}
