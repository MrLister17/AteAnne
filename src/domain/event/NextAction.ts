import type { Phase } from "./PhaseMachine";

/**
 * Everything needed to say what each person should do next. Built by the
 * server from the event it just loaded; amounts are exact centavos.
 */
export interface NextActionInput {
  phase: Phase;
  cancelled: boolean;
  /** The organizer tapped "Everyone's here". */
  rosterLocked: boolean;
  /** The first bill freezes by itself; after a correction the organizer freezes it by hand. */
  autoFreeze: boolean;
  /** The freeze gate passes (roster closed, everyone done, everything adds up). */
  freezeReady: boolean;
  /** Every transfer is confirmed received. */
  doneReady: boolean;
  ownerId: string | null;
  members: { id: string; active: boolean; entryComplete: boolean }[];
  receipts: {
    id: string;
    label: string;
    authorId: string;
    payerId: string;
    payable: bigint;
    equalSplit: boolean;
    fundingAcknowledged: boolean;
    reconciled: boolean;
    answers: { memberId: string; kind: "FINISHED" | "NONE" | null; stale: boolean }[];
  }[];
  transfers: {
    id: string;
    from: string;
    to: string;
    amount: bigint;
    verified: bigint;
    pending: bigint;
    capacity: bigint;
    settled: boolean;
    disputed: boolean;
    dispute: { status: string; senderChoice: string | null; recipientChoice: string | null } | null;
    pendingReports: { id: string; amount: bigint; version: number }[];
  }[];
  /** Members who have shared how they want to be paid (cash or QR). */
  withPaymentDetails: string[];
  /** The freeze gate's own wording, used only when a wait can't be pinned on a person. */
  freezeBlockers: string[];
}

/** One thing one person can do now. */
export type Task =
  | { kind: "recheck"; receiptId: string; label: string }
  | { kind: "confirmPaid"; receiptId: string; label: string; amount: bigint }
  | { kind: "claim"; receiptId: string; label: string }
  | { kind: "fixReceipt"; receiptId: string; label: string; reason: "doesntAddUp" | "disagreed" }
  | { kind: "doneAdding" }
  | { kind: "everyoneHere" }
  | { kind: "freeze"; corrected: boolean }
  | { kind: "sortOut"; transferId: string; withId: string; amount: bigint; recordAgain: boolean }
  | { kind: "confirmReceived"; transferId: string; reportId: string; reportVersion: number; fromId: string; amount: bigint }
  | { kind: "shareDetails" }
  | { kind: "pay"; transferId: string; toId: string; amount: bigint; received: bigint };

export interface Waiting {
  kind: "waiting";
  step: "claim" | "pay";
  /** Who the group is waiting on, each with the first thing they still have to do. */
  on: { memberId: string; task: Task }[];
  /** Freeze-gate wording when nobody in particular is holding things up. */
  reasons: string[];
  /** You reported money that the recipient hasn't confirmed yet. */
  sent?: { transferId: string; toId: string; amount: bigint; left: bigint };
  /** Someone owes you and hasn't reported paying yet. */
  incoming?: { transferId: string; fromId: string; amount: bigint };
}

export type Next = Task | Waiting | { kind: "allPaid" } | { kind: "closed" } | { kind: "cancelled" };

/** JSON form: centavos as decimal strings (the API never sends numbers for money). */
export type Wire<T> = T extends bigint
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export function toWire<T>(value: T): Wire<T> {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Wire<T>;
}

const STEP_ONE: Phase[] = ["COLLECTING", "ALLOCATING", "REVIEWING"];

/**
 * The single source of "what's next" (D53). Home, Claim, Pay, the tab dots,
 * the guest list and copied reminders all read these results, so they can
 * never disagree. Pure: no I/O, no clock.
 *
 * Step 1 order: re-check a changed receipt → confirm a receipt you paid →
 * answer a receipt → fix your receipt → say you're done adding receipts →
 * organizer: Everyone's here → organizer: freeze (after a correction, or an
 * event from before v0.7). Step 2 order: sort out a disputed payment →
 * confirm money that arrived → share how you get paid → pay.
 */
export class NextActions {
  constructor(private readonly input: NextActionInput) {}

  /** Everything this person can do now, most urgent first. */
  tasksFor(memberId: string): Task[] {
    const f = this.input;
    const me = f.members.find((m) => m.id === memberId);
    if (!me || !me.active || f.cancelled) return [];
    if (STEP_ONE.includes(f.phase)) return this.stepOneTasks(memberId, me.entryComplete);
    if (f.phase === "SETTLING") return this.payTasks(memberId);
    return [];
  }

