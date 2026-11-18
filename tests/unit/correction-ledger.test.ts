import { describe, expect, it } from "vitest";
import { CorrectionLedger } from "@/domain/settlement/CorrectionLedger";

const ledger = new CorrectionLedger();

describe("append-only bill corrections", () => {
  it("carries confirmed money forward without asking for it twice", () => {
    const balances = [["payer", 10000n], ["diner", -10000n]] as const;
    const money = [{ from: "diner", to: "payer", amount: 3000n }];
    expect(ledger.plan(balances, money)).toEqual([{ from: "diner", to: "payer", amount: 7000n }]);
  });

  it("turns overpayments into return transfers and conserves every centavo", () => {
    const balances = [["a", 2000n], ["b", -1000n], ["c", -1000n]] as const;
    const money = [{ from: "b", to: "a", amount: 5000n }, { from: "c", to: "a", amount: 2000n }];
    expect([...ledger.remaining(balances, money)]).toEqual([["a", -5000n], ["b", 4000n], ["c", 1000n]]);
    expect(ledger.plan(balances, money)).toEqual([{ from: "a", to: "b", amount: 4000n }, { from: "a", to: "c", amount: 1000n }]);
  });

  it("supports repeated correction rounds without double counting prior money", () => {
    expect(ledger.plan([["a", 0n], ["b", 0n]], [
      { from: "b", to: "a", amount: 5000n },
      { from: "a", to: "b", amount: 5000n },
    ])).toEqual([]);
  });

  it("rejects unknown identities or non-conserved balances", () => {
    expect(() => ledger.remaining([["a", 0n]], [{ from: "x", to: "a", amount: 1n }])).toThrow(/outside the roster/);
    expect(() => ledger.plan([["a", 1n]], [])).toThrow(/conserve/);
  });
});
