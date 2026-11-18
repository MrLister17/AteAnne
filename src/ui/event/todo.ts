import { php } from "../format";
import type { View } from "./EventContext";

/**
 * What one person still has to do in the current step, in plain words. Used
 * to show managers what each guest (someone without a phone) is waiting on.
 * Reads server-computed state only.
 */
export function pendingFor(view: View, memberId: string): string[] {
  const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? "someone";
  const m = view.members.find((x) => x.id === memberId);
  if (!m || !m.active) return [];
  const out: string[] = [];
  switch (view.event.phase) {
    case "COLLECTING":
    case "ALLOCATING":
    case "REVIEWING":
      // Step 1, "Add & claim" (D49): confirm what they paid, answer every receipt, say they're done.
      for (const r of view.receipts) if (r.payerId === memberId && !r.fundingAcknowledged) out.push(`Confirm paying ${php(r.payable)} for “${r.label}”`);
      if (view.event.phase !== "REVIEWING") {
        for (const r of view.receipts) {
          const ack = r.acks.find((a) => a.memberId === memberId);
          if (!ack?.kind) out.push(`Claim what they had from “${r.label}”`);
          else if (ack.stale) out.push(`Claim again from “${r.label}” (it changed)`);
        }
      }
      if (view.event.phase === "COLLECTING" && !m.entryComplete) out.push("Tick “I’ve entered every receipt I paid”");
      break;
    case "SETTLING":
      for (const e of view.settlement?.edges ?? []) {
        if (e.from === memberId && !e.settled && e.pending === "0" && !e.disputed) out.push(`Pay ${php(e.outstanding)} to ${name(e.to)}`);
        if (e.to === memberId && e.reports.some((r) => r.status === "REPORTED")) out.push(`Confirm money from ${name(e.from)}`);
        if (e.disputed && (e.from === memberId || e.to === memberId)) out.push(`Answer the disputed payment with ${name(e.from === memberId ? e.to : e.from)}`);
      }
      break;
    default:
      break;
  }
  return out;
}

/**
 * Has every active person answered (a current claim or "nothing") every
 * receipt, or one receipt? Before that, an estimated share is misleading: the
 * first person to claim a shared dish briefly "owes" all of it.
 */
export function everyoneAnswered(view: View, receiptId?: string): boolean {
  const people = view.members.filter((m) => m.active);
  const receipts = receiptId ? view.receipts.filter((r) => r.id === receiptId) : view.receipts;
  return receipts.length > 0 && receipts.every((r) => people.every((m) => r.acks.some((a) => a.memberId === m.id && a.kind && !a.stale)));
}
