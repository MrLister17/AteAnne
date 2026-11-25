"use client";

import { useState } from "react";
import { api } from "../api";
import { ActionError, Button, Sheet } from "../components/ui";
import { useEvent, useInlineAction } from "./EventContext";
import { cashAmount, isTask, namesList, receivedAmount, taskLine, waitingSentence, type NextView, type TaskView } from "./next";
import { CashDisputeCard } from "./CashPayments";
import { ReminderButton } from "./ReminderPanel";
import { DidntArriveSheet } from "./SettlementSection";

type Where = "home" | "claim" | "pay";

/**
 * "Next for you": one status line, at most one short sentence, one primary
 * button and at most one secondary link (D53). The server decides what comes
 * first (`view.next`); this only puts it into words.
 */
export function NextCard({ where }: { where: Where }) {
  const { view } = useEvent();
  const next = view.next;
  // On Pay the transfer card itself is the action (or already says "Sent · Waiting for Mark"); it is highlighted instead.
  if (where === "pay" && isTask(next) && (next.kind === "pay" || next.kind === "confirmReceived" || next.kind === "sortOut")) return null;
  if (where === "pay" && next.kind === "waiting" && (next.sent || next.incoming)) return null;
  return (
    <section className="card space-y-3 border-violet/40 p-4" aria-labelledby="next-for-you" data-testid="next-card" data-next={next.kind}>
      <h2 id="next-for-you" className="text-[13px] font-bold tracking-wide text-muted uppercase">
        {view.actingFor ? `Next for ${view.me.displayName}` : "Next for you"}
      </h2>
      <NextBody next={next} where={where} />
    </section>
  );
}

function Status({ title, line }: { title: string; line?: string | null }) {
  return (
    <div>
      <p className="text-[19px] leading-snug font-bold" data-testid="next-status">
        {title}
      </p>
      {line && <p className="mt-0.5 text-[15px] text-muted">{line}</p>}
    </div>
  );
}

function Secondary({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center px-1 text-[15px] font-semibold text-violet underline underline-offset-2">
      {children}
    </button>
  );
}

function NextBody({ next, where }: { next: NextView; where: Where }) {
  const { view, me, event, name, goTo, money, currency } = useEvent();
  const { run, error } = useInlineAction();
  const [left, setLeft] = useState(false);
  const owner = me.isOwner;

  if (isTask(next)) return <TaskBody task={next} where={where} />;

  switch (next.kind) {
    case "waiting": {
      const sentence = waitingSentence(next, name, currency);
      if (next.sent) {
        const s = next.sent;
        return (
          <>
            <Status title={`Sent ${money(s.amount)} · Waiting for ${name(s.toId)}`} line={s.left !== "0" ? `${money(s.left)} left` : `${name(s.toId)} will confirm it arrived.`} />
            {s.left !== "0" && where !== "pay" && <Secondary onClick={() => goTo("money", { transferId: s.transferId })}>I sent more</Secondary>}
          </>
        );
      }
      if (next.incoming) {
        const i = next.incoming;
        return <Status title={`Waiting for ${name(i.fromId)}`} line={`${name(i.fromId)} will pay you ${money(i.amount)}.`} />;
      }
      return (
        <>
          <Status title={next.step === "pay" ? "You’re all set" : "You’re done for now"} line={sentence} />
          <div className="flex flex-wrap items-center gap-x-3">
            {(next.on.length > 0 || next.reasons.length > 0) && <Secondary onClick={() => setLeft(true)}>See what’s left</Secondary>}
          </div>
          {owner && <ReminderButton />}
          {left && <WhatsLeft onClose={() => setLeft(false)} />}
        </>
      );
    }
    case "allPaid":
      return (
        <>
          <Status title="Everyone’s paid" line="It closes by itself tomorrow, so a mistake can still be fixed." />
          {owner && (
            <>
              <Button
                full
                variant="secondary"
                icon="check"
                busyLabel="Closing…"
                onClick={() => {
                  if (!confirm("Close this split? Nobody can change it after this.")) return;
                  return run(() => api.post(`/api/events/${event.id}/phase`, { target: "DONE", expectedFinancialVersion: event.financialVersion }), "Closed. Everything’s settled.");
                }}
              >
                Close it now
              </Button>
              <ActionError message={error} />
            </>
          )}
        </>
      );
    case "closed":
      return (
        <>
          <Status title="All paid and closed" line="Every payment was confirmed by the person who got it." />
          {where !== "pay" && (
            <Button full variant="secondary" onClick={() => goTo("money")}>
              See summary
            </Button>
          )}
        </>
      );
    case "cancelled":
      return <Status title="This split was cancelled" line="Amounts that weren’t settled still count." />;
    default:
      void view;
      return null;
  }
}

