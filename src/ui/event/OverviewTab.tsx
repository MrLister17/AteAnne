"use client";

import { useState } from "react";
import type { Phase } from "@/domain/event/PhaseMachine";
import { api } from "../api";
import { ShareJoin } from "../components/CredentialReveal";
import { Icon } from "../components/Icon";
import { BalanceBanner, Blockers, Button, Card, Notice, SectionTitle } from "../components/ui";
import { php } from "../format";
import { TabId, useAction, useEvent } from "./EventContext";

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
        <BalanceBanner net={estimate.net} estimate caption={`Paid ${php(estimate.funding)} · your share so far ${php(estimate.cost)}`} />
      ) : null}

      <MyTodo phase={phase} onGo={setTab} />

      {event.note && (
        <Card>
          <p className="text-[14px] font-semibold text-muted">Note from the organizer</p>
          <p className="mt-1 whitespace-pre-wrap">{event.note}</p>
        </Card>
      )}

      {me.isOwner && <OrganizerPanel />}

      {!me.isOwner && phase !== "DONE" && (
        <Notice tone="info">
          The organizer moves the group to the next step once everyone is ready. Organizers can’t claim items or confirm payments for you.
        </Notice>
      )}

      {phase === "COLLECTING" && <EntryCompleteToggle />}
    </div>
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
  const [busy, setBusy] = useState(false);
  const move = async (target: Phase, label: string) => {
    setBusy(true);
    await act(() => api.post(`/api/events/${event.id}/phase`, { target, expectedFinancialVersion: event.financialVersion }), label);
    setBusy(false);
  };
  const g = view.gates;
  const reopenAllowed = event.phase === "SETTLING" && view.settlement && !view.settlement.hasReports;

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
                <Button variant="ghost" className="flex-1" onClick={() => void act(() => api.post(`/api/events/${event.id}/code`), "New code created; the old one stopped working")}>
                  New code
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => void act(() => api.del(`/api/events/${event.id}/code`), "Joining closed")}>
                  Close joining
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] text-muted">Joining is closed.</p>
              {!event.cancelled && (
                <Button variant="secondary" onClick={() => void act(() => api.post(`/api/events/${event.id}/code`), "Joining reopened with a new code")}>
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
          <Button full variant="ghost" busy={busy} onClick={() => void move("COLLECTING", "Back to collecting receipts")}>
            Back to receipts (fix a receipt)
          </Button>
        </Card>
      )}

      {event.phase === "REVIEWING" && g.settling && (
        <Card className="space-y-3">
          <p className="font-semibold">Freeze the statement</p>
          <p className="text-[14px] text-muted">Freezing locks version {event.financialVersion} and the transfers. After the first payment is reported, the bill can no longer be changed in this version of AteAnne.</p>
          <Blockers items={g.settling.blockers} />
          <Button full busy={busy} disabled={!g.settling.ready || event.cancelled} onClick={() => void move("SETTLING", "Frozen — time to settle")}>
            <Icon name="lock" size={18} /> Freeze & start settling
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" busy={busy} onClick={() => void move("ALLOCATING", "Back to claiming")}>
              Back to claims
            </Button>
            <Button variant="ghost" busy={busy} onClick={() => void move("COLLECTING", "Back to receipts")}>
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
            <Button full variant="ghost" busy={busy} onClick={() => void move("REVIEWING", "Reopened for review; the old statement is kept as superseded")}>
              Reopen review (no payments reported yet)
            </Button>
          )}
          {!reopenAllowed && view.settlement?.hasReports && <p className="text-[13px] text-muted">A payment was reported, so the bill is frozen. Mistakes after this point are a documented v1 limitation.</p>}
        </Card>
      )}
    </>
  );
}
