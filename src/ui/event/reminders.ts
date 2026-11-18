import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { php } from "../format";

export interface Reminder {
  memberId: string;
  name: string;
  tasks: string[];
}

/** Plain text only, using the same server-computed gates and capacities as the app. */
export function remindersFor(view: EventView): Reminder[] {
  if (view.event.cancelled || view.event.phase === "DONE") return [];
  const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? "someone";
  return view.members.filter((m) => m.active).map((m) => {
    const tasks: string[] = [];
    switch (view.event.phase) {
      case "COLLECTING":
      case "ALLOCATING":
      case "REVIEWING":
        // Step 1, "Add & claim" (D49). The bill freezes by itself once everyone is done.
        for (const r of view.receipts) {
          if (r.payerId === m.id && !r.fundingAcknowledged) tasks.push(`Confirm you paid ${php(r.payable)} for “${r.label}”.`);
        }
        if (view.event.phase !== "REVIEWING") {
          for (const r of view.receipts) {
            const ack = r.acks.find((a) => a.memberId === m.id);
            if (!ack?.kind || ack.stale) tasks.push(`Answer “${r.label}”: choose what you had, or say you had nothing.`);
          }
        }
        if (view.event.phase === "COLLECTING" && !m.entryComplete) tasks.push("Add any receipts you paid, then mark receipt entry complete (even if you paid nothing).");
        break;
      case "SETTLING":
        for (const edge of view.settlement?.edges ?? []) {
          if (edge.from !== m.id && edge.to !== m.id) continue;
          if (edge.disputed) {
            tasks.push(`Resolve the disputed payment with ${name(edge.from === m.id ? edge.to : edge.from)} in the app. Do not send the same money again.`);
            continue;
          }
          if (edge.to === m.id && edge.reports.some((r) => r.status === "REPORTED")) tasks.push(`Check whether money from ${name(edge.from)} arrived, then confirm or reject the report in the app.`);
          // A pending report may already be an external transfer. Never nudge a second transfer.
          if (edge.from === m.id && !edge.settled && BigInt(edge.pending) === 0n && BigInt(edge.capacity) > 0n) tasks.push(`Check the latest instructions, pay ${php(edge.capacity)} to ${name(edge.to)}, then report it in the app. If you already sent it, report that transfer; do not send it again.`);
        }
        if (!view.instructions[m.id] && view.settlement?.edges.some((e) => e.to === m.id && !e.settled)) tasks.push("Add how you want to be paid (cash or QR) in Money.");
        break;
    }
    return { memberId: m.id, name: m.displayName, tasks: [...new Set(tasks)] };
  }).filter((m) => m.tasks.length > 0);
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