function TaskBody({ task, where }: { task: TaskView; where: Where }) {
  const { view, me, event, name, goTo, setTab, money, currency } = useEvent();
  const { run, error } = useInlineAction();
  const [didntArrive, setDidntArrive] = useState(false);

  switch (task.kind) {
    case "recheck":
      return (
        <>
          <Status title={`${task.label} changed`} line="Check your items again." />
          <Button full onClick={() => goTo("claim", { receiptId: task.receiptId })}>
            Check {task.label} again
          </Button>
        </>
      );
    case "confirmPaid":
      return (
        <>
          <Status title={`Did you pay ${money(task.amount, task.currency)} for ${task.label}?`} />
          <Button full onClick={() => goTo("receipts", { receiptId: task.receiptId })}>
            Check and confirm
          </Button>
        </>
      );
    case "claim":
      return (
        <>
          <Status title={`Next: ${task.label}`} />
          <Button full onClick={() => goTo("claim", { receiptId: task.receiptId })}>
            Claim from {task.label}
          </Button>
        </>
      );
    case "fixReceipt":
      return (
        <>
          <Status
            title={task.reason === "doesntAddUp" ? `${task.label} doesn’t add up` : `Someone disagreed with splitting ${task.label} equally`}
            line={task.reason === "doesntAddUp" ? "Fix the items or the total so they match." : "Change it to item-by-item, or talk it over."}
          />
          <Button full onClick={() => goTo("receipts", { receiptId: task.receiptId })}>
            {task.reason === "doesntAddUp" ? `Fix ${task.label}` : `Open ${task.label}`}
          </Button>
        </>
      );
    case "doneAdding": {
      const markDone = () => run(() => api.patch(`/api/events/${event.id}/me`, { entryComplete: true }), "You’re done adding receipts");
      // Said "I paid" but hasn't added a receipt yet: adding it is the obvious next tap, not "done".
      const owesReceipt = me.intent === "PAID_EXPENSE" && !view.receipts.some((r) => r.payerId === me.memberId);
      if (owesReceipt) {
        return (
          <>
            <Status title="Add the receipt you paid" line="Scan a photo or type the items." />
            <Button full icon="receipt" disabled={event.cancelled} onClick={() => setTab("receipts")}>
              Add a receipt
            </Button>
            <ActionError message={error} />
            <Secondary onClick={() => void markDone()}>I didn’t pay for anything</Secondary>
          </>
        );
      }
      return (
        <>
          <Status title={view.receipts.length ? "Did you pay for anything else?" : "Did you pay for anything?"} line={view.receipts.length ? null : "If you didn’t pay, you’re done."} />
          <Button full busyLabel="Saving…" disabled={event.cancelled} onClick={markDone}>
            I’m done adding receipts
          </Button>
          <ActionError message={error} />
          <Secondary onClick={() => setTab("receipts")}>Add a receipt</Secondary>
        </>
      );
    }
    case "everyoneHere": {
      const people = view.members.filter((m) => m.active).length;
      return (
        <>
          <Status title="Is everyone here?" line="Nobody can join after this." />
          <Button
            full
            icon="lock"
            busyLabel="Closing…"
            disabled={event.cancelled}
            onClick={() => {
              if (!confirm(`Close joining? ${people} ${people === 1 ? "person is" : "people are"} in. Nobody else can join after this.`)) return;
              return run(() => api.post(`/api/events/${event.id}/lock`), "Joining closed");
            }}
          >
            Everyone’s here
          </Button>
          <ActionError message={error} />
          <Secondary onClick={() => goTo("overview", { invite: true })}>Invite more people</Secondary>
        </>
      );
    }
    case "freeze":
      return (
        <>
          <Status title={task.corrected ? "Bill fixed?" : "Ready to freeze"} line="Freeze it so everyone sees what to pay." />
          <Button
            full
            icon="lock"
            busyLabel="Freezing…"
            disabled={event.cancelled}
            onClick={() => run(() => api.post(`/api/events/${event.id}/phase`, { target: "SETTLING", expectedFinancialVersion: event.financialVersion }), "Bill frozen. Time to pay.")}
          >
            {task.corrected ? "Freeze the corrected bill" : "Freeze the bill now"}
          </Button>
          <ActionError message={error} />
        </>
      );
    case "sortOut":
      return (
        <>
          <Status
            title={task.recordAgain ? `Record the money you sent to ${name(task.withId)}` : `Sort this out with ${name(task.withId)}`}
            line={task.recordAgain ? "You both agreed it was sent. Don’t send it again." : "A payment was marked as not arrived."}
          />
          <Button full onClick={() => goTo("money", { transferId: task.transferId })}>
            {task.recordAgain ? "Record it again" : "Open payment"}
          </Button>
        </>
      );
    case "confirmReceived":
      return (
        <>
          <Status title={`Did ${receivedAmount(task, currency)} from ${name(task.fromId)} arrive?`} line={task.paid ? `Counts as ${money(task.amount)}. Not there yet? Leave this and check later.` : "Not there yet? Leave this and check later."} />
          <Button
            full
            variant="receive"
            icon="check"
            busyLabel="Confirming…"
            onClick={() => run(() => api.post(`/api/payments/${task.reportId}/verify`, { expectedVersion: task.reportVersion }), `Got it. ${receivedAmount(task, currency)} from ${name(task.fromId)}.`)}
          >
            Yes, I got it
          </Button>
          <ActionError message={error} />
          <Secondary onClick={() => setDidntArrive(true)}>It didn’t arrive</Secondary>
          {didntArrive && <DidntArriveSheet reportId={task.reportId} reportVersion={task.reportVersion} senderId={task.fromId} onClose={() => setDidntArrive(false)} />}
        </>
      );
    case "confirmCash": {
      const report = view.cash.reports.find((c) => c.id === task.reportId);
      return (
        <>
          <Status title={`Did ${cashAmount(task, currency)} from ${name(task.fromId)} arrive?`} line={task.paid ? `Counts as ${money(task.amount)}. Not there yet? Leave this and check later.` : "Not there yet? Leave this and check later."} />
          <Button
            full
            variant="receive"
            icon="check"
            busyLabel="Confirming…"
            onClick={() => run(() => api.post(`/api/cash-payments/${task.reportId}/verify`, { expectedVersion: task.reportVersion }), `Confirmed. ${cashAmount(task, currency)} from ${name(task.fromId)}.`)}
          >
            Confirm received
          </Button>
          <ActionError message={error} />
          <Secondary onClick={() => setDidntArrive(true)}>Report a problem</Secondary>
          {didntArrive && report && <CashProblem reportId={report.id} version={report.version} fromId={report.from} onClose={() => setDidntArrive(false)} />}
        </>
      );
    }
    case "sortOutCash": {
      const report = view.cash.reports.find((c) => c.id === task.reportId);
      if (!report) return <Status title={taskLine(task, name, currency)} />;
      return <CashDisputeCard report={report} />;
    }
    case "shareDetails": {
      const owes = (view.settlement?.edges ?? []).filter((e) => e.to === me.memberId && !e.settled).map((e) => e.from);
      return (
        <>
          <Status title={`How should ${owes.length ? namesList(owes, name) : "people"} pay you?`} />
          <Button full icon="wallet" onClick={() => goTo("money", { payDetails: true })}>
            Add cash or QR
          </Button>
        </>
      );
    }
    case "pay": {
      const instr = view.instructions[task.toId];
      const how = instr ? [instr.acceptsCash && "Cash", instr.hasQr && "QR"].filter(Boolean).join(" or ") + "." : `Ask ${name(task.toId)} how to pay.`;
      return (
        <>
          <Status title={`Pay ${name(task.toId)} ${money(task.amount)}`} line={task.received !== "0" ? `${name(task.toId)} got ${money(task.received)} so far.` : how} />
          {where !== "pay" && (
            <Button full icon="arrowUp" onClick={() => goTo("money", { transferId: task.transferId })}>
              Pay {name(task.toId)}
            </Button>
          )}
        </>
      );
    }
  }
}

