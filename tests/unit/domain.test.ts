import { describe, expect, it } from "vitest";
import { Money } from "@/domain/money/Money";
import { LargestRemainderAllocator } from "@/domain/allocation/LargestRemainderAllocator";
import { ReceiptCalculator } from "@/domain/receipt/ReceiptCalculator";
import { EventLedger } from "@/domain/event/EventLedger";
import { PaymentLedger } from "@/domain/payments/PaymentLedger";
import { PhaseMachine, stepOf } from "@/domain/event/PhaseMachine";
import { AutoAdvance, type AdvanceFacts } from "@/domain/event/AutoAdvance";
import { SettlementPlanner } from "@/domain/settlement/SettlementPlanner";
import type { ReceiptInput } from "@/domain/receipt/types";

describe("Money", () => {
  it("parses pesos exactly", () => {
    expect(Money.parsePesos("1,234.5").centavos).toBe(123450n);
    expect(Money.parsePesos("180").centavos).toBe(18000n);
    expect(Money.parsePesos("0.07").centavos).toBe(7n);
    expect(Money.parsePesos("₱22.50").centavos).toBe(2250n);
  });
  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.", ".5x"]) expect(() => Money.parsePesos(bad)).toThrow();
  });
  it("formats with separators and sign", () => {
    expect(Money.of(462825n).format()).toBe("4,628.25");
    expect(Money.of(-49500n).toString()).toBe("PHP -495.00");
  });
  it("wire round trip uses decimal-string centavos", () => {
    expect(JSON.stringify({ a: Money.of(12550n) })).toBe('{"a":"12550"}');
    expect(Money.fromWire("12550").centavos).toBe(12550n);
    expect(() => Money.fromWire("12.5")).toThrow();
  });
  it("enforces the PHP 1,000,000 bound", () => {
    expect(() => Money.parsePesos("1000000.01").assertWithin()).toThrow();
    expect(Money.parsePesos("1000000").assertWithin().centavos).toBe(100000000n);
  });
});

