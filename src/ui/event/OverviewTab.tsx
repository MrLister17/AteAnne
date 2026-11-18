"use client";

import { useState } from "react";
import type { Phase } from "@/domain/event/PhaseMachine";
import { api } from "../api";
import { ShareJoin } from "../components/CredentialReveal";
import { Icon, IconName } from "../components/Icon";
import { BalanceBanner, Blockers, Button, Card, Disclosure, Notice, SectionTitle, useToast } from "../components/ui";
import { php } from "../format";
import { TabId, useAction, useEvent, View } from "./EventContext";
import { pendingFor } from "./todo";
import { ReminderButton } from "./ReminderPanel";

/**
 * The event's Home tab, in reading order (D48):
 *   1. you: balance, your to-do (with the "entered every receipt" tick), the organizer's note
 *   2. the group: the one next step, what it is waiting on, and a reminder to copy
 *   3. organizer tools: invite people, people without a phone
 *   4. fine print: when the event auto-deletes
 * Rarely needed controls (go back a step, correct the bill, new join code)
 * sit one tap away behind plainly worded rows, never removed.
 */
export function OverviewTab() {
  const { view, me, event, setTab } = useEvent();
  const phase = event.phase;
  const myPos = view.settlement?.positions.find((p) => p.memberId === me.memberId);
  const estimate = view.calculation.ok ? view.calculation.positions.find((p) => p.memberId === me.memberId) : null;
  const deletesSoon = event.daysUntilDeletion <= 7;

  return (
    <div className="space-y-4">
      {myPos ? (
        <BalanceBanner net={myPos.remaining} caption={phase === "DONE" ? "Everything was confirmed received." : `Paid ${php(myPos.funding)} · your share ${php(myPos.cost)} · frozen statement`} />
      ) : estimate && phase !== "COLLECTING" ? (
        <BalanceBanner net={estimate.remaining} estimate caption={`Paid ${php(estimate.funding)} · your share so far ${php(estimate.cost)} · confirmed payments included`} />
      ) : null}

      {deletesSoon && <DeletionNotice />}

      {view.actingFor && (
        <Notice tone="warn" title={`You’re choosing for ${me.displayName}`}>
          Show them the screen as you go. The history records that you did it for them.
        </Notice>
      )}

      <MyTodo phase={phase} onGo={setTab} />

      {event.note && (
        <Card>
          <p className="text-[14px] font-semibold text-muted">Note from the organizer</p>
          <p className="mt-1 whitespace-pre-wrap">{event.note}</p>
        </Card>
      )}

      <NextStep />

      {me.isOwner && phase === "COLLECTING" && <InviteCard />}

      {me.canManageGuests && <GuestsPanel />}

      {!deletesSoon && <DeletionNotice quiet />}
    </div>
  );
}

/** Every event auto-deletes N days after creation: a quiet line at the bottom, a warning at the top in the last week. */
function DeletionNotice({ quiet = false }: { quiet?: boolean }) {
  const { event, setTab } = useEvent();
  const deletesAt = new Date(event.deletesAt);
  const daysLeft = event.daysUntilDeletion;
  const date = deletesAt.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  const exportLink = (
    <button type="button" onClick={() => setTab("people")} className="inline-flex min-h-11 items-center font-semibold text-violet underline underline-offset-2">
      Export a copy
    </button>
  );
  if (quiet) {
    return (
      <p className="px-1 pt-2 text-center text-[13px] text-muted">
        Auto-deletes {date} · {exportLink}
      </p>
    );
  }
  return (
    <Notice tone="warn" title={`Deletes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${date})`}>
      <p>
        Every event is deleted {event.retentionDays} days after it was created{event.phase === "DONE" ? "" : ", even if it isn’t finished"}. Deleting the record doesn’t cancel what people owe. {exportLink}
      </p>
    </Notice>
  );
}

/** Optimistic toggle: flips immediately, rolls back if the server refuses. Rendered as the last row of "Your to-do". */
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
    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3">
      <input
        type="checkbox"
        className="size-7 shrink-0 accent-[var(--violet)]"
        checked={checked}
        disabled={event.cancelled}
        onChange={async (e) => {
          const next = e.target.checked;
          setChecked(next);
          const ok = await act(() => api.patch(`/api/events/${event.id}/me`, { entryComplete: next }), next ? "Marked done entering" : "Reopened your entry");
          if (ok === undefined) setChecked(!next);
        }}
      />
      <span className="flex-1">
        <span className={`block text-[15px] ${checked ? "text-muted" : "font-medium"}`}>I’ve entered every receipt I paid</span>
        <span className="block text-[14px] text-muted">Add yours in Receipts first. Tick this even if you paid nothing.</span>
      </span>
    </label>
  );
}

