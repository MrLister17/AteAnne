"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../api";
import { CredentialReveal } from "../components/CredentialReveal";
import { Icon } from "../components/Icon";
import { Avatar, Badge, Button, Card, CopyButton, Field, Notice, SectionTitle, Sheet } from "../components/ui";
import { timeAgo } from "../format";
import { useAction, useEvent } from "./EventContext";
import { TutorialButton } from "../tutorial/TutorialProvider";

const AUDIT_TEXT: Record<string, string> = {
  "event.created": "created the event",
  "member.joined": "joined",
  "member.removed": "removed a duplicate member",
  "member.recovered": "recovered access on a new device",
  "member.renamed": "changed a name",
  "member.guest_added": "added someone without a phone",
  "member.guest_key_issued": "made a key so a guest can use their own phone",
  "member.guest_took_over": "started using their own phone",
  "member.admin_added": "made someone an admin",
  "member.admin_removed": "removed an admin",
  "member.recovery_rotated": "rotated their recovery key",
  "member.access_reissued": "reissued access after an identity check",
  "code.rotated": "made a new join code",
  "code.closed": "closed joining",
  "roster.locked": "said everyone’s here (joining closed)",
  "bill.correction_started": "reopened the bill to correct it",
  "entry.completed": "finished entering receipts",
  "entry.reopened": "reopened receipt entry",
  "receipt.created": "added a receipt",
  "receipt.updated": "edited a receipt",
  "receipt.organizer_correction": "corrected a receipt (organizer)",
  "receipt.deleted": "deleted a receipt",
  "receipt.scanned": "scanned a receipt photo",
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
  const { view, me, event, name, actAs, showPerson } = useEvent();
  const act = useAction();
  const acting = Boolean(view.actingFor);
  const [guestKey, setGuestKey] = useState<{ name: string; key: string } | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<{ id: string; name: string } | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [reissuedKey, setReissuedKey] = useState<{ name: string; key: string; expiresAt: string } | null>(null);
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
            <li key={m.id} className="px-4 py-3">
              <div className="flex min-h-10 items-center gap-3">
              <Avatar name={m.displayName} seq={m.seq} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {m.displayName}
                  {m.isMe && <span className="font-normal text-muted"> (you)</span>}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {m.isOwner && <Badge tone="violet">Organizer</Badge>}
                  {m.isAdmin && <Badge tone="violet">Admin</Badge>}
                  {m.isGuest && <Badge tone="coral">No phone</Badge>}
                  {event.phase === "COLLECTING" && (m.entryComplete ? <Badge tone="receive">✓ Entry done</Badge> : <Badge>Still entering</Badge>)}
                  <Badge>{m.intent === "PAID_EXPENSE" ? "Paid something" : "Pays share"}</Badge>
                </div>
              </div>
              {(me.isOwner || (me.canManageGuests && m.isGuest)) && !acting && !m.isOwner && event.phase === "COLLECTING" && !event.rosterLockedAt && !m.referenced && (
                <Button variant="ghost" className="!px-2" aria-label={`Remove ${m.displayName}`} onClick={() => confirm(`Remove ${m.displayName}? Use this for duplicates or people added by mistake.`) && void act(() => api.del(`/api/events/${event.id}/members/${m.id}`), "Removed")}>
                  <Icon name="trash" size={20} />
                </Button>
              )}
              </div>
              {me.canManageGuests && m.isGuest && m.active && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="tonal" icon="eye" onClick={() => showPerson(m.id)}>
                    Show amount
                  </Button>
                  <Button variant="secondary" icon="hand" disabled={event.phase === "DONE"} onClick={() => actAs(m.id)}>
                    Act for them
                  </Button>
                  {event.phase !== "DONE" && (
                    <Button
                      variant="ghost"
                      icon="key"
                      className="col-span-2 !text-[15px]"
                      onClick={async () => {
                        if (!confirm(`Give ${m.displayName} their own access? You’ll get a key for them to open on their own phone. After that, only they can make their choices.`)) return;
                        const r = await act(() => api.post<{ recoveryKey: string }>(`/api/events/${event.id}/members/${m.id}/access-key`));
                        if (r) setGuestKey({ name: m.displayName, key: r.recoveryKey });
                      }}
                    >
                      They got a phone? Give them access
                    </Button>
                  )}
                </div>
              )}
              {me.isOwner && !acting && !m.isOwner && !m.isGuest && m.active && event.phase !== "DONE" && (
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    icon="shield"
                    className="!text-[15px]"
                    onClick={() => act(() => api.post(`/api/events/${event.id}/members/${m.id}/admin`, { isAdmin: !m.isAdmin }), m.isAdmin ? `${m.displayName} is no longer an admin` : `${m.displayName} can now help with people without a phone`)}
                  >
                    {m.isAdmin ? "Remove admin" : "Make admin"}
                  </Button>
                </div>
              )}
              {me.isOwner && !acting && !m.isOwner && !m.isGuest && m.active && (
                <Button
                  variant="ghost"
                  icon="key"
                  className="mt-1 !text-[15px]"
                  aria-label={`Reissue access for ${m.displayName}`}
                  onClick={() => { setIdentityConfirmed(false); setRecoveryTarget({ id: m.id, name: m.displayName }); }}
                >
                  Lost their key? Reissue access
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {me.canManageGuests && event.phase === "COLLECTING" && !event.rosterLockedAt && !event.cancelled && <AddGuest />}
      {me.canManageGuests && (event.phase !== "COLLECTING" || event.rosterLockedAt) && (
        <p className="px-1 text-[13px] text-muted">People without a phone can only be added while receipts are being collected (before the roster is locked).</p>
      )}

      <SectionTitle>{acting ? me.displayName : "You"}</SectionTitle>
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
        {!acting && (
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
        )}
        {!acting && (
        <div className="grid grid-cols-2 gap-2">
          <a href={`/api/events/${event.id}/export?format=csv`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold">
            <Icon name="download" size={18} /> CSV
          </a>
          <a href={`/api/events/${event.id}/export?format=json`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold">
            <Icon name="download" size={18} /> JSON
          </a>
        </div>
        )}
        {!acting && <p className="text-[13px] text-muted">Exports are AteAnne’s manual record — not a bank statement. They contain no images or keys.</p>}
        {!acting && (
          <Button full variant="tonal" icon="eye" onClick={() => showPerson(me.memberId)}>
            Show my amount in big text
          </Button>
        )}
      </Card>

      {me.isOwner && !acting && event.phase !== "DONE" && (
        <>
          <SectionTitle>Organizer</SectionTitle>
          <Card className="space-y-3">
            <Button full variant="secondary" onClick={() => act(() => api.post(`/api/events/${event.id}/cancel`, { cancelled: !event.cancelled }), event.cancelled ? "Event reopened" : "Event cancelled")}>
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

      <SectionTitle>Help</SectionTitle>
      <TutorialButton />

      <SectionTitle>Trust & limits</SectionTitle>
      <details className="card p-4 text-[14px]">
        <summary className="cursor-pointer font-semibold">How identity works here</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>No accounts: this browser is you. A join code only lets people join while receipts are being collected.</li>
          <li>Anyone with a forwarded code can join, so the organizer checks names before locking the roster. Names can repeat.</li>
          <li>A second browser or private window would join as a new person — the organizer removes duplicates before locking.</li>
          <li>Your recovery key moves you to a new phone without changing what you paid or owe. To use it, tap “I have a recovery key” on the first screen.</li>
          <li>If you lose your key, the organizer can check your identity in person and give you a replacement that expires in 15 minutes. Whoever redeems it controls your membership, including payment confirmations. The old phone loses access when it is used.</li>
          <li>People without a phone are added by the organizer or an admin, who makes their choices for them while showing them the screen. The history records who did it. Nobody can act for someone who has their own phone.</li>
          <li>Payments happen outside AteAnne. Only the person receiving money can confirm it.</li>
          <li>Claiming is your agreement: the bill freezes by itself once the organizer said everyone’s here and everyone is done. Check your claims before you tick that you’re done.</li>
          <li>A correction keeps prior statements and confirmed payments. Resolve pending reports and disputes first; the organizer freezes the revised bill again.</li>
          <li>Every event — finished or not — is deleted {event.retentionDays} days after it was created. Export first if you want a copy.</li>
        </ul>
      </details>

      <SectionTitle>Activity</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line text-[14px]">
          {view.audit.map((a) => (
            <li key={a.id} className="flex gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <b>{a.actorMemberId ? name(a.actorMemberId) : "AteAnne"}</b> {AUDIT_TEXT[a.type] ?? a.type}
                {a.type === "member.access_reissued" && a.detail && typeof a.detail === "object" && !Array.isArray(a.detail) && typeof a.detail.memberId === "string" && <span> for {name(a.detail.memberId)}</span>}
                {a.onBehalfOf && <span className="text-muted"> for {name(a.onBehalfOf)}</span>}
              </span>
              <span className="shrink-0 text-muted">{timeAgo(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {guestKey && (
        <Sheet open onClose={() => setGuestKey(null)} title={`Access for ${guestKey.name}`}>
          <div className="space-y-4">
            <Notice tone="info" title={`On ${guestKey.name}’s phone`}>
              Open AteAnne, tap <b>I have a recovery key</b>, and paste this key. From then on {guestKey.name} makes their own choices, with the same items and payments.
            </Notice>
            <CredentialReveal recoveryKey={guestKey.key} onDone={() => setGuestKey(null)} doneLabel="Done" />
          </div>
        </Sheet>
      )}
      {recoveryTarget && (
        <Sheet open onClose={() => setRecoveryTarget(null)} title={`Reissue access for ${recoveryTarget.name}`}>
          <div className="space-y-4">
            <Notice tone="pay" title="Check who you are giving access to">
              Only do this with {recoveryTarget.name} present. Anyone with this key can use their membership, including confirming payments. Their receipts, items and payment history stay the same.
            </Notice>
            <p className="text-[14px] text-muted">The new key expires in 15 minutes and replaces their old recovery key. Their old phone loses access when the replacement is used. Add AteAnne to their Home Screen first, then enter the key there.</p>
            <label className="flex min-h-12 items-center gap-3 text-[15px]">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={identityConfirmed} onChange={(e) => setIdentityConfirmed(e.target.checked)} />
              I have checked that this is {recoveryTarget.name} in person
            </label>
            <Button
              full
              icon="key"
              disabled={!identityConfirmed}
              onClick={async () => {
                const target = recoveryTarget;
                const r = await act(() => api.post<{ recoveryKey: string; expiresAt: string }>(`/api/events/${event.id}/members/${target.id}/recovery-key`, { identityConfirmed: true }));
                if (r) {
                  setRecoveryTarget(null);
                  setReissuedKey({ name: target.name, key: r.recoveryKey, expiresAt: r.expiresAt });
                }
              }}
            >
              Make replacement key
            </Button>
          </div>
        </Sheet>
      )}
      {reissuedKey && (
        <Sheet open onClose={() => setReissuedKey(null)} title={`Replacement key for ${reissuedKey.name}`}>
          <div className="space-y-4">
            <Notice tone="info" title={`On ${reissuedKey.name}’s phone`}>
              Open AteAnne from the Home Screen, tap <b>I have a recovery key</b>, and paste this key. Use it before {new Date(reissuedKey.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. They will receive their own new recovery key to save.
            </Notice>
            <p className="rounded-xl border border-dashed border-line bg-surface-2 p-3 font-mono text-[14px] break-all select-all" data-testid="replacement-key">{reissuedKey.key}</p>
            <CopyButton text={reissuedKey.key} label="Copy replacement key" />
            <Notice tone="warn">Give this key privately to {reissuedKey.name}. It grants their access; don’t post it in the group chat or keep a copy.</Notice>
            <Button full onClick={() => setReissuedKey(null)}>Done</Button>
          </div>
        </Sheet>
      )}
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

/** Organizer/admin: add someone who has no phone (or would rather not use one). */
function AddGuest() {
  const { event, view } = useEvent();
  const act = useAction();
  const [name, setName] = useState("");
  const full = view.members.filter((m) => m.active).length >= 20;
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon name="user" className="text-violet" />
        <p className="font-semibold">Add someone without a phone</p>
      </div>
      <p className="text-[14px] text-muted">For a lola, a kid, or anyone with no phone or data. You (or an admin) claim their items and record their payments for them, then show them their amount in big text.</p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (await act(() => api.post(`/api/events/${event.id}/guests`, { displayName: name.trim() }), `${name.trim()} added`)) setName("");
        }}
      >
        <input aria-label="Name of person without a phone" className="field flex-1" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lola Nena" disabled={full} />
        <Button type="submit" icon="plus" disabled={full || !name.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}
