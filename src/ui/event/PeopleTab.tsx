"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { api } from "../api";
import { CredentialReveal } from "../components/CredentialReveal";
import { Icon, type IconName } from "../components/Icon";
import {
  Avatar,
  Button,
  Card,
  CopyButton,
  Field,
  Notice,
  SectionTitle,
  Sheet,
} from "../components/ui";
import { timeAgo } from "../format";
import { useAction, useEvent } from "./EventContext";
import { useTutorial } from "../tutorial/TutorialProvider";

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

type Panel =
  | "person"
  | "add"
  | "profile"
  | "exports"
  | "settings"
  | "help"
  | "activity"
  | "guest-key"
  | "reissue"
  | "replacement"
  | "new-key"
  | "delete";

export function PeopleTab() {
  const router = useRouter();
  const { view, me, event, name, actAs, showPerson } = useEvent();
  const tutorial = useTutorial();
  const act = useAction();
  const acting = Boolean(view.actingFor);
  const [panel, setPanel] = useState<Panel | null>(null);
  const navigationGeneration = useRef(0);
  const navigate = (next: Panel | null) => {
    navigationGeneration.current += 1;
    setPanel(next);
  };
  const [personId, setPersonId] = useState<string | null>(null);
  const [guestKey, setGuestKey] = useState<string | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [reissuedKey, setReissuedKey] = useState<{
    key: string;
    expiresAt: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const person = view.members.find((m) => m.id === personId);
  const canAdd =
    me.canManageGuests &&
    event.phase === "COLLECTING" &&
    !event.rosterLockedAt &&
    !event.cancelled;
  const hasReports = Boolean(
    view.settlement?.hasReports || view.paymentHistory.length,
  );
  const canManagePerson = Boolean(person?.active && !acting && !person.isOwner);
  const canRemove =
    canManagePerson &&
    person &&
    (me.isOwner || (me.canManageGuests && person.isGuest)) &&
    event.phase === "COLLECTING" &&
    !event.rosterLockedAt &&
    !person.referenced;
  const canAdmin =
    canManagePerson &&
    person &&
    me.isOwner &&
    !person.isGuest &&
    event.phase !== "DONE";
  const canReissue = canManagePerson && person && me.isOwner && !person.isGuest;
  const canHelp = Boolean(
    person?.active && person.isGuest && me.canManageGuests,
  );
  const close = () => {
    navigate(null);
    setEditing(false);
    setGuestKey(null);
    setNewKey(null);
    setReissuedKey(null);
    setIdentityConfirmed(false);
    setConfirmTitle("");
  };
  const parent =
    panel === "reissue" || panel === "replacement" || panel === "guest-key"
      ? "person"
      : panel === "new-key"
        ? "profile"
        : panel === "delete"
          ? "settings"
          : null;
  const back = () => {
    navigate(parent);
    setGuestKey(null);
    setNewKey(null);
    setReissuedKey(null);
    setIdentityConfirmed(false);
    setConfirmTitle("");
  };
  const titles: Record<Panel, string> = {
    person: person?.displayName ?? "Person details",
    add: "Add someone without a phone",
    profile: "Your profile & access",
    exports: "Download event record",
    settings: "Event settings",
    help: "Help & privacy",
    activity: "Activity",
    "guest-key": `Access for ${person?.displayName ?? "guest"}`,
    reissue: `Reissue access for ${person?.displayName ?? "member"}`,
    replacement: `Replacement key for ${person?.displayName ?? "member"}`,
    "new-key": "New recovery key",
    delete: "Delete event",
  };
  const showAmount = (memberId: string) => {
    close();
    showPerson(memberId);
  };

  return (
    <div className="space-y-4" data-testid="people-overview">
      <div className="px-1">
        <h2 className="text-[22px] font-bold">People</h2>
        <p className="text-[14px] text-muted">
          {view.members.filter((m) => m.active).length} on the roster
          {event.rosterLockedAt ? " · locked" : ""}
        </p>
        <p className="mt-1 text-[14px] text-muted">
          Tap a person for their details and options.
        </p>
      </div>
      <Card className="p-0">
        <ul className="divide-y divide-line" aria-label="Event members">
          {view.members.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-label={`View ${m.displayName}`}
                aria-haspopup="dialog"
                aria-describedby={`person-${m.id}-status`}
                className="flex min-h-18 w-full items-center gap-3 rounded-xl px-4 py-3 text-left active:bg-surface-2"
                onClick={() => {
                  setPersonId(m.id);
                  setDisplayName(me.displayName);
                  navigate(m.isMe ? "profile" : "person");
                }}
              >
                <Avatar name={m.displayName} seq={m.seq} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {m.displayName}
                    {m.isMe && (
                      <span className="font-normal text-muted"> (you)</span>
                    )}
                  </span>
                  <span
                    id={`person-${m.id}-status`}
                    className="mt-0.5 block text-[13px] break-words text-muted"
                  >
                    {[
                      m.isOwner
                        ? "Organizer"
                        : m.isAdmin
                          ? "Admin"
                          : m.isGuest
                            ? "No phone"
                            : null,
                      !m.active
                        ? "Inactive"
                        : event.phase === "COLLECTING"
                          ? m.entryComplete
                            ? "Entry done"
                            : "Still entering"
                          : m.isGuest && me.canManageGuests
                            ? "Tap to help"
                            : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Group member"}
                  </span>
                </span>
                <Icon
                  name="chevron"
                  size={18}
                  className="shrink-0 text-muted"
                />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {canAdd && (
        <Button
          full
          variant="secondary"
          icon="plus"
          aria-haspopup="dialog"
          onClick={() => navigate("add")}
        >
          Add someone without a phone
        </Button>
      )}

      <SectionTitle>Your details</SectionTitle>
      <Card className="p-0">
        <PeopleRow
          icon="user"
          title="Your profile & access"
          description={`${me.displayName} · Name, recovery key & big text`}
          onClick={() => {
            setDisplayName(me.displayName);
            navigate("profile");
          }}
        />
      </Card>
      <SectionTitle>Event tools</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {!acting && (
          <PeopleRow
            icon="download"
            title="Download event record"
            description="Save a spreadsheet or full copy"
            onClick={() => navigate("exports")}
          />
        )}
        <PeopleRow
          icon="clock"
          title="Activity"
          description="See who changed what"
          onClick={() => navigate("activity")}
        />
        {me.isOwner && !acting && event.phase !== "DONE" && (
          <PeopleRow
            icon="shield"
            title="Event settings"
            description="Cancel or delete this event"
            onClick={() => navigate("settings")}
          />
        )}
      </Card>
      <Card className="p-0">
        <PeopleRow
          icon="help"
          title="Help & privacy"
          description="Tutorial, recovery and how your data is used"
          onClick={() => navigate("help")}
        />
      </Card>

      <Sheet
        open={panel !== null}
        onClose={close}
        onBack={parent ? back : undefined}
        title={panel ? titles[panel] : "People"}
      >
        {panel === "person" && person && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={person.displayName} seq={person.seq} size={48} />
              <div className="min-w-0">
                <h3 className="break-words text-[22px] font-bold">
                  {person.displayName}
                </h3>
                <p className="text-[14px] text-muted">
                  {person.isOwner
                    ? "Organizer"
                    : person.isAdmin
                      ? "Admin"
                      : person.isGuest
                        ? "Added without a phone"
                        : "Uses their own phone"}
                </p>
              </div>
            </div>
            <Card className="space-y-2 text-[15px]">
              {event.phase === "COLLECTING" && (
                <p>
                  {person.entryComplete
                    ? "✓ Finished entering receipts"
                    : "Still entering receipts"}
                </p>
              )}
              <p className="text-muted">
                Initial plan:{" "}
                {person.intent === "PAID_EXPENSE"
                  ? "paid something"
                  : "pays a share"}
                . Anyone can pay and consume.
              </p>
            </Card>
            {(canHelp || !acting) && (
              <Button
                full
                variant="tonal"
                icon="eye"
                onClick={() => showAmount(person.id)}
              >
                Show amount
              </Button>
            )}
            {canHelp && (
              <>
                <Button
                  full
                  icon="hand"
                  disabled={event.phase === "DONE"}
                  onClick={() => {
                    close();
                    actAs(person.id);
                  }}
                >
                  Act for them
                </Button>
                <p className="text-[14px] text-muted">
                  Show {person.displayName} the screen as you choose their items
                  or record their payments. The history shows you helped.
                </p>
                {event.phase !== "DONE" && (
                  <Button
                    full
                    variant="secondary"
                    icon="key"
                    onClick={async () => {
                      if (
                        !confirm(
                          `Give ${person.displayName} their own access? You’ll get a key for them to open on their own phone. After that, only they can make their choices.`,
                        )
                      )
                        return;
                      const requestGeneration = navigationGeneration.current;
                      const r = await act(() =>
                        api.post<{ recoveryKey: string }>(
                          `/api/events/${event.id}/members/${person.id}/access-key`,
                        ),
                      );
                      if (
                        r &&
                        requestGeneration === navigationGeneration.current
                      ) {
                        setGuestKey(r.recoveryKey);
                        navigate("guest-key");
                      }
                    }}
                  >
                    They got a phone? Give them access
                  </Button>
                )}
              </>
            )}
            {(canAdmin || canReissue) && (
              <div className="space-y-3 border-t border-line pt-4">
                <p className="text-[13px] font-semibold text-muted">
                  Organizer options
                </p>
                {canAdmin && (
                  <Button
                    full
                    variant="secondary"
                    icon="shield"
                    onClick={() =>
                      act(
                        () =>
                          api.post(
                            `/api/events/${event.id}/members/${person.id}/admin`,
                            { isAdmin: !person.isAdmin },
                          ),
                        person.isAdmin
                          ? `${person.displayName} is no longer an admin`
                          : `${person.displayName} can now help with people without a phone`,
                      )
                    }
                  >
                    {person.isAdmin ? "Remove admin" : "Make admin"}
                  </Button>
                )}
                {canReissue && (
                  <Button
                    full
                    variant="secondary"
                    icon="key"
                    aria-label={`Reissue access for ${person.displayName}`}
                    onClick={() => {
                      setIdentityConfirmed(false);
                      navigate("reissue");
                    }}
                  >
                    Lost their key? Reissue access
                  </Button>
                )}
              </div>
            )}
            {canRemove && (
              <div className="border-t border-line pt-4">
                <Button
                  full
                  variant="danger"
                  icon="trash"
                  aria-label={`Remove ${person.displayName}`}
                  onClick={async () => {
                    if (
                      !confirm(
                        `Remove ${person.displayName}? Use this for duplicates or people added by mistake.`,
                      )
                    )
                      return;
                    if (
                      await act(
                        () =>
                          api.del(
                            `/api/events/${event.id}/members/${person.id}`,
                          ),
                        "Removed",
                      )
                    )
                      close();
                  }}
                >
                  Remove from event
                </Button>
              </div>
            )}
          </div>
        )}
        {panel === "add" && <AddGuest onAdded={close} />}
        {panel === "profile" && (
          <div className="space-y-4">
            <Card className="space-y-3">
              {editing ? (
                <form
                  className="space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act(
                        () =>
                          api.patch(`/api/events/${event.id}/me`, {
                            displayName,
                          }),
                        "Name updated",
                      )
                    )
                      setEditing(false);
                  }}
                >
                  <Field label="Display name">
                    {(p) => (
                      <input
                        {...p}
                        className="field"
                        maxLength={40}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        required
                      />
                    )}
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit">Save</Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 break-words">
                    Shown as <b>{me.displayName}</b>
                  </p>
                  {event.phase !== "DONE" && (
                    <Button
                      variant="secondary"
                      icon="edit"
                      onClick={() => setEditing(true)}
                    >
                      Rename
                    </Button>
                  )}
                </div>
              )}
              <Button
                full
                variant="tonal"
                icon="eye"
                onClick={() => showAmount(me.memberId)}
              >
                Show my amount in big text
              </Button>
            </Card>
            {!acting && (
              <Card className="space-y-3">
                <h3 className="font-semibold">Keep your access safe</h3>
                <p className="text-[14px] text-muted">
                  Your recovery key brings back the same you on another phone.
                  If you lost it, make a replacement here and save it privately.
                </p>
                <Button
                  full
                  variant="secondary"
                  icon="key"
                  onClick={async () => {
                    if (
                      !confirm(
                        "Make a new recovery key? Your old key stops working.",
                      )
                    )
                      return;
                    const requestGeneration = navigationGeneration.current;
                    const r = await act(() =>
                      api.post<{ recoveryKey: string }>(
                        `/api/events/${event.id}/recovery-key`,
                      ),
                    );
                    if (
                      r &&
                      requestGeneration === navigationGeneration.current
                    ) {
                      setNewKey(r.recoveryKey);
                      navigate("new-key");
                    }
                  }}
                >
                  New recovery key
                </Button>
              </Card>
            )}
          </div>
        )}
        {panel === "exports" && !acting && (
          <div className="space-y-4">
            <p className="text-[15px] text-muted">
              Download a copy before this event is deleted. These files contain
              the group’s receipts, split and manual payment history. They
              contain no images or recovery keys.
            </p>
            <Card className="divide-y divide-line p-0">
              <a
                href={`/api/events/${event.id}/export?format=csv`}
                className="flex min-h-18 items-center gap-3 px-4 py-3"
              >
                <Icon name="download" className="shrink-0 text-violet" />
                <span className="min-w-0">
                  <span className="block font-semibold">Spreadsheet (CSV)</span>
                  <span className="block text-[14px] text-muted">
                    Open in Excel or Google Sheets
                  </span>
                </span>
              </a>
              <a
                href={`/api/events/${event.id}/export?format=json`}
                className="flex min-h-18 items-center gap-3 px-4 py-3"
              >
                <Icon name="download" className="shrink-0 text-violet" />
                <span className="min-w-0">
                  <span className="block font-semibold">
                    Full record (JSON)
                  </span>
                  <span className="block text-[14px] text-muted">
                    Detailed data for safekeeping
                  </span>
                </span>
              </a>
            </Card>
            <Notice tone="info">
              AteAnne’s manual record is not a bank statement. Every event is
              deleted {event.retentionDays} days after creation.
            </Notice>
          </div>
        )}
        {panel === "settings" &&
          me.isOwner &&
          !acting &&
          event.phase !== "DONE" && (
            <div className="space-y-5">
              <Card className="space-y-3">
                <h3 className="font-semibold">
                  {event.cancelled ? "Reopen event" : "Cancel event"}
                </h3>
                <p className="text-[14px] text-muted">
                  Cancelling never forgives money. Costs or debts stay visible
                  and payments can still be confirmed.
                </p>
                <Button
                  full
                  variant="secondary"
                  onClick={() =>
                    act(
                      () =>
                        api.post(`/api/events/${event.id}/cancel`, {
                          cancelled: !event.cancelled,
                        }),
                      event.cancelled ? "Event reopened" : "Event cancelled",
                    )
                  }
                >
                  {event.cancelled ? "Un-cancel event" : "Cancel event"}
                </Button>
              </Card>
              <Card className="space-y-3">
                <h3 className="font-semibold">Delete permanently</h3>
                <p className="text-[14px] text-muted">
                  Removes the event for everyone, including receipts and photos.
                  Download a copy first.
                </p>
                {hasReports ? (
                  <Notice tone="warn">
                    A payment was reported, so this event’s history must be
                    kept. Download its record instead.
                  </Notice>
                ) : (
                  <Button
                    full
                    variant="danger"
                    icon="trash"
                    onClick={() => navigate("delete")}
                  >
                    Delete event
                  </Button>
                )}
              </Card>
            </div>
          )}
        {panel === "help" && (
          <div className="space-y-5">
            <Card className="space-y-3">
              <h3 className="font-semibold">New to AteAnne?</h3>
              <p className="text-[14px] text-muted">
                A one-minute walkthrough, from joining to settling.
              </p>
              <Button
                full
                variant="secondary"
                icon="help"
                onClick={() => {
                  close();
                  tutorial.open();
                }}
              >
                Tutorial: how to use AteAnne
              </Button>
            </Card>
            <Card className="space-y-3 text-[15px]">
              <h3 className="font-semibold">Access & recovery</h3>
              <p>
                This browser is you. Your personal recovery key moves the same
                membership to another phone without changing your receipts or
                payments.
              </p>
              <p>
                Lost the key too? Ask the organizer in person. Their replacement
                key expires in 15 minutes and grants access to your membership,
                including payment confirmations.
              </p>
              <p className="text-muted">
                Keep keys private. Never post one in the group chat.
              </p>
            </Card>
            <Card className="space-y-3 text-[15px]">
              <h3 className="font-semibold">How identity works here</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  A forwarded join code lets anyone join until the roster locks.
                  The organizer checks names and removes duplicates first. Names
                  can repeat.
                </li>
                <li>
                  A different browser joins as a new person unless you use your
                  recovery key.
                </li>
                <li>
                  The organizer or an admin can help people explicitly added
                  without a phone. The history records who helped. Phone members
                  make their own choices.
                </li>
                <li>
                  Payments happen outside AteAnne; only the recipient confirms
                  receiving money.
                </li>
                <li>
                  Corrections keep confirmed money and prior statements. Resolve
                  pending reports and disputes first, then everyone approves
                  again.
                </li>
              </ul>
            </Card>
            <Card className="space-y-3 text-[15px]">
              <h3 className="font-semibold">Your data & privacy</h3>
              <p>
                Group members can see the shared financial statement. Receipts
                and QR images are private to authorized members; AteAnne does
                not collect bank passwords or contacts.
              </p>
              <p>
                Every event is deleted {event.retentionDays} days after
                creation, even if unfinished. Download its record before then.
                Deleting a record does not cancel real-world debt.
              </p>
            </Card>
          </div>
        )}
        {panel === "activity" && (
          <div className="space-y-3">
            <p className="text-[14px] text-muted">
              Recent changes, newest first.
            </p>
            <Card className="p-0">
              <ul className="divide-y divide-line text-[14px]">
                {view.audit.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 break-words">
                      <b>
                        {a.actorMemberId ? name(a.actorMemberId) : "System"}
                      </b>{" "}
                      {AUDIT_TEXT[a.type] ?? a.type}
                      {a.type === "member.access_reissued" &&
                        a.detail &&
                        typeof a.detail === "object" &&
                        !Array.isArray(a.detail) &&
                        typeof a.detail.memberId === "string" && (
                          <span> for {name(a.detail.memberId)}</span>
                        )}
                      {a.onBehalfOf && <span> for {name(a.onBehalfOf)}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {timeAgo(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {!view.audit.length && (
                <p className="p-4 text-muted">No changes yet.</p>
              )}
            </Card>
          </div>
        )}
        {panel === "guest-key" && guestKey && person && (
          <div className="space-y-4">
            <Notice tone="info" title={`On ${person.displayName}’s phone`}>
              Open AteAnne, tap <b>I have a recovery key</b>, and paste this
              key. From then on {person.displayName} makes their own choices,
              with the same items and payments.
            </Notice>
            <CredentialReveal
              recoveryKey={guestKey}
              onDone={back}
              doneLabel="Done"
            />
          </div>
        )}
        {panel === "reissue" && canReissue && person && (
          <div className="space-y-4">
            <Notice tone="pay" title="Check who you are giving access to">
              Only do this with {person.displayName} present. Anyone with this
              key can use their membership, including confirming payments. Their
              receipts, items and payment history stay the same.
            </Notice>
            <p className="text-[14px] text-muted">
              The new key expires in 15 minutes and replaces their old recovery
              key. Their old phone loses access when the replacement is used.
              Add AteAnne to their Home Screen first, then enter the key there.
            </p>
            <label className="flex min-h-12 items-center gap-3 text-[15px]">
              <input
                type="checkbox"
                className="size-5 shrink-0"
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
              />
              I have checked that this is {person.displayName} in person
            </label>
            <Button
              full
              icon="key"
              disabled={!identityConfirmed}
              onClick={async () => {
                const requestGeneration = navigationGeneration.current;
                const r = await act(() =>
                  api.post<{ recoveryKey: string; expiresAt: string }>(
                    `/api/events/${event.id}/members/${person.id}/recovery-key`,
                    { identityConfirmed: true },
                  ),
                );
                if (r && requestGeneration === navigationGeneration.current) {
                  setReissuedKey({
                    key: r.recoveryKey,
                    expiresAt: r.expiresAt,
                  });
                  navigate("replacement");
                }
              }}
            >
              Make replacement key
            </Button>
          </div>
        )}
        {panel === "replacement" && reissuedKey && person && (
          <div className="space-y-4">
            <Notice tone="info" title={`On ${person.displayName}’s phone`}>
              Open AteAnne from the Home Screen, tap{" "}
              <b>I have a recovery key</b>, and paste this key. Use it before{" "}
              {new Date(reissuedKey.expiresAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . They will receive their own new recovery key to save.
            </Notice>
            <p
              className="rounded-xl border border-dashed border-line bg-surface-2 p-3 font-mono text-[14px] break-all select-all"
              data-testid="replacement-key"
            >
              {reissuedKey.key}
            </p>
            <CopyButton text={reissuedKey.key} label="Copy replacement key" />
            <Notice tone="warn">
              Give this key privately to {person.displayName}. It grants their
              access; don’t post it in the group chat or keep a copy.
            </Notice>
            <Button full onClick={back}>
              Done
            </Button>
          </div>
        )}
        {panel === "new-key" && newKey && !acting && (
          <CredentialReveal
            recoveryKey={newKey}
            onDone={back}
            doneLabel="Done"
          />
        )}
        {panel === "delete" &&
          me.isOwner &&
          !acting &&
          !hasReports &&
          event.phase !== "DONE" && (
            <div className="space-y-4">
              <Notice
                tone="pay"
                title="This permanently deletes the event for everyone"
              >
                Receipts, claims, photos and history are destroyed. Deleting
                records does not cancel any real-world debt. Exported files and
                backups may still exist.
              </Notice>
              <Field label={`Type “${event.title}” to confirm`}>
                {(p) => (
                  <input
                    {...p}
                    className="field"
                    value={confirmTitle}
                    onChange={(e) => setConfirmTitle(e.target.value)}
                  />
                )}
              </Field>
              <Button
                full
                variant="danger"
                disabled={confirmTitle.trim() !== event.title}
                onClick={async () => {
                  if (
                    await act(
                      () =>
                        api.del(`/api/events/${event.id}`, { confirmTitle }),
                      "Event deleted",
                    )
                  )
                    router.replace("/");
                }}
              >
                Delete forever
              </Button>
            </div>
          )}
      </Sheet>
    </div>
  );
}

/** A familiar settings row: label and hint remain visible; details open on demand. */
function PeopleRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      aria-label={title}
      aria-describedby={hintId}
      aria-haspopup="dialog"
      onClick={onClick}
      className="flex min-h-18 w-full items-center gap-3 rounded-xl px-4 py-3 text-left active:bg-surface-2"
    >
      <Icon name={icon} className="shrink-0 text-violet" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span
          id={hintId}
          className="mt-0.5 block text-[13px] break-words text-muted"
        >
          {description}
        </span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </button>
  );
}

function AddGuest({ onAdded }: { onAdded: () => void }) {
  const { event, view } = useEvent();
  const act = useAction();
  const [name, setName] = useState("");
  const full = view.members.filter((m) => m.active).length >= 20;
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-muted">
        For a lola, a kid, or anyone with no phone or data. You (or an admin)
        claim their items and record their payments for them, then show them
        their amount in big text.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (
            await act(
              () =>
                api.post(`/api/events/${event.id}/guests`, {
                  displayName: name.trim(),
                }),
              `${name.trim()} added`,
            )
          )
            onAdded();
        }}
      >
        <Field label="Name of person without a phone">
          {(p) => (
            <input
              {...p}
              className="field"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lola Nena"
              disabled={full}
              required
            />
          )}
        </Field>
        {full && <Notice tone="warn">This event already has 20 people.</Notice>}
        <Button full type="submit" icon="plus" disabled={full || !name.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