function MyTodo({ phase, onGo }: { phase: Phase; onGo: (t: TabId) => void }) {
  const { view, me } = useEvent();
  const items: { done: boolean; text: string; tab: TabId }[] = [];
  if (phase === "COLLECTING") {
    for (const r of view.receipts.filter((x) => x.payerId === me.memberId)) items.push({ done: r.fundingAcknowledged, text: `Confirm you paid ${php(r.payable)} for “${r.label}”`, tab: "receipts" });
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
  const collecting = phase === "COLLECTING";
  if (!items.length && !collecting) {
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
        {collecting && (
          <li>
            <EntryCompleteToggle />
          </li>
        )}
      </ul>
    </>
  );
}

type Move = { target: Phase; label: string; success: string };
type Step = {
  title: string;
  detail: string;
  gate: { ready: boolean; blockers: string[] } | null | undefined;
  blockersTitle?: string;
  action: Move & { icon?: IconName; variant?: "primary" | "receive" };
  back: Move[];
};

/** The one thing the whole group is working towards next, from the server-computed gates. */
function stepFor(view: View): Step | null {
  const g = view.gates;
  switch (view.event.phase) {
    case "COLLECTING":
      return {
        title: "Lock the roster and start claiming",
        detail: "After this nobody new can join, and receipts can only change by stepping back.",
        gate: g.allocating,
        action: { target: "ALLOCATING", label: "Lock roster & start claiming", success: "Roster locked — time to claim", icon: "lock" },
        back: [],
      };
    case "ALLOCATING":
      return {
        title: "Review the split",
        detail: "Once everyone has claimed, each person checks their share and approves it.",
        gate: g.reviewing,
        action: { target: "REVIEWING", label: "Start review", success: "Everyone can now review the split" },
        back: [{ target: "COLLECTING", label: "Back to receipts (fix a receipt)", success: "Back to collecting receipts" }],
      };
    case "REVIEWING":
      return {
        title: "Freeze the statement and settle up",
        detail: `Freezing locks version ${view.event.financialVersion} and the transfers. A later correction needs everyone’s approval again.`,
        gate: g.settling,
        action: { target: "SETTLING", label: "Freeze & start settling", success: "Frozen — time to settle", icon: "lock" },
        back: [
          { target: "ALLOCATING", label: "Back to claims", success: "Back to claiming" },
          { target: "COLLECTING", label: "Back to receipts", success: "Back to receipts" },
        ],
      };
    case "SETTLING":
      return {
        title: "Close the event",
        detail: "Mark it Done once every transfer is confirmed by the person who received it.",
        gate: g.done,
        blockersTitle: "Not settled yet",
        action: { target: "DONE", label: "Mark as Done", success: "Done! Everything is settled.", icon: "check", variant: "receive" },
        back: [],
      };
    default:
      return null;
  }
}

/** Everyone sees what the group is waiting on; only the organizer gets the buttons that move it. */
function NextStep() {
  const { view, me, event } = useEvent();
  const act = useAction();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const step = stepFor(view);
  if (!step || !step.gate) return null;
  const owner = me.isOwner;
  const organizer = view.members.find((m) => m.isOwner)?.displayName ?? "The organizer";
  const move = async (target: Phase, label: string, reason?: string) => {
    setBusy(true);
    await act(() => api.post(`/api/events/${event.id}/phase`, { target, expectedFinancialVersion: event.financialVersion, reason }), label);
    setBusy(false);
  };
  const correcting = view.gates.correcting;
  const reopenAllowed = event.phase === "SETTLING" && view.settlement && correcting?.ready;

  return (
    <>
      <SectionTitle>Next step</SectionTitle>
      <Card className="space-y-3">
        <div>
          <p className="text-[17px] font-semibold">{step.title}</p>
          <p className="mt-0.5 text-[14px] text-muted">{owner ? step.detail : `${organizer}, the organizer, moves everyone on when it’s ready.`}</p>
        </div>
        <Blockers items={step.gate.blockers} title={step.blockersTitle ?? (owner ? "Still needed" : "Waiting on")} limit={3} quiet />
        {owner && (
          <Button full variant={step.action.variant ?? "primary"} icon={step.action.icon} busy={busy} disabled={!step.gate.ready || event.cancelled} onClick={() => void move(step.action.target, step.action.success)}>
            {step.action.label}
          </Button>
        )}
        <ReminderButton />

        {owner && step.back.length > 0 && (
          <Disclosure summary="Need to fix something? Go back a step" className="border-t border-line pt-1">
            <div className={`grid gap-2 ${step.back.length > 1 ? "grid-cols-2" : ""}`}>
              {step.back.map((b) => (
                <Button key={b.target} variant="tonal" busy={busy} onClick={() => void move(b.target, b.success)}>
                  {b.label}
                </Button>
              ))}
            </div>
          </Disclosure>
        )}

        {owner && event.phase === "SETTLING" && (
          <Disclosure summary="Something wrong with the bill?" className="border-t border-line pt-1">
            <p className="text-[14px] text-muted">A correction keeps earlier statements and confirmed money. It starts a new review for everyone, and overpayments become return transfers. Done events stay read-only.</p>
            {reopenAllowed ? (
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
            ) : (
              <Blockers items={correcting?.blockers ?? []} title="Before correcting the bill" />
            )}
          </Disclosure>
        )}
      </Card>
    </>
  );
}

/** Organizer, while collecting: the join code up front; rarely used code controls one tap away. */
function InviteCard() {
  const { view, me, event, setTab } = useEvent();
  const act = useAction();
  const people = view.members.filter((m) => m.active).length;
  const noGuests = !view.members.some((m) => m.isGuest && m.active);
  const addGuest = me.canManageGuests && noGuests && !event.rosterLockedAt && (
    <button type="button" onClick={() => setTab("people")} className="flex min-h-11 w-full items-center gap-2 text-left text-[15px] font-semibold text-violet">
      <Icon name="user" size={18} className="shrink-0" />
      <span className="flex-1">Someone without a phone? Add them in People</span>
      <Icon name="chevron" size={18} className="shrink-0" />
    </button>
  );

  return (
    <>
      <SectionTitle>Invite people</SectionTitle>
      <Card className="space-y-3">
        {event.joinsOpen && event.joinCode ? (
          <>
            <p className="tnum rounded-2xl bg-violet-soft py-3 text-center font-mono text-[24px] font-bold tracking-[0.12em] text-violet" data-testid="join-code" aria-label={`Join code ${event.joinCode}`}>
              {event.joinCode}
            </p>
            <ShareJoin code={event.joinCode} />
            <p className="text-[13px] text-muted">
              {people} of 20 people joined · code expires {new Date(event.joinCodeExpiresAt!).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}. Check names in People before locking.
            </p>
            {addGuest}
            <Disclosure summary="More join options" className="border-t border-line pt-1">
              <p className="text-[14px] text-muted">A new code stops the old one from working. Closing joining keeps everyone already in.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="tonal" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "New code created; the old one stopped working")}>
                  New code
                </Button>
                <Button variant="tonal" onClick={() => act(() => api.del(`/api/events/${event.id}/code`), "Joining closed")}>
                  Close joining
                </Button>
              </div>
            </Disclosure>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] text-muted">Joining is closed · {people} people</p>
              {!event.cancelled && !event.rosterLockedAt && (
                <Button variant="secondary" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "Joining reopened with a new code")}>
                  Reopen with new code
                </Button>
              )}
            </div>
            {addGuest}
          </>
        )}
      </Card>
    </>
  );
}

