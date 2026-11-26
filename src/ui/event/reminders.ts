import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { money } from "../format";
import { cashAmount, receivedAmount, type TaskView } from "./next";

export interface Reminder {
  memberId: string;
  name: string;
  tasks: string[];
}

/**
 * Plain-text reminders built from the server's own task list (D53), so a
 * copied reminder always matches what each person sees in the app. Payment
 * wording never nudges a second transfer while one is waiting.
 */
export function remindersFor(view: EventView): Reminder[] {
  if (view.event.cancelled || view.event.phase === "DONE") return [];
  const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? "someone";
  return view.group.members
    .map((g) => ({ memberId: g.memberId, name: name(g.memberId), tasks: [...new Set(g.tasks.map((t) => reminderLine(t, name, view.event.currency)))] }))
    .filter((r) => r.tasks.length > 0);
}

function reminderLine(task: TaskView, name: (id: string) => string, ccy: string): string {
  switch (task.kind) {
    case "recheck":
      return `“${task.label}” changed: choose what you had again, or say you had nothing`;
    case "confirmPaid":
      return `Confirm you paid ${money(task.amount, task.currency)} for “${task.label}”`;
    case "claim":
      return `Answer “${task.label}”: choose what you had, or say you had nothing`;
    case "fixReceipt":
      return task.reason === "doesntAddUp" ? `Fix “${task.label}” so its items add up to the total` : `Change “${task.label}”: someone disagreed with splitting it equally`;
    case "doneAdding":
      return "Add any receipts you paid for, then finish on Home even if you paid nothing";
    case "everyoneHere":
      return "Tap “Everyone’s here” once everyone who shared the bill has joined";
    case "freeze":
      return task.corrected ? "Freeze the corrected bill" : "Freeze the bill";
    case "sortOut":
      return task.recordAgain
        ? `Record the money you already sent to ${name(task.withId)}, but do not send it again`
        : `Resolve the disputed payment with ${name(task.withId)} in the app, and do not send the same money again`;
    case "confirmReceived":
      return `Check whether ${receivedAmount(task, ccy)} from ${name(task.fromId)} arrived, then confirm or reject it in the app`;
    case "shareDetails":
      return "Add how you want to be paid (cash or QR) in Pay";
    case "pay":
      return `Check the latest instructions, pay ${money(task.amount, ccy)} to ${name(task.toId)}, then record it in the app (if you already sent it, record that transfer and do not send it again)`;
    case "confirmCash":
      return `Check whether ${cashAmount(task, ccy)} from ${name(task.fromId)} arrived, then confirm it or say it didn't in the app`;
    case "sortOutCash":
      return task.recordAgain ? `Record again the ${money(task.amount, ccy)} you already handed to ${name(task.withId)}, but do not hand it over again` : `Sort out the disputed ${money(task.amount, ccy)} payment with ${name(task.withId)} in the app`;
  }
}

/** Does not include recovery keys, join codes, images or payment details. */
export function reminderMessage(view: EventView, reminders: Reminder[], eventUrl: string): string {
  const lines = [`Hatian reminder: ${view.event.title}`, ""];
  for (const person of reminders) {
    lines.push(`${person.name}:`, ...person.tasks.map((t) => `• ${t}`), "");
  }
  lines.push("Open Hatian to check the latest status before acting:", eventUrl, "", "This is a manual reminder, not a payment confirmation (the app refreshes while it is open)");
  return lines.join("\n");
}
