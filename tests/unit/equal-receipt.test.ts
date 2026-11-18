import { describe, expect, it } from "vitest";
import { EqualReceiptSplit } from "@/domain/receipt/EqualReceiptSplit";
import { ReceiptCalculator } from "@/domain/receipt/ReceiptCalculator";
import type { ReceiptInput } from "@/domain/receipt/types";

const calculator = new ReceiptCalculator();
const members = ["a", "b", "c"];
function receipt(amounts: bigint[], discount = 0n, charge = 0n): ReceiptInput {
  return {
    id: "r", label: "Dinner", payerId: "a", equalSplit: { memberIds: members },
    payable: amounts.reduce((a, b) => a + b, 0n) - discount + charge,
    lines: amounts.map((amount, position) => ({ id: `l${position}`, label: "Shared", position, amount, quantity: 1, mode: "SHARED", claims: members.map((memberId) => ({ memberId, units: 1 })) })),
    adjustments: [
      { id: "d", position: 0, kind: "DISCOUNT", label: "Discount", amount: discount, eligibleLineIds: "ALL" },
      { id: "s", position: 1, kind: "SERVICE", label: "Service", amount: charge, eligibleLineIds: "ALL" },
    ],
  };
}

describe("receipt-wide equal split", () => {
  it("does not silently include unconfirmed members or partial claims", () => {
    const r = receipt([100n]);
    r.lines[0].claims.pop();
    const result = calculator.calculate(r, members);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "EQUAL_SPLIT_UNCONFIRMED")).toBe(true);
  });

  it("balances final payable instead of giving one person every item’s rounding centavo", () => {
    const r = receipt(Array(10).fill(1n), 2n, 2n);
    const result = calculator.calculate(r, members);
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.shares.values()].map((s) => s.total)).toEqual([4n, 3n, 3n]);
  });

  it("conserves every component and final total across generated receipts", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const amounts = [BigInt(seed), BigInt(seed * 7 + 1), BigInt(seed * 3 + 2)];
      const r = receipt(amounts, BigInt(seed * 2), BigInt(seed % 13));
      const result = calculator.calculate(r, members);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const shares = [...result.shares.values()];
      for (const line of r.lines) expect(shares.reduce((n, s) => n + (s.lineShares.get(line.id) ?? 0n), 0n)).toBe(line.amount);
      for (const a of r.adjustments) {
        expect(shares.reduce((n, s) => n + ((a.kind === "DISCOUNT" ? s.discountShares : s.chargeShares).get(a.id) ?? 0n), 0n)).toBe(a.amount);
      }
      expect(shares.reduce((n, s) => n + s.total, 0n)).toBe(r.payable);
      expect(shares.every((s) => s.total >= 0n && s.total === s.itemsGross - s.discountTotal + s.chargeTotal)).toBe(true);
      const sorted = shares.map((s) => s.total).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      expect(sorted.at(-1)! - sorted[0]).toBeLessThanOrEqual(1n);
      expect(new EqualReceiptSplit().totals(r.payable, members)).toEqual(new Map(shares.map((s) => [s.memberId, s.total])));
    }
  });

  it("still rejects discounts and charges with invalid scopes/bases", () => {
    const r = receipt([100n], 100n, 10n);
    const result = calculator.calculate(r, members);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "ZERO_BASIS_CHARGE")).toBe(true);
  });

  it("keeps inactive roster members at zero", () => {
    const result = calculator.calculate(receipt([100n]), [...members, "departed"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shares.get("departed")!.total).toBe(0n);
  });
});
