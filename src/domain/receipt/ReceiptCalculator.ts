import { LargestRemainderAllocator } from "../allocation/LargestRemainderAllocator";
import { ReceiptReconciler } from "./ReceiptReconciler";
import { EqualReceiptSplit } from "./EqualReceiptSplit";
import { AdjustmentInput, CalculationIssue, LineInput, MemberReceiptShare, ReceiptInput } from "./types";

export type ReceiptCalculation =
  | { ok: true; receiptId: string; shares: Map<string, MemberReceiptShare> }
  | { ok: false; receiptId: string; issues: CalculationIssue[] };

/**
 * Turns one reconciled receipt plus its current-version claims into exact
 * per-member shares, following the specification's order:
 *
 *  1. allocate each line total to its consumers (shared-equal or units);
 *  2. for each discount in entered order, split it across eligible lines by
 *     remaining line value, then across each line's consumers by remaining
 *     share (largest remainder at both levels);
 *  3. split service, then other additive charges, proportionally to each
 *     member's eligible post-discount item spending (no compounding).
 *
 * Every allocation sums exactly; a positive charge with zero person-level
 * basis is reported as an issue rather than silently split equally.
 */
export class ReceiptCalculator {
  constructor(
    private readonly allocator = new LargestRemainderAllocator(),
    private readonly reconciler = new ReceiptReconciler(),
  ) {}

