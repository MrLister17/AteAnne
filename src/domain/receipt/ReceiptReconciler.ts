import { CalculationIssue, ReceiptInput } from "./types";

export interface ReconciliationResult {
  grossItems: bigint;
  discounts: bigint;
  charges: bigint;
  /** grossItems − discounts + charges. */
  computedPayable: bigint;
  payable: bigint;
  /** payable − computedPayable; zero when reconciled. */
  difference: bigint;
  reconciled: boolean;
  issues: CalculationIssue[];
}

/**
 * Entry-time check that a manually entered receipt adds up before anyone
 * claims anything: Σ lines − Σ discounts + Σ charges must equal the exact
 * merchant payable total, and every adjustment must have an eligible base.
 */
export class ReceiptReconciler {
  reconcile(receipt: ReceiptInput): ReconciliationResult {
    const issues: CalculationIssue[] = [];
    const lineById = new Map(receipt.lines.map((l) => [l.id, l]));
    const grossItems = receipt.lines.reduce((a, l) => a + l.amount, 0n);
    let discounts = 0n;
    let charges = 0n;

    if (receipt.lines.length === 0) {
      issues.push({ code: "NO_LINES", receiptId: receipt.id, message: "Add at least one item line." });
    }

    for (const adj of receipt.adjustments) {
      const scope = adj.eligibleLineIds === "ALL" ? receipt.lines : adj.eligibleLineIds.map((id) => lineById.get(id));
      if (scope.some((l) => l === undefined)) {
        issues.push({ code: "UNKNOWN_LINE_SCOPE", receiptId: receipt.id, adjustmentId: adj.id, message: `"${adj.label}" refers to a line that no longer exists.` });
        continue;
      }
      const base = scope.reduce((a, l) => a + (l?.amount ?? 0n), 0n);
      if (adj.kind === "DISCOUNT") {
        discounts += adj.amount;
        if (adj.amount > base) {
          issues.push({ code: "DISCOUNT_EXCEEDS_BASE", receiptId: receipt.id, adjustmentId: adj.id, message: `Discount "${adj.label}" is larger than the items it applies to.` });
        }
      } else {
        charges += adj.amount;
        if (adj.amount > 0n && base === 0n) {
          issues.push({ code: "ZERO_BASIS_CHARGE", receiptId: receipt.id, adjustmentId: adj.id, message: `Charge "${adj.label}" applies to items worth PHP 0.00, so it cannot be split proportionally.` });
        }
      }
    }

    const computedPayable = grossItems - discounts + charges;
    const difference = receipt.payable - computedPayable;
    if (difference !== 0n) {
      issues.push({ code: "RECONCILIATION_MISMATCH", receiptId: receipt.id, message: "Items, discounts and charges do not add up to the payable total." });
    }
    return { grossItems, discounts, charges, computedPayable, payable: receipt.payable, difference, reconciled: issues.length === 0, issues };
  }
}