/** "See what's left": everyone who still has something to do, in plain words. */
function WhatsLeft({ onClose }: { onClose: () => void }) {
  const { view, name, currency } = useEvent();
  const rows = view.group.members.filter((g) => g.tasks.length > 0);
  return (
    <Sheet open onClose={onClose} title="What’s left">
      <div className="space-y-4">
        {rows.length === 0 && view.group.reasons.length === 0 && <p className="text-muted">Nothing. The bill moves on by itself in a moment.</p>}
        {rows.map((g) => (
          <div key={g.memberId} className="card p-4">
            <p className="font-semibold">{name(g.memberId)}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px] text-muted">
              {g.tasks.map((t, i) => (
                <li key={i}>{taskLine(t, name, currency)}</li>
              ))}
            </ul>
          </div>
        ))}
        {view.group.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-[15px] text-muted">
            {view.group.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** "Report a problem" from the Next card: same reason sheet as the Payments card (D64). */
function CashProblem({ reportId, version, fromId, onClose }: { reportId: string; version: number; fromId: string; onClose: () => void }) {
  const { name } = useEvent();
  const { run, error } = useInlineAction();
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open
      onClose={onClose}
      title="What happened?"
      footer={
        <div className="space-y-2">
          <ActionError message={error} />
          <Button
            full
            variant="danger"
            busyLabel="Sending…"
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const ok = await run(() => api.post(`/api/cash-payments/${reportId}/reject`, { reason: reason.trim(), expectedVersion: version }), `Saved. ${name(fromId)} will see it.`);
              if (ok) onClose();
              return ok;
            }}
          >
            Tell {name(fromId)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">Only continue if {name(fromId)} says they gave it to you and nothing came.</p>
        <textarea aria-label="What happened?" className="field min-h-24" maxLength={200} value={reason} placeholder="e.g. I never got the cash" onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}