  /** `memberOrder` is the stable participant order used for tie-breaking. */
  calculate(receipt: ReceiptInput, memberOrder: readonly string[]): ReceiptCalculation {
    const equal = new EqualReceiptSplit(this.allocator);
    const issues = [...this.reconciler.reconcile(receipt).issues, ...this.claimIssues(receipt), ...equal.issues(receipt)];
    if (issues.length) return { ok: false, receiptId: receipt.id, issues };

    const rank = new Map(memberOrder.map((id, i) => [id, i]));
    const lines = [...receipt.lines].sort((a, b) => a.position - b.position);
    const shares = new Map<string, MemberReceiptShare>();
    const shareOf = (memberId: string) => {
      let s = shares.get(memberId);
      if (!s) {
        s = { memberId, lineShares: new Map(), discountShares: new Map(), chargeShares: new Map(), itemsGross: 0n, discountTotal: 0n, chargeTotal: 0n, total: 0n };
        shares.set(memberId, s);
      }
      return s;
    };
    for (const id of memberOrder) shareOf(id);

    // 1. Gross line allocation. remaining[lineId] = member → post-discount share.
    const remaining = new Map<string, Map<string, bigint>>();
    for (const line of lines) {
      const claims = [...line.claims].sort((a, b) => (rank.get(a.memberId) ?? 1e9) - (rank.get(b.memberId) ?? 1e9));
      const entries = claims.map((c) => ({ key: c.memberId, weight: line.mode === "SHARED" ? 1 : c.units }));
      const split = line.amount === 0n && entries.length === 0 ? new Map<string, bigint>() : this.allocator.allocate(line.amount, entries);
      remaining.set(line.id, new Map(split));
      for (const [memberId, amount] of split) {
        const s = shareOf(memberId);
        s.lineShares.set(line.id, amount);
        s.itemsGross += amount;
      }
    }

    const adjustments = [...receipt.adjustments].sort((a, b) => a.position - b.position);
    const scopeOf = (adj: AdjustmentInput): LineInput[] =>
      adj.eligibleLineIds === "ALL" ? lines : lines.filter((l) => (adj.eligibleLineIds as string[]).includes(l.id));
    const ordered = (m: Map<string, bigint>) =>
      [...m.entries()].sort((a, b) => (rank.get(a[0]) ?? 1e9) - (rank.get(b[0]) ?? 1e9)).map(([key, weight]) => ({ key, weight }));

    // 2. Discounts, line level then member level.
    for (const adj of adjustments.filter((a) => a.kind === "DISCOUNT")) {
      if (adj.amount === 0n) continue;
      const scope = scopeOf(adj);
      const lineEntries = scope.map((l) => ({ key: l.id, weight: sum(remaining.get(l.id)!) }));
      const base = lineEntries.reduce((a, e) => a + e.weight, 0n);
      if (adj.amount > base) {
        return { ok: false, receiptId: receipt.id, issues: [{ code: "DISCOUNT_EXCEEDS_BASE", receiptId: receipt.id, adjustmentId: adj.id, message: `Discount "${adj.label}" exceeds its remaining eligible items` }] };
      }
      const perLine = this.allocator.allocate(adj.amount, lineEntries);
      for (const [lineId, lineDiscount] of perLine) {
        if (lineDiscount === 0n) continue;
        const rem = remaining.get(lineId)!;
        const perMember = this.allocator.allocate(lineDiscount, ordered(rem));
        for (const [memberId, d] of perMember) {
          rem.set(memberId, rem.get(memberId)! - d);
          const s = shareOf(memberId);
          s.discountShares.set(adj.id, (s.discountShares.get(adj.id) ?? 0n) + d);
          s.discountTotal += d;
        }
      }
    }

    // 3. Service first, then other charges — all on post-discount item spending.
    const charges = [...adjustments.filter((a) => a.kind === "SERVICE"), ...adjustments.filter((a) => a.kind === "CHARGE")];
    for (const adj of charges) {
      const basis = new Map<string, bigint>();
      for (const line of scopeOf(adj)) {
        for (const [memberId, v] of remaining.get(line.id)!) basis.set(memberId, (basis.get(memberId) ?? 0n) + v);
      }
      const entries = ordered(basis);
      const basisTotal = entries.reduce((a, e) => a + e.weight, 0n);
      if (adj.amount > 0n && basisTotal === 0n) {
        return { ok: false, receiptId: receipt.id, issues: [{ code: "ZERO_BASIS_CHARGE", receiptId: receipt.id, adjustmentId: adj.id, message: `"${adj.label}" has no eligible spending to be proportional to, so correct the receipt explicitly` }] };
      }
      if (adj.amount === 0n) continue;
      for (const [memberId, c] of this.allocator.allocate(adj.amount, entries)) {
        const s = shareOf(memberId);
        s.chargeShares.set(adj.id, (s.chargeShares.get(adj.id) ?? 0n) + c);
        s.chargeTotal += c;
      }
    }

    let total = 0n;
    for (const s of shares.values()) {
      s.total = s.itemsGross - s.discountTotal + s.chargeTotal;
      if (s.total < 0n) throw new Error(`Invariant violated: negative share for ${s.memberId}`);
      total += s.total;
    }
    if (total !== receipt.payable) throw new Error(`Invariant violated: receipt ${receipt.id} allocates ${total}, payable ${receipt.payable}`);
    return { ok: true, receiptId: receipt.id, shares: receipt.equalSplit ? equal.calculate(receipt, memberOrder) : shares };
  }

  /** Completeness of claims: every positive line fully allocated. */
  claimIssues(receipt: ReceiptInput): CalculationIssue[] {
    const issues: CalculationIssue[] = [];
    for (const line of receipt.lines) {
      if (line.mode === "SHARED") {
        if (line.amount > 0n && line.claims.length === 0) {
          issues.push({ code: "LINE_UNALLOCATED", receiptId: receipt.id, lineId: line.id, message: `Nobody has claimed "${line.label}" yet` });
        }
      } else {
        const claimed = line.claims.reduce((a, c) => a + c.units, 0);
        if (claimed > line.quantity) {
          issues.push({ code: "UNITS_OVER_ALLOCATED", receiptId: receipt.id, lineId: line.id, message: `"${line.label}": ${claimed} of ${line.quantity} units claimed` });
        } else if (claimed < line.quantity && (line.amount > 0n || claimed > 0)) {
          issues.push({ code: "UNITS_UNDER_ALLOCATED", receiptId: receipt.id, lineId: line.id, message: `"${line.label}": ${claimed} of ${line.quantity} units assigned` });
        }
      }
    }
    return issues;
  }
}

function sum(m: Map<string, bigint>): bigint {
  let t = 0n;
  for (const v of m.values()) t += v;
  return t;
}
