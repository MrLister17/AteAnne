"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../api";
import { CredentialReveal } from "../components/CredentialReveal";
import { Icon } from "../components/Icon";
import { Avatar, Badge, Button, Card, Field, Notice, SectionTitle, Sheet } from "../components/ui";
import { timeAgo } from "../format";
import { useAction, useEvent } from "./EventContext";

const AUDIT_TEXT: Record<string, string> = {
  "event.created": "created the event",
  "member.joined": "joined",
  "member.removed": "removed a duplicate member",
  "member.recovered": "recovered access on a new device",
  "member.recovery_rotated": "rotated their recovery key",
  "code.rotated": "made a new join code",
  "code.closed": "closed joining",
  "entry.completed": "finished entering receipts",
  "entry.reopened": "reopened receipt entry",
  "receipt.created": "added a receipt",
  "receipt.updated": "edited a receipt",
  "receipt.organizer_correction": "corrected a receipt (organizer)",
  "receipt.deleted": "deleted a receipt",
  "funding.acknowledged": "confirmed paying a receipt",
  "claims.saved": "saved claims",
  "review.approved": "approved the split",
  "phase.changed": "moved the event to a new step",
  "snapshot.frozen": "froze the statement",
  "instructions.updated": "updated payment details",
  "payment.reported": "reported a payment",
  "payment.verified": "confirmed receiving a payment",
  "payment.rejected": "marked a payment not received",
  "payment.cancelled": "cancelled a pending report",
  "payment.verification_reversed": "reversed a confirmation",
  "dispute.choice": "answered a dispute",
  "asset.uploaded": "uploaded a private image",
  "asset.removed": "removed a receipt photo",
  "event.cancelled": "cancelled the event",
  "event.uncancelled": "un-cancelled the event",
};

export function PeopleTab() {
  const router = useRouter();
  const { view, me, event, name } = useEvent();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h2 className="text-[22px] font-bold">People</h2>
        <p className="text-[14px] text-muted">
          {view.members.filter((m) => m.active).length} on the roster{event.rosterLockedAt ? " · locked" : ""}
        </p>
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-line">
          {view.members.map((m) => (
            <li key={m.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Avatar name={m.displayName} seq={m.seq} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {m.displayName}
                  {m.isMe && <span className="font-normal text-muted"> (you)</span>}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {m.isOwner && <Badge tone="violet">Organizer</Badge>}
                  {event.phase === "COLLECTING" && (m.entryComplete ? <Badge tone="receive">✓ Entry done</Badge> : <Badge>Still entering</Badge>)}
                  <Badge>{m.intent === "PAID_EXPENSE" ? "Paid something" : "Pays share"}</Badge>
                </div>
              </div>
              {me.isOwner && !m.isOwner && event.phase === "COLLECTING" && !m.referenced && (
                <Button variant="ghost" className="!px-2" aria-label={`Remove ${m.displayName}`} onClick={() => confirm(`Remove ${m.displayName}? Use this for duplicates or people who joined by mistake.`) && void act(() => api.del(`/api/events/${event.id}/members/${m.id}`), "Removed")}>
                  <Icon name="trash" size={20} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <SectionTitle>You</SectionTitle>
      <Card className="space-y-3">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => api.patch(`/api/events/${event.id}/me`, { displayName }), "Name updated")) setEditing(false);
            }}
          >
            <Field label="Display name">{(p) => <input {...p} className="field" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />}</Field>
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <p>
              Shown as <b>{me.displayName}</b>
            </p>
            {event.phase !== "DONE" && (
              <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
                Rename
              </Button>
            )}
          </div>
        )}
        <Button
          full
          variant="secondary"
          icon="key"
          onClick={async () => {
            if (!confirm("Make a new recovery key? Your old key stops working.")) return;
            const r = await act(() => api.post<{ recoveryKey: string }>(`/api/events/${event.id}/recovery-key`));
            if (r) setNewKey(r.recoveryKey);
          }}
        >
          New recovery key
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <a href={`/api/events/${event.id}/export?format=csv`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold">
            <Icon name="download" size={18} /> CSV
          </a>
          <a href={`/api/events/${event.id}/export?format=json`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold">
            <Icon name="download" size={18} /> JSON
          </a>
        </div>
        <p className="text-[13px] text-muted">Exports are AteAnne’s manual record — not a bank statement. They contain no images or keys.</p>
      </Card>

      {me.isOwner && event.phase !== "DONE" && (
        <>
          <SectionTitle>Organizer</SectionTitle>
          <Card className="space-y-3">
            <Button full variant="secondary" onClick={() => void act(() => api.post(`/api/events/${event.id}/cancel`, { cancelled: !event.cancelled }), event.cancelled ? "Event reopened" : "Event cancelled")}>
              {event.cancelled ? "Un-cancel event" : "Cancel event"}
            </Button>
            <p className="text-[13px] text-muted">Cancelling never forgives money. Costs or debts stay visible and payments can still be confirmed.</p>
            {!view.settlement?.hasReports && (
              <Button full variant="danger" icon="trash" onClick={() => setDeleting(true)}>
                Delete event
              </Button>
            )}
          </Card>
        </>
      )}

      <SectionTitle>Trust & limits</SectionTitle>
      <details className="card p-4 text-[14px]">
        <summary className="cursor-pointer font-semibold">How identity works here</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>No accounts: this browser is you. A join code only lets people join while receipts are being collected.</li>
          <li>Anyone with a forwarded code can join, so the organizer checks names before locking the roster. Names can repeat.</li>
          <li>A second browser or private window would join as a new person — the organizer removes duplicates before locking.</li>
          <li>Your recovery key moves you to a new phone without changing what you paid or owe. Without it, access can’t be restored in v1.</li>
          <li>Payments happen outside AteAnne. Only the person receiving money can confirm it.</li>
          <li>Once any payment is reported, the bill can’t be edited (v1). After Done, the record is read-only.</li>
          <li>Done events are deleted after 180 days. Export first if you want a copy.</li>
        </ul>
      </details>

      <SectionTitle>Activity</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line text-[14px]">
          {view.audit.map((a) => (
            <li key={a.id} className="flex gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <b>{a.actorMemberId ? name(a.actorMemberId) : "System"}</b> {AUDIT_TEXT[a.type] ?? a.type}
              </span>
              <span className="shrink-0 text-muted">{timeAgo(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {newKey && (
        <Sheet open onClose={() => setNewKey(null)} title="New recovery key">
          <CredentialReveal recoveryKey={newKey} onDone={() => setNewKey(null)} doneLabel="Done" />
        </Sheet>
      )}
      {deleting && (
        <Sheet open onClose={() => setDeleting(false)} title="Delete event">
          <div className="space-y-4">
            <Notice tone="pay" title="This permanently deletes the event for everyone">Receipts, claims, photos and history are destroyed. Deleting records does not cancel any real-world debt. Exported files and backups may still exist.</Notice>
            <Field label={`Type “${event.title}” to confirm`}>{(p) => <input {...p} className="field" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} />}</Field>
            <Button
              full
              variant="danger"
              disabled={confirmTitle.trim() !== event.title}
              onClick={async () => {
                if (await act(() => api.del(`/api/events/${event.id}`, { confirmTitle }), "Event deleted")) router.replace("/");
              }}
            >
              Delete forever
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
