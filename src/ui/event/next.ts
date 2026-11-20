import { money } from "../format";
import type { TabId, View } from "./EventContext";

/** What the server says to show first (D53). */
export type NextView = View["next"];
/** One task from the server's list (amounts are decimal-string centavos). */
export type TaskView = View["group"]["members"][number]["tasks"][number];
export type WaitingView = Extract<NextView, { kind: "waiting" }>;

const TASK_KINDS = new Set(["recheck", "confirmPaid", "claim", "fixReceipt", "doneAdding", "everyoneHere", "freeze", "sortOut", "confirmReceived", "shareDetails", "pay", "confirmCash", "sortOutCash"]);

export function isTask(next: NextView): next is TaskView {
  return TASK_KINDS.has(next.kind);
}

/** Which tab a task lives on. Home-level tasks (done adding, Everyone's here, freeze) return "overview". */
export function tabForTask(task: TaskView): TabId {
  switch (task.kind) {
    case "recheck":
    case "claim":
      return "claim";
    case "confirmPaid":
    case "fixReceipt":
      return "receipts";
    case "sortOut":
    case "confirmReceived":
    case "shareDetails":
    case "pay":
      return "money";
    default:
      // Cash tasks (D64) are answered right in the Next card, on Home.
      return "overview";
  }
}

/** The tab that gets the one attention dot: wherever your next step is. */
export function tabForNext(next: NextView): TabId | null {
  return isTask(next) ? tabForTask(next) : null;
}

/** "Ana", "Ana and Juan", "Ana, Juan and 3 more". */
export function namesList(ids: string[], name: (id: string) => string): string {
  const names = [...new Set(ids)].map(name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * One short line per task, worded so it reads right for you or for someone
 * else ("Claim from Lunch"). Used in "Everything left", "See what's left" and
 * the guest list.
 */
export function taskLine(task: TaskView, name: (id: string) => string, ccy = "PHP"): string {
  switch (task.kind) {
    case "recheck":
      return `Check “${task.label}” again (it changed)`;
    case "confirmPaid":
      return `Confirm paying ${money(task.amount, task.currency)} for “${task.label}”`;
    case "claim":
      return `Claim from “${task.label}”`;
    case "fixReceipt":
      return task.reason === "doesntAddUp" ? `Fix “${task.label}” so it adds up` : `Change “${task.label}”: someone disagreed with splitting it equally`;
    case "doneAdding":
      return "Say they’re done adding receipts";
    case "everyoneHere":
      return "Tap Everyone’s here";
    case "freeze":
      return task.corrected ? "Freeze the corrected bill" : "Freeze the bill";
    case "sortOut":
      return task.recordAgain ? `Record the money already sent to ${name(task.withId)}` : `Sort out the payment with ${name(task.withId)}`;
    case "confirmReceived":
      return `Confirm ${receivedAmount(task, ccy)} from ${name(task.fromId)}`;
    case "shareDetails":
      return "Share how to get paid (cash or QR)";
    case "pay":
      return `Pay ${name(task.toId)} ${money(task.amount, ccy)}`;
    case "confirmCash":
      return `Confirm ${cashAmount(task, ccy)} from ${name(task.fromId)}`;
    case "sortOutCash":
      return task.recordAgain ? `Record the ${money(task.amount, ccy)} handed to ${name(task.withId)} again` : `Sort out the ${money(task.amount, ccy)} payment with ${name(task.withId)}`;
  }
}

/** The cash actually handed over ("THB 2,000.00") when it was another currency (D64). */
export function cashAmount(task: Extract<TaskView, { kind: "confirmCash" }>, ccy: string): string {
  return task.paid ? money(task.paid.amount, task.paid.currency) : money(task.amount, ccy);
}

/** What arrived: the money actually sent ("THB 512.31") when paid in another currency. */
export function receivedAmount(task: Extract<TaskView, { kind: "confirmReceived" }>, ccy: string): string {
  return task.paid ? money(task.paid.amount, task.paid.currency) : money(task.amount, ccy);
}

/** Your own list wording, where it differs ("Say you're done adding receipts"). */
export function myTaskLine(task: TaskView, name: (id: string) => string, ccy = "PHP"): string {
  if (task.kind === "doneAdding") return "Say you’re done adding receipts";
  return taskLine(task, name, ccy);
}

/** The sentence under "You're done for now" / "You're all set". */
export function waitingSentence(w: WaitingView, name: (id: string) => string, ccy = "PHP"): string {
  if (!w.on.length) return w.reasons[0] ?? "Almost there.";
  const only = w.on.length === 1 ? w.on[0] : null;
  if (w.on.every((o) => o.task.kind === "fixReceipt" && o.task.reason === "doesntAddUp")) {
    const labels = [...new Set(w.on.map((o) => (o.task.kind === "fixReceipt" ? o.task.label : "")))];
    return `Waiting for ${labels.length === 1 ? labels[0] : `${labels.length} receipts`} to add up.`;
  }
  if (only) {
    const who = name(only.memberId);
    switch (only.task.kind) {
      case "everyoneHere":
        return `Waiting for ${who} to tap Everyone’s here.`;
      case "freeze":
        return `Waiting for ${who} to freeze the ${only.task.corrected ? "corrected " : ""}bill.`;
      case "recheck":
        return `Waiting for ${who} to check ${only.task.label} again.`;
      case "confirmReceived":
        return `Waiting for ${who} to confirm ${receivedAmount(only.task, ccy)}.`;
      case "confirmCash":
        return `Waiting for ${who} to confirm ${cashAmount(only.task, ccy)}.`;
      case "sortOutCash":
        return `Waiting for ${who} to sort out a payment.`;
      case "pay":
        return `Waiting for ${who} to pay ${name(only.task.toId)}.`;
      default:
        return `Waiting for ${who}.`;
    }
  }
  return `Waiting for ${namesList(
    w.on.map((o) => o.memberId),
    name,
  )}.`;
}
