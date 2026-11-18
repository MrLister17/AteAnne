"use client";

import { useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Avatar, Badge, Button, Card, Notice, Sheet, useToast } from "../components/ui";
import { php } from "../format";
import { MAX_CLIENT_UPLOAD_BYTES, prepareImage, uploadName } from "../image";
import { ReceiptEditor } from "./ReceiptEditor";
import { ReceiptView, useAction, useEvent } from "./EventContext";
import { useReceiptScanner } from "./useReceiptScanner";
import { ScanOffNote, ScanPanel } from "./ScanPanel";
import type { ScannedDraft } from "@/server/services/ReceiptScanService";

export function ReceiptsTab() {
  const { view, event, me, name, seq } = useEvent();
  const [editing, setEditing] = useState<ReceiptView | "new" | null>(null);
  const [scan, setScan] = useState<{ draft: ScannedDraft; photo: Blob } | null>(null);
  const scanner = useReceiptScanner(event.id);
  const startScan = async (file: File) => {
    const result = await scanner.scan(file);
    if (result) {
      setScan(result);
      setEditing("new");
    }
  };

  const [openId, setOpenId] = useState<string | null>(null);
  const open = view.receipts.find((r) => r.id === openId) ?? null;
  const canAdd = event.phase === "COLLECTING" && !event.cancelled && view.receipts.length < 25;
  const total = view.receipts.reduce((a, r) => a + BigInt(r.payable), 0n);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-[22px] font-bold">Receipts</h2>
          <p className="tnum text-[14px] text-muted">
            {view.receipts.length} receipt{view.receipts.length === 1 ? "" : "s"} · {php(total)} paid to merchants
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

      {(event.phase === "SETTLING" || event.phase === "DONE") && <Notice tone="info">Receipts are frozen with the bill. If something is wrong, the organizer can reopen them from Home → “Something wrong with the bill?”.</Notice>}
      {(event.phase === "ALLOCATING" || event.phase === "REVIEWING") && <Notice tone="info">Receipts are locked. The organizer can reopen them from Home; that resets claims on the receipt that changes.</Notice>}

      {view.receipts.length === 0 && (
        <Card className="py-10 text-center">
          <Icon name="receipt" size={40} className="mx-auto text-muted" />
          <p className="mt-3 font-semibold">No receipts yet</p>
          <p className="mt-1 text-[15px] text-muted">Whoever paid adds the receipt: items, discounts, service charge and the exact total.</p>
        </Card>
      )}

      <ul className="space-y-3">
        {view.receipts.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpenId(r.id)} className="card flex w-full items-center gap-3 p-4 text-left active:bg-surface-2">
              <Avatar name={name(r.payerId)} seq={seq(r.payerId)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.label}</p>
                <p className="truncate text-[14px] text-muted">
                  Paid by {name(r.payerId)} · {r.lines.length} item{r.lines.length === 1 ? "" : "s"}
                  {r.imageAssetId ? " · photo" : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.reconciliation.reconciled ? <Badge tone="receive">✓ Adds up</Badge> : <Badge tone="pay">✗ Doesn’t add up</Badge>}
                  {r.fundingAcknowledged ? <Badge tone="receive">✓ Payer confirmed</Badge> : <Badge tone="warn">Payer to confirm</Badge>}
                  {r.equalSplit && <Badge tone="violet">Everyone splits equally</Badge>}
                </div>
              </div>
              <p className="tnum shrink-0 text-[16px] font-bold">{php(r.payable)}</p>
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
  const { view, me, event, name } = useEvent();
  const act = useAction();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const isPayer = r.payerId === me.memberId;
  const canPhoto = event.phase !== "DONE" && (r.authorId === me.memberId || isPayer || me.isOwner);

  return (
    <Sheet
      open
      onClose={onClose}
      title={r.label}
      footer={
        event.phase === "COLLECTING" && isPayer && !r.fundingAcknowledged ? (
          <Button full variant="receive" icon="check" disabled={!r.reconciliation.reconciled} onClick={() => act(() => api.post(`/api/receipts/${r.id}/funding`, { receiptVersion: r.version, amount: r.payable }), "Thanks — funding confirmed")}>
            I paid {php(r.payable)} for this
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {r.equalSplit && <Notice tone="info" title="Split equally among everyone">All items, discounts and charges are included. Each person must confirm their own share before review; totals can differ by one centavo.</Notice>}
        <div className="flex items-center justify-between">
          <p className="text-muted">
            Paid by <b className="text-ink">{name(r.payerId)}</b> · entered by {name(r.authorId)} · v{r.version}
          </p>
        </div>
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
          {canPhoto && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Attach receipt photo"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  const img = await prepareImage(f, "RECEIPT");
                  if (img.size > MAX_CLIENT_UPLOAD_BYTES) {
                    setUploading(false);
                    e.target.value = "";
                    toast("That photo is too large to upload. Try a smaller photo or a screenshot of it.", "error");
                    return;
                  }
                  const fd = new FormData();
                  fd.set("file", img, uploadName(img));
                  fd.set("kind", "RECEIPT");
                  fd.set("receiptId", r.id);
                  await act(() => api.post(`/api/events/${event.id}/assets`, fd), "Photo attached (private to this event)");
                  setUploading(false);
                  e.target.value = "";
                }}
              />
              <Button variant="tonal" icon="camera" busy={uploading} onClick={() => fileRef.current?.click()}>
                {r.imageAssetId ? "Replace photo" : "Attach photo"}
              </Button>
            </>
          )}
          {r.canEdit && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm(`Delete “${r.label}”? Claims on it are removed.`)) void act(() => api.del(`/api/receipts/${r.id}`), "Receipt deleted").then(onClose);
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {showPhoto && r.imageAssetId && (
          <img src={`/api/assets/${r.imageAssetId}`} alt={`Photo of ${r.label} receipt`} className="w-full rounded-2xl border border-line" />
        )}
        <p className="text-[13px] text-muted">Photos are supporting evidence only — the typed amounts are what count. Only people in this event can see them.</p>
        {(view.event.phase === "COLLECTING" || view.event.phase === "ALLOCATING") && <ClaimProgress r={r} />}
      </div>
    </Sheet>
  );
}

function ClaimProgress({ r }: { r: ReceiptView }) {
  const { view, name } = useEvent();
  return (
    <Card>
      <p className="mb-2 font-semibold">Who has answered</p>
      <ul className="space-y-1 text-[15px]">
        {r.acks
          .filter((a) => view.members.find((m) => m.id === a.memberId)?.active)
          .map((a) => (
            <li key={a.memberId} className="flex justify-between">
              <span>{name(a.memberId)}</span>
              <span className="text-muted">{a.kind && !a.stale ? (a.kind === "NONE" ? (r.equalSplit ? "Disagreed" : "Got nothing") : r.equalSplit ? "Confirmed equal share" : "Claimed") : a.stale ? "Needs to re-check" : "Not yet"}</span>
            </li>
          ))}
      </ul>
    </Card>
  );
}
