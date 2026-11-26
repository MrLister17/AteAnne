import { LargestRemainderAllocator } from "../allocation/LargestRemainderAllocator";
import { CalculationIssue, MemberReceiptShare, ReceiptInput } from "./types";

/** Receipt-wide equality is a proposal until each roster member accepts it. */
export class EqualReceiptSplit {
  constructor(private readonly allocator = new LargestRemainderAllocator()) {}

  claimsFor(lines: readonly { id: string }[]) {
    return lines.map((line) => ({ lineId: line.id, units: 1 }));
  }

  totals(payable: bigint, memberIds: readonly string[]) {
    return this.allocator.allocate(payable, memberIds.map((key) => ({ key, weight: 1 })));
  }

  issues(receipt: ReceiptInput): CalculationIssue[] {
    if (!receipt.equalSplit) return [];
    const members = receipt.equalSplit.memberIds;
    const confirmed = members.length > 0 && receipt.lines.every((line) =>
      line.mode === "SHARED" && line.claims.length === members.length &&
      members.every((id) => line.claims.filter((claim) => claim.memberId === id && claim.units === 1).length === 1),
    );
    return confirmed ? [] : [{ code: "EQUAL_SPLIT_UNCONFIRMED", receiptId: receipt.id, message: "The equal split needs everyone’s confirmation, and if someone disagrees, the organizer must change this receipt back to item claims" }];
  }

  /**
   * Allocate successive cumulative totals, then take their differences.
   * This spreads rounding across components: ten small lines cannot give
   * the same person ten extra centavos. Every component still conserves
   * centavos and final totals are exactly payable / people (±1 centavo).
   * Called only after normal reconciliation, scope and basis validation.
   */
  calculate(receipt: ReceiptInput, memberOrder: readonly string[]): Map<string, MemberReceiptShare> {
    const included = new Set(receipt.equalSplit!.memberIds);
    const entries = memberOrder.filter((id) => included.has(id)).map((key) => ({ key, weight: 1 }));
    const shares = new Map<string, MemberReceiptShare>(memberOrder.map((memberId) => [memberId, {
      memberId, lineShares: new Map(), discountShares: new Map(), chargeShares: new Map(),
      itemsGross: 0n, discountTotal: 0n, chargeTotal: 0n, total: 0n,
    }]));
    let running = 0n;
    let previous = this.allocator.allocate(0n, entries);
    const component = (id: string, amount: bigint, kind: "line" | "discount" | "charge") => {
      running += kind === "discount" ? -amount : amount;
      const next = this.allocator.allocate(running, entries);
      for (const { key } of entries) {
        const share = shares.get(key)!;
        const delta = kind === "discount" ? previous.get(key)! - next.get(key)! : next.get(key)! - previous.get(key)!;
        if (kind === "line") { share.lineShares.set(id, delta); share.itemsGross += delta; }
        else if (kind === "discount") { share.discountShares.set(id, delta); share.discountTotal += delta; }
        else { share.chargeShares.set(id, delta); share.chargeTotal += delta; }
      }
      previous = next;
    };
    for (const line of [...receipt.lines].sort((a, b) => a.position - b.position)) component(line.id, line.amount, "line");
    const adjustments = [...receipt.adjustments].sort((a, b) => a.position - b.position);
    for (const a of adjustments.filter((a) => a.kind === "DISCOUNT")) component(a.id, a.amount, "discount");
    for (const kind of ["SERVICE", "CHARGE"] as const) {
      for (const a of adjustments.filter((a) => a.kind === kind)) component(a.id, a.amount, "charge");
    }
    for (const share of shares.values()) share.total = share.itemsGross - share.discountTotal + share.chargeTotal;
    return shares;
  }
}
