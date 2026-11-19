import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { php } from "../format";
import type { TaskView } from "./next";

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
    .map((g) => ({ memberId: g.memberId, name: name(g.memberId), tasks: [...new Set(g.tasks.map((t) => reminderLine(t, name)))] }))
    .filter((r) => r.tasks.length > 0);
}

function reminderLine(task: TaskView, name: (id: string) => string): string {
  switch (task.kind) {
    case "recheck":
      return `“${task.label}” changed: choose what you had again, or say you had nothing.`;
    case "confirmPaid":
      return `Confirm you paid ${php(task.amount)} for “${task.label}”.`;
    case "claim":
      return `Answer “${task.label}”: choose what you had, or say you had nothing.`;
    case "fixReceipt":
      return task.reason === "doesntAddUp" ? `Fix “${task.label}” so its items add up to the total.` : `Change “${task.label}”: someone disagreed with splitting it equally.`;
    case "doneAdding":
      return "Add any receipts you paid, then tap “I’m done adding receipts” (even if you paid nothing).";
    case "everyoneHere":
      return "Tap “Everyone’s here” once everyone who shared the bill has joined.";
    case "freeze":
      return task.corrected ? "Freeze the corrected bill." : "Freeze the bill.";
    case "sortOut":
      return task.recordAgain
        ? `Record the money you already sent to ${name(task.withId)}. Do not send it again.`
        : `Resolve the disputed payment with ${name(task.withId)} in the app. Do not send the same money again.`;
    case "confirmReceived":
      return `Check whether ${php(task.amount)} from ${name(task.fromId)} arrived, then confirm or reject it in the app.`;
    case "shareDetails":
      return "Add how you want to be paid (cash or QR) in Pay.";
    case "pay":
      return `Check the latest instructions, pay ${php(task.amount)} to ${name(task.toId)}, then record it in the app. If you already sent it, record that transfer; do not send it again.`;
  }
}

/** Does not include recovery keys, join codes, images or payment details. */
export function reminderMessage(view: EventView, reminders: Reminder[], eventUrl: string): string {
  const lines = [`AteAnne reminder: ${view.event.title}`, ""];
  for (const person of reminders) {
    lines.push(`${person.name}:`, ...person.tasks.map((t) => `• ${t}`), "");
  }
  lines.push("Open AteAnne to check the latest status before acting:", eventUrl, "", "The app refreshes while it is open. This is a manual reminder, not a payment confirmation.");
  return lines.join("\n");
}
