"use client";

import { useState } from "react";
import type { Phase } from "@/domain/event/PhaseMachine";
import { api } from "../api";
import { ShareJoin } from "../components/CredentialReveal";
import { Icon } from "../components/Icon";
import { BalanceBanner, Blockers, Button, Card, Notice, SectionTitle, useToast } from "../components/ui";
import { php } from "../format";
import { TabId, useAction, useEvent } from "./EventContext";
import { pendingFor } from "./todo";
import { ReminderPanel } from "./ReminderPanel";

export function OverviewTab() {
  const { view, me, event, setTab } = useEvent();
  const phase = event.phase;
  const myPos = view.settlement?.positions.find((p) => p.memberId === me.memberId);
  const estimate = view.calculation.ok ? view.calculation.positions.find((p) => p.memberId === me.memberId) : null;

  return (
    <div className="space-y-4">
      {myPos ? (
        <BalanceBanner net={myPos.remaining} caption={phase === "DONE" ? "Everything was confirmed received." : `Paid ${php(myPos.funding)} · your share ${php(myPos.cost)} · frozen statement`} />
      ) : estimate && phase !== "COLLECTING" ? (
        <BalanceBanner net={estimate.remaining} estimate caption={`Paid ${php(estimate.funding)} · your share so far ${php(estimate.cost)} · confirmed payments included`} />
      ) : null}

      {view.actingFor && (
        <Notice tone="warn" title={`You’re choosing for ${me.displayName}`}>
          Everything you do now is saved as {me.displayName}’s choice, and the history shows you did it for them. Show them the screen as you go, then tap <b>Done</b> at the top.
        </Notice>
      )}

      <MyTodo phase={phase} onGo={setTab} />

      <ReminderPanel />

      {me.canManageGuests && <GuestsPanel />}

      <DeletionNotice />

      {event.note && (
        <Card>
          <p className="text-[14px] font-semibold text-muted">Note from the organizer</p>
          <p className="mt-1 whitespace-pre-wrap">{event.note}</p>
        </Card>
      )}

      {me.isOwner && <OrganizerPanel />}

      {!me.isOwner && !view.actingFor && phase !== "DONE" && (
        <Notice tone="info">
          The organizer moves the group to the next step once everyone is ready. Nobody can claim items or confirm payments for you; that is only done for people added without a phone.
        </Notice>
      )}

      {phase === "COLLECTING" && <EntryCompleteToggle />}
    </div>
  );
}

/** Every event auto-deletes N days after creation; warn clearly, louder in the last week. */
function DeletionNotice() {
  const { event, setTab } = useEvent();
  const deletesAt = new Date(event.deletesAt);
  const daysLeft = event.daysUntilDeletion;
  const date = deletesAt.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  const soon = daysLeft <= 7;
  return (
    <Notice tone={soon ? "warn" : "info"} title={soon ? `Deletes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${date})` : `Auto-deletes on ${date}`}>
      <p>
        Every event is deleted {event.retentionDays} days after it was created{event.phase === "DONE" ? "" : ", even if it isn’t finished"}. Deleting the record doesn’t cancel what people owe.{" "}
        <button type="button" onClick={() => setTab("people")} className="font-semibold text-violet underline underline-offset-2">
          Export a copy
        </button>
      </p>
    </Notice>
  );
}

/** Optimistic toggle: flips immediately, rolls back if the server refuses. */
function EntryCompleteToggle() {
  const { me, event } = useEvent();
  const act = useAction();
  const [checked, setChecked] = useState(me.entryComplete);
  const [synced, setSynced] = useState(me.entryComplete);
  if (synced !== me.entryComplete) {
    setSynced(me.entryComplete);
    setChecked(me.entryComplete);
  }
  return (
    <label className="card flex min-h-14 items-center gap-3 p-4">
      <input
        type="checkbox"
        className="size-6 accent-[var(--violet)]"
        checked={checked}
        disabled={event.cancelled}
        onChange={async (e) => {
          const next = e.target.checked;
          setChecked(next);
          const ok = await act(() => api.patch(`/api/events/${event.id}/me`, { entryComplete: next }), next ? "Marked done entering" : "Reopened your entry");
          if (ok === undefined) setChecked(!next);
        }}
      />
      <span>
        <span className="block font-semibold">I’ve entered every receipt I paid</span>
        <span className="block text-[14px] text-muted">Tick this even if you paid nothing.</span>
      </span>
    </label>
  );
}