/** Organizer/admin: everyone added without a phone, what they're waiting on, and a one-tap way to act for them. */
function GuestsPanel() {
  const { view, me, actAs, showPerson, setTab } = useEvent();
  const guests = view.members.filter((m) => m.isGuest && m.active);
  if (guests.length === 0) {
    // The organizer gets this link inside "Invite people"; admins get it here.
    if (me.isOwner || view.event.phase !== "COLLECTING" || view.event.rosterLockedAt) return null;
    return (
      <button type="button" onClick={() => setTab("people")} className="card flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-violet">
        <Icon name="user" size={20} className="shrink-0" />
        <span className="flex-1">Someone without a phone? Add them in People</span>
        <Icon name="chevron" size={18} className="shrink-0" />
      </button>
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
              {todo.length === 0 ? (
                <div className="flex min-h-11 items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-semibold">{g.displayName}</p>
                  <span className="text-[13px] font-semibold text-receive">✓ nothing to do</span>
                </div>
              ) : (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1 truncate font-semibold">{g.displayName}</span>
                    <span className="text-[13px] font-semibold text-coral">{todo.length} to do</span>
                    <Icon name="chevron" size={16} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                  </summary>
                  <ul className="list-disc space-y-0.5 pt-1 pb-1 pl-5 text-[14px] text-muted">
                    {todo.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="tonal" onClick={() => showPerson(g.id)}>
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
