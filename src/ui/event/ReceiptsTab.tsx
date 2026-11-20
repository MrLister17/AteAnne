"use client";

import { useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ActionError, Avatar, Badge, Button, Card, Disclosure, Notice, Sheet } from "../components/ui";
import { shortDay } from "@/domain/money/Currency";
import { ReceiptEditor } from "./ReceiptEditor";
import { ReceiptView, useAction, useEvent, useInlineAction } from "./EventContext";
import { useReceiptScanner } from "./useReceiptScanner";
import { ScanOffNote, ScanPanel } from "./ScanPanel";
import type { ScannedDraft } from "@/server/services/ReceiptScanService";

export function ReceiptsTab() {
  const { view, event, me, name, seq, money } = useEvent();
  const [editing, setEditing] = useState<ReceiptView | "new" | null>(null);
  const [scan, setScan] = useState<{ draft: ScannedDraft; photo: Blob } | null>(null);
  const scanner = useReceiptScanner(event.id);
  const startScan = async (file: File) => {
    const mine = [...view.receipts].reverse().find((r) => r.authorId === me.memberId);
    const result = await scanner.scan(file, mine?.currency ?? event.currency);
    if (result) {
      setScan(result);
      setEditing("new");
    }
  };

  // Opened from a Next card ("Check and confirm", "Fix Lunch").
  const { focus } = useEvent();
  const [openId, setOpenId] = useState<string | null>(() => focus?.receiptId ?? null);
  const [seenFocus, setSeenFocus] = useState(focus?.seq ?? 0);
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    if (focus.receiptId && view.receipts.some((r) => r.id === focus.receiptId)) setOpenId(focus.receiptId);
  }
  const open = view.receipts.find((r) => r.id === openId) ?? null;
  const canAdd = event.phase === "COLLECTING" && !event.cancelled && view.receipts.length < 25;
  // In the settle-up currency (receipts in other currencies at their purchase-day rate); hidden while a rate is missing.
  const total = view.receipts.every((r) => r.settlePayable !== null) ? view.receipts.reduce((a, r) => a + BigInt(r.settlePayable!), 0n) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-[22px] font-bold">Receipts</h2>
          <p className="tnum text-[14px] text-muted">
            {view.receipts.length} receipt{view.receipts.length === 1 ? "" : "s"}
            {total !== null && <> · {money(total)} paid to merchants</>}
          </p>
        </div>
        {canAdd && !view.features.receiptScan && (
          <Button icon="plus" onClick={() => setEditing("new")}>
            Add receipt
          </Button>
        )}
      </div>

      {canAdd && view.features.receiptScan && <ScanPanel scanner={scanner} variant="hero" onFile={(f) => void startScan(f)} onType={() => setEditing("new")} />}
      {canAdd && !view.features.receiptScan && me.isOwner && <ScanOffNote />}

      {event.phase === "DONE" && <Notice tone="info" title="Receipts frozen" />}
      {event.phase === "SETTLING" && (
        <Disclosure summary="Receipts frozen" icon="lock" className="card py-1">
          <p className="text-[14px] text-muted">The organizer can correct the bill from Home → “Something wrong with the bill?”.</p>
        </Disclosure>
      )}
      {(event.phase === "ALLOCATING" || event.phase === "REVIEWING") && (
        <Disclosure summary="Receipts locked" icon="lock" className="card py-1">
          <p className="text-[14px] text-muted">The organizer can reopen receipts from Home. Editing a receipt then resets its claims.</p>
        </Disclosure>
      )}

      {view.receipts.length === 0 && (
        <Card className="py-10 text-center">
          <Icon name="receipt" size={40} className="mx-auto text-muted" />
          <p className="mt-3 font-semibold">No receipts yet</p>
        </Card>
      )}

      <ul className="space-y-3">
        {view.receipts.map((r) => (
          <li key={r.id}>
            <button type="button" aria-haspopup="dialog" onClick={() => setOpenId(r.id)} className="card flex w-full items-center gap-3 p-4 text-left active:bg-surface-2">
              <Avatar name={name(r.payerId)} seq={seq(r.payerId)} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-semibold">
                  <span className="truncate">{r.label}</span>
                  {r.imageAssetId && <Icon name="camera" size={16} label="Photo attached" className="shrink-0 text-muted" />}
                </p>
                <p className="truncate text-[14px] text-muted">Paid by {name(r.payerId)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {!r.reconciliation.reconciled && <Badge tone="pay">Doesn’t add up</Badge>}
                  {r.fundingAcknowledged ? <Badge tone="receive">✓ Paid the store</Badge> : <Badge tone="warn">Payer to confirm</Badge>}
                  {r.rateMissing && <Badge tone="warn">Awaiting exchange rate</Badge>}
                  {r.equalSplit && <Badge tone="violet">Everyone splits equally</Badge>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum text-[16px] font-bold">{money(r.payable, r.currency)}</p>
                {r.currency !== event.currency && r.settlePayable !== null && <p className="tnum text-[13px] text-muted">{money(r.settlePayable)}</p>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {open && <ReceiptDetail receipt={open} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)} />}
      {editing && (
        <ReceiptEditor
          key={editing === "new" ? (scan ? "scan" : "new") : `${editing.id}-${editing.version}`}
          receipt={editing === "new" ? null : editing}
          scanned={editing === "new" ? scan?.draft : null}
          photo={editing === "new" ? scan?.photo : null}
          open
          onClose={() => {
            setEditing(null);
            setScan(null);
          }}
        />
      )}
    </div>
  );
}

function ReceiptDetail({ receipt: r, onClose, onEdit }: { receipt: ReceiptView; onClose: () => void; onEdit: () => void }) {
  const { view, me, event, name, money } = useEvent();
  const php = (v: string | bigint) => money(v, r.currency);
  const act = useAction();
  const funding = useInlineAction();
  const [showPhoto, setShowPhoto] = useState(false);
  const isPayer = r.payerId === me.memberId;
  // New receipt photos aren't saved (D54). Old ones can still be viewed, or removed by whoever could attach them.
  const canRemovePhoto = Boolean(r.imageAssetId) && event.phase !== "DONE" && (r.authorId === me.memberId || isPayer || me.isOwner);

  return (
    <Sheet
      open
      onClose={onClose}
      title={r.label}
      footer={
        event.phase === "COLLECTING" && isPayer && !r.fundingAcknowledged ? (
          <div className="space-y-2">
            <ActionError message={funding.error} />
            <Button full variant="receive" icon="check" busyLabel="Confirming…" disabled={!r.reconciliation.reconciled} onClick={() => funding.run(() => api.post(`/api/receipts/${r.id}/funding`, { receiptVersion: r.version, amount: r.payable }), "Marked as paid")}>
              Yes, I paid {php(r.payable)}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {r.equalSplit && <Notice tone="info" title="Split equally among everyone">All items, discounts and charges are included. Each person confirms their own share; shares can differ by {php(1n)}.</Notice>}
        <div className="flex items-center justify-between">
          <p className="text-muted">
            Paid by <b className="text-ink">{name(r.payerId)}</b> · {shortDay(r.purchasedOn)}
          </p>
        </div>
        <ConvertedNote receipt={r} />
        {!r.reconciliation.reconciled && (
          <Notice tone="pay" title="This receipt doesn’t add up yet">
            <ul className="list-disc pl-4">
              {r.reconciliation.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Notice>
        )}
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {r.lines.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                <span className="tnum w-8 shrink-0 text-muted">{l.quantity}×</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.label}</p>
                  <p className="text-[13px] text-muted">
                    {l.mode === "SHARED" ? "Shared equally" : "By piece"}
                    {l.unitPriceMismatch && " · qty × unit price ≠ total; total used"}
                  </p>
                </div>
                <span className="tnum font-semibold">{php(l.amount)}</span>
              </li>
            ))}
            {r.adjustments.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className="w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-[13px] text-muted">{a.scopeAll ? "All items" : `Only: ${a.eligibleLineIds.map((id) => r.lines.find((l) => l.id === id)?.label).join(", ")}`}</p>
                </div>
                <span className={`tnum font-semibold ${a.kind === "DISCOUNT" ? "text-receive" : ""}`}>
                  {a.kind === "DISCOUNT" ? "−" : "+"}
                  {php(a.amount)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-surface-2 px-4 py-3 font-bold">
              <span>Total paid</span>
              <span className="tnum">{php(r.payable)}</span>
            </li>
          </ul>
        </Card>

        <div className="flex flex-wrap gap-2">
          {r.canEdit && (
            <Button variant="secondary" icon="edit" onClick={onEdit}>
              {r.authorId === me.memberId ? "Edit" : "Correct (organizer)"}
            </Button>
          )}
          {r.imageAssetId && (
            <Button variant="secondary" icon="camera" onClick={() => setShowPhoto((v) => !v)}>
              {showPhoto ? "Hide photo" : "View photo"}
            </Button>
          )}
          {canRemovePhoto && (
            <Button
              variant="tonal"
              icon="trash"
              busyLabel="Removing…"
              onClick={() => {
                if (!confirm("Remove this photo? The receipt details stay.")) return;
                return act(() => api.del(`/api/receipts/${r.id}/image`), "Photo removed");
              }}
            >
              Remove photo
            </Button>
          )}
          {r.canEdit && (
            <Button
              variant="danger"
              icon="trash"
              busyLabel="Deleting…"
              onClick={() => {
                if (!confirm(`Delete “${r.label}”? Claims on it are removed.`)) return;
                return act(() => api.del(`/api/receipts/${r.id}`), "Receipt deleted").then((ok) => {
                  if (ok !== undefined) onClose();
                  return ok;
                });
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {showPhoto && r.imageAssetId && (
          <img src={`/api/assets/${r.imageAssetId}`} alt={`Photo of ${r.label} receipt`} className="w-full rounded-2xl border border-line" />
        )}
        <Disclosure summary="Receipt details" icon="info">
          <p className="text-[14px] text-muted">Entered by {name(r.authorId)} · version {r.version} · {r.lines.length} item{r.lines.length === 1 ? "" : "s"}</p>
          {r.reconciliation.reconciled && <p className="text-[14px] text-receive">Receipt adds up</p>}
          {r.imageAssetId && <p className="text-[14px] text-muted">The typed amounts are what count. Only people in this event can see the photo, and it’s deleted with the event.</p>}
        </Disclosure>
        {(view.event.phase === "COLLECTING" || view.event.phase === "ALLOCATING") && <ClaimProgress r={r} />}
      </div>
    </Sheet>
  );
}

function ClaimProgress({ r }: { r: ReceiptView }) {
  const { view, name } = useEvent();
  const acks = r.acks.filter((a) => view.members.find((m) => m.id === a.memberId)?.active);
  const answered = acks.filter((a) => a.kind && !a.stale).length;
  return (
    <Disclosure summary={`Claims answered (${answered}/${acks.length})`} icon="users">
      <ul className="space-y-1 text-[15px]">
        {acks.map((a) => (
          <li key={a.memberId} className="flex flex-wrap justify-between gap-x-2">
            <span>{name(a.memberId)}</span>
            <span className="text-muted">{a.kind && !a.stale ? (a.kind === "NONE" ? (r.equalSplit ? "Disagreed" : "Got nothing") : r.equalSplit ? "Confirmed equal share" : "Claimed") : a.stale ? "Needs to re-check" : "Not yet"}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * A receipt in another currency than the event's: what it counts as, at the
 * rate of the day it was bought (D61). Until the bill freezes, a receipt
 * bought today shows yesterday's rate.
 */
export function ConvertedNote({ receipt: r }: { receipt: ReceiptView }) {
  const { event, money } = useEvent();
  if (r.currency === event.currency) return null;
  if (r.rateMissing || !r.rate || r.settlePayable === null) {
    return <Notice tone="warn" title={`Waiting for the ${shortDay(r.purchasedOn)} exchange rate`}>The bill can’t freeze until Hatian has the ECB rate for that day. It usually comes out the same evening.</Notice>;
  }
  return (
    <p className="rounded-xl bg-surface-2 px-3 py-2 text-[14px]" data-testid="converted-note">
      Counts as <b className="tnum">{money(r.settlePayable)}</b> · 1 {r.rate.base} = {r.rate.rate} {r.rate.quote} (ECB, {shortDay(r.rate.date)})
      {r.rate.date !== r.purchasedOn && event.phase === "COLLECTING" ? <span className="block text-[13px] text-muted">The {shortDay(r.purchasedOn)} rate isn’t out yet (or it was a weekend/holiday), so this uses the latest one before it.</span> : null}
    </p>
  );
}
