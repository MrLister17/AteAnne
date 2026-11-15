"use client";

import { useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Avatar, Badge, Button, Card, Notice, Sheet } from "../components/ui";
import { php } from "../format";
import { ReceiptEditor } from "./ReceiptEditor";
import { ReceiptView, useAction, useEvent } from "./EventContext";

export function ReceiptsTab() {
  const { view, event, name, seq } = useEvent();
  const [editing, setEditing] = useState<ReceiptView | "new" | null>(null);
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
        {canAdd && (
          <Button icon="plus" onClick={() => setEditing("new")}>
            Add receipt
          </Button>
        )}
      </div>

      {event.phase !== "COLLECTING" && <Notice tone="info">Receipts are locked while the group claims and reviews. The organizer can step back to fix one; that resets claims on it.</Notice>}

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
                </div>
              </div>
              <p className="tnum shrink-0 text-[16px] font-bold">{php(r.payable)}</p>
            </button>
          </li>
        ))}
      </ul>

      {open && <ReceiptDetail receipt={open} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)} />}
      {editing && <ReceiptEditor key={editing === "new" ? "new" : `${editing.id}-${editing.version}`} receipt={editing === "new" ? null : editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReceiptDetail({ receipt: r, onClose, onEdit }: { receipt: ReceiptView; onClose: () => void; onEdit: () => void }) {
  const { view, me, event, name } = useEvent();
  const act = useAction();
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
          <Button full variant="receive" icon="check" disabled={!r.reconciliation.reconciled} onClick={() => void act(() => api.post(`/api/receipts/${r.id}/funding`, { receiptVersion: r.version, amount: r.payable }), "Thanks — funding confirmed")}>
            I paid {php(r.payable)} for this
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
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
                  const fd = new FormData();
                  fd.set("file", f);
                  fd.set("kind", "RECEIPT");
                  fd.set("receiptId", r.id);
                  setUploading(true);
                  await act(() => api.post(`/api/events/${event.id}/assets`, fd), "Photo attached (private to this event)");
                  setUploading(false);
                  e.target.value = "";
                }}
              />
              <Button variant="ghost" icon="camera" busy={uploading} onClick={() => fileRef.current?.click()}>
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
        {view.event.phase === "ALLOCATING" && <ClaimProgress r={r} />}
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
              <span className="text-muted">{a.kind && !a.stale ? (a.kind === "NONE" ? "Got nothing" : "Claimed") : a.stale ? "Needs to re-check" : "Not yet"}</span>
            </li>
          ))}
      </ul>
    </Card>
  );
}