/** Small deterministic PRNG so generated cases are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
}

describe("generated conservation checks", () => {
  const alloc = new LargestRemainderAllocator();
  it("allocation preserves sums, zero weights get zero, ties deterministic (2,000 cases)", () => {
    const r = rng(42);
    for (let n = 0; n < 2000; n++) {
      const total = BigInt(r() % 1_000_000);
      const k = 1 + (r() % 9);
      const entries = Array.from({ length: k }, (_, i) => ({ key: `m${i}`, weight: r() % 4 === 0 ? 0 : r() % 500 }));
      if (entries.every((e) => e.weight === 0)) entries[0].weight = 1;
      const a = alloc.allocate(total, entries);
      const b = alloc.allocate(total, entries);
      expect([...a.values()].reduce((x, y) => x + y, 0n)).toBe(total);
      for (const e of entries) {
        expect(a.get(e.key)! >= 0n).toBe(true);
        if (e.weight === 0) expect(a.get(e.key)).toBe(0n);
      }
      expect([...a]).toEqual([...b]);
    }
  });

  it("random receipts with discounts and service reconcile and net to zero (500 cases)", () => {
    const r = rng(7);
    const calc = new ReceiptCalculator();
    const planner = new SettlementPlanner();
    for (let n = 0; n < 500; n++) {
      const members = Array.from({ length: 2 + (r() % 7) }, (_, i) => `m${String(i).padStart(2, "0")}`);
      const lines = Array.from({ length: 1 + (r() % 6) }, (_, i) => {
        const units = r() % 2 === 0;
        const quantity = units ? 1 + (r() % 4) : 1;
        const claims: { memberId: string; units: number }[] = [];
        if (units) {
          for (let u = 0; u < quantity; u++) {
            const m = members[r() % members.length];
            const ex = claims.find((c) => c.memberId === m);
            if (ex) ex.units++;
            else claims.push({ memberId: m, units: 1 });
          }
        } else {
          for (const m of members) if (r() % 2 === 0) claims.push({ memberId: m, units: 1 });
          if (!claims.length) claims.push({ memberId: members[0], units: 1 });
        }
        return { id: `l${i}`, position: i, label: `L${i}`, quantity, amount: BigInt(1 + (r() % 50000)), mode: (units ? "UNITS" : "SHARED") as "UNITS" | "SHARED", claims };
      });
      const gross = lines.reduce((a, l) => a + l.amount, 0n);
      const eligible = lines.filter((_, i) => i % 2 === 0);
      const eligibleGross = eligible.reduce((a, l) => a + l.amount, 0n);
      const discount = BigInt(r()) % (eligibleGross + 1n);
      const service = BigInt(r() % 10000);
      const receipt: ReceiptInput = {
        id: `r${n}`,
        label: "gen",
        payerId: members[r() % members.length],
        payable: gross - discount + service,
        lines,
        adjustments: [
          { id: "d", position: 0, kind: "DISCOUNT", label: "d", amount: discount, eligibleLineIds: eligible.map((l) => l.id) },
          { id: "s", position: 1, kind: "SERVICE", label: "s", amount: service, eligibleLineIds: "ALL" },
        ],
      };
      const res = calc.calculate(receipt, members);
      if (!res.ok) {
        // Only acceptable failure: full discount leaves zero service basis.
        expect(res.issues.every((i) => i.code === "ZERO_BASIS_CHARGE")).toBe(true);
        continue;
      }
      let total = 0n;
      for (const s of res.shares.values()) {
        expect(s.total >= 0n).toBe(true);
        total += s.total;
      }
      expect(total).toBe(receipt.payable);
      const ev = new EventLedger().calculate([receipt], members);
      if (!ev.ok) throw new Error("event calc failed");
      expect(ev.positions.reduce((a, p) => a + p.net, 0n)).toBe(0n);
      // every edge settles the nets completely
      const after = new Map(ev.positions.map((p) => [p.memberId, p.net]));
      for (const e of planner.plan([...after])) {
        after.set(e.from, after.get(e.from)! + e.amount);
        after.set(e.to, after.get(e.to)! - e.amount);
      }
      for (const v of after.values()) expect(v).toBe(0n);
    }
  });
});

describe("ReceiptCalculator issues", () => {
  const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
    id: "r",
    label: "R",
    payerId: "a",
    payable: 30000n,
    lines: [{ id: "l1", position: 0, label: "Rice", quantity: 3, amount: 30000n, mode: "UNITS", claims: [{ memberId: "a", units: 2 }] }],
    adjustments: [],
    ...over,
  });
  it("under-allocated units block calculation", () => {
    const r = new ReceiptCalculator().calculate(base(), ["a", "b"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("UNITS_UNDER_ALLOCATED");
  });
  it("service with zero person basis is rejected, never split equally", () => {
    const r = new ReceiptCalculator().calculate(
      base({
        payable: 30100n,
        lines: [
          { id: "l1", position: 0, label: "Rice", quantity: 1, amount: 30000n, mode: "SHARED", claims: [{ memberId: "a", units: 1 }] },
          { id: "l2", position: 1, label: "Free water", quantity: 1, amount: 0n, mode: "SHARED", claims: [{ memberId: "b", units: 1 }] },
        ],
        adjustments: [{ id: "s", position: 0, kind: "SERVICE", label: "Corkage", amount: 100n, eligibleLineIds: ["l2"] }],
      }),
      ["a", "b"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("ZERO_BASIS_CHARGE");
  });
  it("a payer can also owe; a member who consumed nothing owes zero", () => {
    const receipt = base({ lines: [{ id: "l1", position: 0, label: "Rice", quantity: 3, amount: 30000n, mode: "UNITS", claims: [{ memberId: "a", units: 1 }, { memberId: "b", units: 2 }] }] });
    const ev = new EventLedger().calculate([receipt], ["a", "b", "c"]);
    if (!ev.ok) throw new Error();
    expect(ev.positions.map((p) => [p.memberId, p.funding, p.cost, p.net])).toEqual([
      ["a", 30000n, 10000n, 20000n],
      ["b", 0n, 20000n, -20000n],
      ["c", 0n, 0n, 0n],
    ]);
  });
});

describe("PaymentLedger", () => {
  const edges = [{ id: "e1", from: "paolo", to: "mark", amount: 80000n }];
  it("pending reserves capacity but leaves verified balance unchanged", () => {
    const l = new PaymentLedger(edges, [{ id: "r1", edgeId: "e1", amount: 30000n, status: "REPORTED", reversed: false }]);
    const s = l.edgeState("e1");
    expect([s.verified, s.pending, s.outstanding, s.capacity]).toEqual([0n, 30000n, 80000n, 50000n]);
    expect(() => l.assertCanReport("e1", "paolo", 50001n)).toThrow(/At most/);
    expect(() => l.assertCanReport("e1", "mark", 100n)).toThrow(/named sender/);
  });
  it("disputed edge blocks new reports except an agreed replacement", () => {
    const l = new PaymentLedger(edges, [], [{ edgeId: "e1", open: true, awaitingReplacement: true }]);
    expect(() => l.assertCanReport("e1", "paolo", 100n)).toThrow(/Resolve this/);
    expect(() => l.assertCanReport("e1", "paolo", 100n, { isAgreedReplacement: true })).not.toThrow();
  });
  it("only the recipient decides, only pending", () => {
    expect(() => PaymentLedger.assertCanDecide({ recipientId: "mark", status: "REPORTED" }, "paolo")).toThrow();
    expect(() => PaymentLedger.assertCanDecide({ recipientId: "mark", status: "REJECTED" }, "mark")).toThrow();
  });
});

describe("PhaseMachine", () => {
  it("guards transitions (v0.7: Add & claim → Pay → Done; corrections go back to Add & claim)", () => {
    expect(new PhaseMachine("COLLECTING").canMoveTo("SETTLING")).toBe(true);
    expect(new PhaseMachine("COLLECTING").canMoveTo("ALLOCATING")).toBe(false);
    expect(new PhaseMachine("COLLECTING").canMoveTo("DONE")).toBe(false);
    expect(new PhaseMachine("SETTLING").canMoveTo("COLLECTING")).toBe(true);
    expect(new PhaseMachine("SETTLING").canMoveTo("REVIEWING")).toBe(false);
    // Events started before v0.7 can still finish.
    expect(new PhaseMachine("ALLOCATING").canMoveTo("SETTLING")).toBe(true);
    expect(new PhaseMachine("REVIEWING").canMoveTo("SETTLING")).toBe(true);
    expect(new PhaseMachine("DONE").canMoveTo("SETTLING")).toBe(false);
    expect(() => new PhaseMachine("SETTLING").assertIn("COLLECTING")).toThrow();
  });

  it("shows three steps", () => {
    expect(stepOf("COLLECTING")).toEqual({ index: 0, label: "Add & claim" });
    expect(stepOf("ALLOCATING").index).toBe(0);
    expect(stepOf("REVIEWING").index).toBe(0);
    expect(stepOf("SETTLING")).toEqual({ index: 1, label: "Pay" });
    expect(stepOf("DONE")).toEqual({ index: 2, label: "Done" });
  });
});

describe("AutoAdvance", () => {
  const base: AdvanceFacts = { phase: "COLLECTING", cancelled: false, rosterLocked: true, hasStatement: false, freezeReady: true };

  it("freezes the first statement once the roster is closed and everyone is done", () => {
    expect(AutoAdvance.next(base)).toBe("SETTLING");
    expect(AutoAdvance.next({ ...base, phase: "ALLOCATING" })).toBe("SETTLING");
    expect(AutoAdvance.next({ ...base, phase: "REVIEWING" })).toBe("SETTLING");
  });

  it("waits while anyone can still join, someone isn't done, or the event is cancelled", () => {
    expect(AutoAdvance.next({ ...base, rosterLocked: false })).toBeNull();
    expect(AutoAdvance.next({ ...base, freezeReady: false })).toBeNull();
    expect(AutoAdvance.next({ ...base, cancelled: true })).toBeNull();
  });

  it("never re-freezes by itself after a correction, and never moves a paying or done event", () => {
    expect(AutoAdvance.next({ ...base, hasStatement: true })).toBeNull();
    expect(AutoAdvance.next({ ...base, phase: "SETTLING" })).toBeNull();
    expect(AutoAdvance.next({ ...base, phase: "DONE" })).toBeNull();
  });

  it("closes a fully paid event one day after the last payment activity, leaving time to undo a mistake", () => {
    const last = new Date("2026-11-18T10:00:00Z");
    const at = (hours: number) => new Date(last.getTime() + hours * 3_600_000);
    const close = { phase: "SETTLING" as const, doneReady: true, lastActivityAt: last };
    expect(AutoAdvance.shouldClose({ ...close, now: at(23.9) })).toBe(false);
    expect(AutoAdvance.shouldClose({ ...close, now: at(24) })).toBe(true);
    expect(AutoAdvance.shouldClose({ ...close, doneReady: false, now: at(48) })).toBe(false);
    expect(AutoAdvance.shouldClose({ ...close, phase: "DONE", now: at(48) })).toBe(false);
  });
});
