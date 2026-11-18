"use client";

import { useState } from "react";
import type { Phase } from "@/domain/event/PhaseMachine";
import { api } from "../api";
import { ShareJoin } from "../components/CredentialReveal";
import { Icon } from "../components/Icon";
import { BalanceBanner, Blockers, Button, Card, Disclosure, Notice, SectionTitle, useToast } from "../components/ui";
import { php } from "../format";
import { TabId, useAction, useEvent } from "./EventContext";
import { everyoneAnswered, pendingFor } from "./todo";
import { ReminderButton } from "./ReminderPanel";

/**
 * The event's Home tab, in reading order (D48, D49):
 *   1. you: balance, what's left for you to do (with the "entered every receipt" tick), the organizer's note
 *   2. organizer, while people can still join: invite them, then "Everyone's here"
 *   3. the group: what happens next and what it is waiting on; it moves on by itself
 *   4. people without a phone, and the auto-delete date as fine print
 * Rarely needed controls (correct the bill, new join code) sit one tap away
 * behind plainly worded rows, never removed.
 */
export function OverviewTab() {
  const { view, me, event, setTab } = useEvent();
  const phase = event.phase;
  const myPos = view.settlement?.positions.find((p) => p.memberId === me.memberId);
  // An estimate only once everyone has answered; until then the first claimant would look like they owe everything.
  const estimate = view.calculation.ok && everyoneAnswered(view) ? view.calculation.positions.find((p) => p.memberId === me.memberId) : null;
  const deletesSoon = event.daysUntilDeletion <= 7;
  const rosterOpen = phase === "COLLECTING" && !event.rosterLockedAt;

  return (
    <div className="space-y-4">
      {myPos ? (
        <BalanceBanner net={myPos.remaining} caption={phase === "DONE" ? "Everything was confirmed received." : `Paid ${php(myPos.funding)} · your share ${php(myPos.cost)} · frozen bill`} />
      ) : estimate ? (
        <BalanceBanner net={estimate.remaining} estimate caption={`Paid ${php(estimate.funding)} · your share so far ${php(estimate.cost)} · can change until everyone is done`} />
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

      {me.isOwner && rosterOpen && <InviteCard />}

      <NextStep />

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

/** Only what is still left for you; finished items disappear (D51: show what's needed now). */
function MyTodo({ phase, onGo }: { phase: Phase; onGo: (t: TabId) => void }) {
  const { view, me } = useEvent();
  const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? "someone";
  const stepOne = phase === "COLLECTING" || phase === "ALLOCATING" || phase === "REVIEWING";
  const items: { text: string; tab: TabId }[] = [];
  if (stepOne) {
    for (const r of view.receipts) if (r.payerId === me.memberId && !r.fundingAcknowledged) items.push({ text: `Confirm you paid ${php(r.payable)} for “${r.label}”`, tab: "receipts" });
    if (phase !== "REVIEWING") {
      for (const r of view.receipts) {
        const ack = r.acks.find((a) => a.memberId === me.memberId);
        if (!ack?.kind) items.push({ text: `Claim what you had from “${r.label}”`, tab: "claim" });
        else if (ack.stale) items.push({ text: `Claim again: “${r.label}” changed`, tab: "claim" });
      }
    }
  } else if (phase === "SETTLING" && view.settlement) {
    for (const e of view.settlement.edges) {
      if (e.from === me.memberId && e.disputed) items.push({ text: `Sort out the payment with ${name(e.to)}`, tab: "money" });
      else if (e.from === me.memberId && !e.settled && e.pending === "0") items.push({ text: `Pay ${php(e.outstanding)} to ${name(e.to)}`, tab: "money" });
      if (e.to === me.memberId && e.reports.some((r) => r.status === "REPORTED")) items.push({ text: `Confirm money from ${name(e.from)}`, tab: "money" });
    }
    if (!view.instructions[me.memberId] && view.settlement.edges.some((e) => e.to === me.memberId && !e.settled)) items.push({ text: "Share how you want to be paid (cash or QR)", tab: "money" });
  }

  const collecting = phase === "COLLECTING";
  if (phase === "DONE") {
    return (
      <Notice tone="receive" title="This hatian is done">
        All transfers were confirmed by the people who received them. This event is now read-only.
      </Notice>
    );
  }
  if (!items.length && !collecting) {
    return (
      <Notice tone="receive" title={phase === "SETTLING" ? "You’re all set" : "Nothing for you right now"}>
        {phase === "SETTLING" ? "Nothing left for you to pay or confirm. We’ll refresh automatically." : "Waiting on others. We’ll refresh automatically."}
      </Notice>
    );
  }
  return (
    <div>
      <SectionTitle>Your to-do</SectionTitle>
      <div className="space-y-2">
        {!items.length && me.entryComplete && (
          <Notice tone="receive" title="You’re done for now">
            The bill freezes by itself once everyone is done. Then you’ll see exactly who to pay.
          </Notice>
        )}
        <ul className="card divide-y divide-line p-0">
          {items.map((it, i) => (
            <li key={i}>
              <button type="button" onClick={() => onGo(it.tab)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
                <span className="inline-flex size-7 shrink-0 rounded-full border-2 border-line" />
                <span className="flex-1 text-[15px] font-medium">{it.text}</span>
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
      </div>
    </div>
  );
}

/**
 * What happens next for the whole group. Nobody presses a button to move on
 * (D49): the bill freezes once the roster is closed and everyone is done, and
 * a paid event closes a day after its last payment. The organizer only
 * freezes by hand after a correction (or for an event started before v0.7).
 */
function NextStep() {
  const { view, me, event } = useEvent();
  const act = useAction();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const owner = me.isOwner;
  const organizer = view.members.find((m) => m.isOwner)?.displayName ?? "The organizer";
  const g = view.gates;
  const move = async (target: Phase, label: string, reason?: string) => {
    setBusy(true);
    await act(() => api.post(`/api/events/${event.id}/phase`, { target, expectedFinancialVersion: event.financialVersion, reason }), label);
    setBusy(false);
  };

  if (event.phase === "SETTLING") {
    const done = g.done;
    if (!done) return null;
    const reopenAllowed = Boolean(view.settlement && g.correcting?.ready);
    return (
      <>
        <SectionTitle>Next step</SectionTitle>
        <Card className="space-y-3">
          <div>
            <p className="text-[17px] font-semibold">{done.ready ? "Everyone is paid ✓" : "Everyone pays what they owe"}</p>
            <p className="mt-0.5 text-[14px] text-muted">
              {done.ready
                ? "AteAnne closes this hatian by itself a day after the last payment, so a mistaken “Received” can still be undone."
                : "A payment counts once the person who received it confirms it. When everything is confirmed, the hatian closes by itself a day later."}
            </p>
          </div>
          <Blockers items={transferBlockers(done.blockers)} title="Still to confirm" limit={3} quiet />
          {owner && done.ready && (
            <Button full variant="receive" icon="check" busy={busy} onClick={() => void move("DONE", "Closed. Everything is settled.")}>
              Close it now
            </Button>
          )}
          <ReminderButton />
          {owner && (
            <Disclosure summary="Something wrong with the bill?" className="border-t border-line pt-1">
              <p className="text-[14px] text-muted">A correction reopens receipts and claims. Earlier statements and confirmed money are kept; overpayments become return transfers. You freeze the fixed bill yourself.</p>
              {reopenAllowed ? (
                <Button full variant="tonal" busy={busy} onClick={() => {
                  const reason = prompt("Why does the bill need a correction? Confirmed payments will carry forward. Correct any mistaken payment confirmations first; prior statements become read-only.");
                  if (reason === null) return;
                  if (reason.trim().length < 3 || reason.trim().length > 300) {
                    toast("Enter a correction reason between 3 and 300 characters.", "error");
                    return;
                  }
                  void move("COLLECTING", "Reopened for correction; prior payments and statement are preserved", reason.trim());
                }}>
                  Correct the bill
                </Button>
              ) : (
                <Blockers items={g.correcting?.blockers ?? []} title="Before correcting the bill" />
              )}
            </Disclosure>
          )}
        </Card>
      </>
    );
  }

  // Step 1, "Add & claim" (also events from before v0.7 still in Allocating/Reviewing).
  const freeze = g.freeze;
  if (!freeze) return null;
  const correcting = !g.autoFreeze;
  const byHand = correcting || event.phase !== "COLLECTING";
  const detail = owner
    ? correcting
      ? "Fix receipts or claims. Confirmed payments carry over. Freeze it when it’s right."
      : "The bill freezes by itself once everyone is done. Then each person sees exactly who to pay."
    : correcting
      ? `${organizer} is fixing the bill. Check your claims; you’ll see what to pay once it’s frozen again.`
      : "The bill freezes by itself once everyone is done. Then you’ll see exactly who to pay.";
  return (
    <>
      <SectionTitle>Next step</SectionTitle>
      <Card className="space-y-3">
        <div>
          <p className="text-[17px] font-semibold">{correcting ? "Fix the bill, then freeze it again" : "Next: everyone pays"}</p>
          <p className="mt-0.5 text-[14px] text-muted">{detail}</p>
        </div>
        <Blockers items={freeze.blockers} title="Waiting on" limit={3} quiet />
        {owner && byHand && (
          <Button full icon="lock" busy={busy} disabled={!freeze.ready || event.cancelled} onClick={() => void move("SETTLING", "Frozen — time to pay")}>
            {correcting ? "Freeze the corrected bill" : "Freeze the bill now"}
          </Button>
        )}
        <ReminderButton />
        {owner && event.phase !== "COLLECTING" && (
          <Disclosure summary="Need to fix a receipt? Reopen receipts" className="border-t border-line pt-1">
            <Button full variant="tonal" busy={busy} onClick={() => void move("COLLECTING", "Receipts reopened")}>
              Reopen receipts
            </Button>
          </Disclosure>
        )}
      </Card>
    </>
  );
}

/** The per-transfer lines say it all; "X: a non-zero balance remains" only repeats them. */
function transferBlockers(blockers: string[]): string[] {
  const transfers = blockers.filter((b) => !/a non-zero balance remains/.test(b));
  return transfers.length ? transfers : blockers;
}

/**
 * Organizer, while people can still join: the join code up front, then
 * "Everyone's here", which closes joining for good (D49). Rare code controls
 * are one tap away.
 */
function InviteCard() {
  const { view, me, event, setTab } = useEvent();
  const act = useAction();
  const people = view.members.filter((m) => m.active).length;
  const noGuests = !view.members.some((m) => m.isGuest && m.active);
  const addGuest = me.canManageGuests && noGuests && (
    <button type="button" onClick={() => setTab("people")} className="flex min-h-11 w-full items-center gap-2 text-left text-[15px] font-semibold text-violet">
      <Icon name="user" size={18} className="shrink-0" />
      <span className="flex-1">Someone without a phone? Add them in People</span>
      <Icon name="chevron" size={18} className="shrink-0" />
    </button>
  );
  const everyonesHere = (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-[14px] text-muted">Everyone who shared the bill has joined? Tap this. Nobody else can join after it.</p>
      <Button
        full
        icon="lock"
        disabled={event.cancelled}
        onClick={() => {
          if (!confirm(`Close joining for good? ${people} ${people === 1 ? "person is" : "people are"} in. Nobody else can join this hatian after this.`)) return;
          return act(() => api.post(`/api/events/${event.id}/lock`), "Everyone’s here — joining is closed");
        }}
      >
        Everyone’s here
      </Button>
    </div>
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
              {people} of 20 people joined · code expires {new Date(event.joinCodeExpiresAt!).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}. Check names in People.
            </p>
            {addGuest}
            {everyonesHere}
            <Disclosure summary="More join options" className="border-t border-line pt-1">
              <p className="text-[14px] text-muted">A new code stops the old one from working.</p>
              <Button full variant="tonal" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "New code created; the old one stopped working")}>
                New code
              </Button>
            </Disclosure>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] text-muted">The join code is off · {people} people</p>
              {!event.cancelled && (
                <Button variant="secondary" onClick={() => act(() => api.post(`/api/events/${event.id}/code`), "Joining reopened with a new code")}>
                  New code
                </Button>
              )}
            </div>
            {addGuest}
            {everyonesHere}
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