function MyTodo({ phase, onGo }: { phase: Phase; onGo: (t: TabId) => void }) {
  const { view, me } = useEvent();
  const items: { done: boolean; text: string; tab: TabId }[] = [];
  if (phase === "COLLECTING") {
    for (const r of view.receipts.filter((x) => x.payerId === me.memberId)) items.push({ done: r.fundingAcknowledged, text: `Confirm you paid ${php(r.payable)} for “${r.label}”`, tab: "receipts" });
    items.push({ done: me.entryComplete, text: "Add the receipts you paid, then mark entry complete", tab: "receipts" });
  } else if (phase === "ALLOCATING") {
    for (const r of view.receipts) {
      const ack = r.acks.find((a) => a.memberId === me.memberId);
      items.push({ done: Boolean(ack?.kind && !ack.stale), text: `Claim what you had from “${r.label}”`, tab: "claim" });
    }
  } else if (phase === "REVIEWING") {
    items.push({ done: view.review.approvedByMe, text: `Check and approve the split (version ${view.event.financialVersion})`, tab: "money" });
  } else if (phase === "SETTLING" && view.settlement) {
    for (const e of view.settlement.edges) {
      if (e.from === me.memberId) items.push({ done: e.settled, text: `Pay ${php(e.outstanding === "0" ? e.amount : e.outstanding)} to ${view.members.find((m) => m.id === e.to)?.displayName}`, tab: "money" });
      if (e.to === me.memberId && e.reports.some((r) => r.status === "REPORTED")) items.push({ done: false, text: `Confirm money from ${view.members.find((m) => m.id === e.from)?.displayName}`, tab: "money" });
    }
    if (!view.instructions[me.memberId] && view.settlement.edges.some((e) => e.to === me.memberId)) items.push({ done: false, text: "Share how you want to be paid (cash or QR)", tab: "money" });
  }
  if (!items.length) {
    return (
      <Notice tone="receive" title={phase === "DONE" ? "This hatian is done" : "Nothing for you right now"}>
        {phase === "DONE" ? "All transfers were confirmed by the people who received them. This event is now read-only." : "Waiting on others. We’ll refresh automatically."}
      </Notice>
    );
  }
  return (
    <>
      <SectionTitle>Your to-do</SectionTitle>
      <ul className="card divide-y divide-line p-0">
        {items.map((it, i) => (
          <li key={i}>
            <button type="button" onClick={() => onGo(it.tab)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
              <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${it.done ? "bg-receive text-white dark:text-black" : "border-2 border-line"}`}>
                {it.done && <Icon name="check" size={16} label="done" />}
              </span>
              <span className={`flex-1 text-[15px] ${it.done ? "text-muted line-through" : "font-medium"}`}>{it.text}</span>
              <Icon name="chevron" size={18} className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function OrganizerPanel() {
  const { view, event } = useEvent();
  const act = useAction();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const move = async (target: Phase, label: string, reason?: string) => {
    setBusy(true);
    await act(() => api.post(`/api/events/${event.id}/phase`, { target, expectedFinancialVersion: event.financialVersion, reason }), label);
    setBusy(false);
  };
  const g = view.gates;
  const reopenAllowed = event.phase === "SETTLING" && view.settlement && g.correcting?.ready;

  return (
    <>
      <SectionTitle>Organizer</SectionTitle>
      {event.phase === "COLLECTING" && (
        <Card className="space-y-3">
          {event.joinsOpen && event.joinCode ? (
            <>
              <div className="flex items-center justify-between">
                <p className="font-semibold">Join code</p>
                <span className="text-[13px] text-muted">expires {new Date(event.joinCodeExpiresAt!).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}</span>
              </div>
              <p className="tnum rounded-2xl bg-violet-soft py-3 text-center font-mono text-[24px] font-bold tracking-[0.12em] text-violet" data-testid="join-code">
                {event.joinCode}
              </p>
              <ShareJoin code={event.joinCode} />
              <div className="flex gap-2">
                <Button variant="tonal" className="flex-1" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "New code created; the old one stopped working")}>
                  New code
                </Button>
                <Button variant="tonal" className="flex-1" onClick={() => act(() => api.del(`/api/events/${event.id}/code`), "Joining closed")}>
                  Close joining
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] text-muted">Joining is closed.</p>
              {!event.cancelled && !event.rosterLockedAt && (
                <Button variant="secondary" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "Joining reopened with a new code")}>
                  Reopen with new code
                </Button>
              )}
            </div>
          )}
          <p className="text-[13px] text-muted">{view.members.filter((m) => m.active).length} of 20 people · check the roster in People before locking it.</p>
        </Card>
      )}

      {event.phase === "COLLECTING" && (
        <Card className="space-y-3">
          <p className="font-semibold">Lock roster & start claiming</p>
          <p className="text-[14px] text-muted">After this nobody new can join, and receipts can only change by stepping back.</p>
          <Blockers items={g.allocating.blockers} />
          <Button full busy={busy} disabled={!g.allocating.ready || event.cancelled} onClick={() => void move("ALLOCATING", "Roster locked — time to claim")}>
            <Icon name="lock" size={18} /> Lock roster & start claiming
          </Button>
        </Card>
      )}

      {event.phase === "ALLOCATING" && g.reviewing && (
        <Card className="space-y-3">
          <p className="font-semibold">Move to review</p>
          <Blockers items={g.reviewing.blockers} />
          <Button full busy={busy} disabled={!g.reviewing.ready || event.cancelled} onClick={() => void move("REVIEWING", "Everyone can now review the split")}>
            Start review
          </Button>
          <Button full variant="tonal" busy={busy} onClick={() => void move("COLLECTING", "Back to collecting receipts")}>
            Back to receipts (fix a receipt)
          </Button>
        </Card>
      )}

      {event.phase === "REVIEWING" && g.settling && (
        <Card className="space-y-3">
          <p className="font-semibold">Freeze the statement</p>
          <p className="text-[14px] text-muted">Freezing locks version {event.financialVersion} and the transfers. A later correction keeps this statement and confirmed payments, and needs everyone’s approval again.</p>
          <Blockers items={g.settling.blockers} />
          <Button full busy={busy} disabled={!g.settling.ready || event.cancelled} onClick={() => void move("SETTLING", "Frozen — time to settle")}>
            <Icon name="lock" size={18} /> Freeze & start settling
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="tonal" busy={busy} onClick={() => void move("ALLOCATING", "Back to claiming")}>
              Back to claims
            </Button>
            <Button variant="tonal" busy={busy} onClick={() => void move("COLLECTING", "Back to receipts")}>
              Back to receipts
            </Button>
          </div>
        </Card>
      )}

      {event.phase === "SETTLING" && g.done && (
        <Card className="space-y-3">
          <p className="font-semibold">Close the event</p>
          <Blockers items={g.done.blockers} title="Not settled yet" />
          <Button full variant="receive" busy={busy} disabled={!g.done.ready} onClick={() => void move("DONE", "Done! Everything is settled.")}>
            <Icon name="check" size={18} /> Mark as Done
          </Button>
          {reopenAllowed && (
            <Button full variant="tonal" busy={busy} onClick={() => {
              const reason = prompt("Why does the bill need a correction? Confirmed payments will carry forward. Correct any mistaken payment confirmations first; prior statements become read-only.");
              if (reason === null) return;
              if (reason.trim().length < 3 || reason.trim().length > 300) {
                toast("Enter a correction reason between 3 and 300 characters.", "error");
                return;
              }
              void move("REVIEWING", "Reopened for correction; prior payments and statement are preserved", reason.trim());
            }}>
              Correct the bill
            </Button>
          )}
          {!reopenAllowed && <Blockers items={g.correcting?.blockers ?? []} title="Before correcting the bill" />}
          <p className="text-[13px] text-muted">Corrections preserve prior statements and confirmed money. They create a new review for everyone; overpayments become return transfers. Done events stay read-only.</p>
        </Card>
      )}
    </>
  );
}

/** Organizer/admin: everyone added without a phone, what they're waiting on, and a one-tap way to act for them. */
function GuestsPanel() {
  const { view, actAs, showPerson, setTab } = useEvent();
  const guests = view.members.filter((m) => m.isGuest && m.active);
  if (guests.length === 0) {
    if (view.event.phase !== "COLLECTING" || view.event.rosterLockedAt) return null;
    return (
      <Card className="flex items-center gap-3">
        <Icon name="user" className="text-violet" />
        <p className="flex-1 text-[15px]">Someone at the table has no phone or no data?</p>
        <Button variant="secondary" onClick={() => setTab("people")}>
          Add them
        </Button>
      </Card>
    );
  }
  return (
    <>
      <SectionTitle>People without a phone</SectionTitle>
      <ul className="card divide-y divide-line p-0" data-testid="guests-panel">
        {guests.map((g) => {
          const todo = pendingFor(view, g.id);
          return (
            <li key={g.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold">{g.displayName}</p>
                {todo.length === 0 ? <span className="text-[13px] font-semibold text-receive">✓ nothing to do</span> : <span className="text-[13px] font-semibold text-coral">{todo.length} to do</span>}
              </div>
              {todo.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-[14px] text-muted">
                  {todo.slice(0, 3).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="tonal" icon="eye" onClick={() => showPerson(g.id)}>
                  Show amount
                </Button>
                <Button variant={todo.length ? "primary" : "secondary"} icon="hand" disabled={view.event.phase === "DONE"} onClick={() => actAs(g.id)}>
                  Act for {g.displayName.split(" ")[0]}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
