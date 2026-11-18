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
      for (const r of view.receipts) if (r.payerId === memberId && !r.fundingAcknowledged) out.push(`Confirm paying ${php(r.payable)} for “${r.label}”`);
      if (!m.entryComplete) out.push("Mark receipt entry complete");
      break;
    case "ALLOCATING":
      for (const r of view.receipts) {
        const ack = r.acks.find((a) => a.memberId === memberId);
        if (!ack?.kind || ack.stale) out.push(`Claim what they had from “${r.label}”`);
      }
      break;
    case "REVIEWING":
      if (!view.review.approvals.includes(memberId)) out.push("Show them their share, then approve");
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
