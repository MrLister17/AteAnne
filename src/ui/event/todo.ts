import type { View } from "./EventContext";

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