  /** The one thing to show this person first. */
  nextFor(memberId: string): Next {
    const f = this.input;
    if (f.cancelled) return { kind: "cancelled" };
    if (f.phase === "DONE") return { kind: "closed" };
    const mine = this.tasksFor(memberId);
    if (mine.length) return mine[0];
    if (f.phase === "SETTLING" && f.doneReady) return { kind: "allPaid" };
    const step = f.phase === "SETTLING" ? "pay" : "claim";
    const on = this.group()
      .filter((g) => g.memberId !== memberId && g.tasks.length > 0)
      .map((g) => ({ memberId: g.memberId, task: g.tasks[0] }));
    const waiting: Waiting = { kind: "waiting", step, on, reasons: on.length ? [] : this.unattributed() };
    if (step === "pay") {
      const sent = f.transfers.find((t) => t.from === memberId && !t.settled && t.pending > 0n);
      if (sent) waiting.sent = { transferId: sent.id, toId: sent.to, amount: sent.pending, left: sent.capacity };
      const incoming = f.transfers.find((t) => t.to === memberId && !t.settled && t.pending === 0n && !t.disputed);
      if (incoming) waiting.incoming = { transferId: incoming.id, fromId: incoming.from, amount: incoming.capacity };
    }
    return waiting;
  }

  /** Every active person with their tasks, in roster order (for "See what's left", guests and reminders). */
  group(): { memberId: string; tasks: Task[] }[] {
    return this.input.members.filter((m) => m.active).map((m) => ({ memberId: m.id, tasks: this.tasksFor(m.id) }));
  }

  /** Why the bill can't freeze when no person has anything left to do (e.g. no receipts yet). */
  unattributed(): string[] {
    const f = this.input;
    if (!STEP_ONE.includes(f.phase) || f.cancelled || f.freezeReady) return [];
    return f.freezeBlockers;
  }

  private stepOneTasks(memberId: string, entryComplete: boolean): Task[] {
    const f = this.input;
    const out: Task[] = [];
    const claimsOpen = f.phase === "COLLECTING" || f.phase === "ALLOCATING";
    const answer = (r: NextActionInput["receipts"][number]) => r.answers.find((a) => a.memberId === memberId);
    if (claimsOpen) {
      for (const r of f.receipts) {
        const a = answer(r);
        if (a?.kind && a.stale) out.push({ kind: "recheck", receiptId: r.id, label: r.label });
      }
    }
    for (const r of f.receipts) {
      if (r.payerId === memberId && !r.fundingAcknowledged && r.reconciled) out.push({ kind: "confirmPaid", receiptId: r.id, label: r.label, amount: r.payable });
    }
    if (claimsOpen) {
      for (const r of f.receipts) {
        const a = answer(r);
        if (!a?.kind) out.push({ kind: "claim", receiptId: r.id, label: r.label });
      }
    }
    for (const r of f.receipts) {
      // Whoever typed a receipt fixes its numbers; an equal split someone disagreed with is the organizer's call.
      if (!r.reconciled && r.authorId === memberId) out.push({ kind: "fixReceipt", receiptId: r.id, label: r.label, reason: "doesntAddUp" });
      else if (r.reconciled && r.equalSplit && f.ownerId === memberId && r.answers.some((a) => a.kind === "NONE" && !a.stale && this.isActive(a.memberId))) {
        out.push({ kind: "fixReceipt", receiptId: r.id, label: r.label, reason: "disagreed" });
      }
    }
    if (f.phase === "COLLECTING" && !entryComplete) out.push({ kind: "doneAdding" });
    const isOwner = f.ownerId === memberId;
    if (isOwner && f.phase === "COLLECTING" && !f.rosterLocked) out.push({ kind: "everyoneHere" });
    if (isOwner && f.freezeReady && (!f.autoFreeze || f.phase !== "COLLECTING")) out.push({ kind: "freeze", corrected: !f.autoFreeze });
    return out;
  }

  private payTasks(memberId: string): Task[] {
    const f = this.input;
    const out: Task[] = [];
    for (const t of f.transfers) {
      if (!t.disputed || !t.dispute || (t.from !== memberId && t.to !== memberId)) continue;
      const iAmSender = t.from === memberId;
      const withId = iAmSender ? t.to : t.from;
      if (t.dispute.status === "AWAITING_REPLACEMENT") {
        if (iAmSender) out.push({ kind: "sortOut", transferId: t.id, withId, amount: t.capacity, recordAgain: true });
        continue;
      }
      const mineChoice = iAmSender ? t.dispute.senderChoice : t.dispute.recipientChoice;
      const theirs = iAmSender ? t.dispute.recipientChoice : t.dispute.senderChoice;
      if (!mineChoice || (theirs && theirs !== mineChoice)) out.push({ kind: "sortOut", transferId: t.id, withId, amount: t.capacity, recordAgain: false });
    }
    for (const t of f.transfers) {
      if (t.to !== memberId) continue;
      for (const r of t.pendingReports) out.push({ kind: "confirmReceived", transferId: t.id, reportId: r.id, reportVersion: r.version, fromId: t.from, amount: r.amount });
    }
    if (!f.withPaymentDetails.includes(memberId) && f.transfers.some((t) => t.to === memberId && !t.settled)) out.push({ kind: "shareDetails" });
    for (const t of f.transfers) {
      // A pending report may already be real money on its way: never ask for a second transfer while it waits.
      if (t.from === memberId && !t.settled && !t.disputed && t.pending === 0n && t.capacity > 0n) out.push({ kind: "pay", transferId: t.id, toId: t.to, amount: t.capacity, received: t.verified });
    }
    return out;
  }

  private isActive(memberId: string) {
    return this.input.members.some((m) => m.id === memberId && m.active);
  }
}
