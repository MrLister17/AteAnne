import { describe, expect, it } from "vitest";
import { addDays, formatMinor, manilaDay, minorToInput, parseMajor, shortDay } from "@/domain/money/Currency";
import { Decimal, ExchangeRate, rateFromDay, roundSignificant } from "@/domain/fx/ExchangeRate";
import { Fraction } from "@/domain/money/Fraction";
import { ReceiptConverter } from "@/domain/receipt/ReceiptConverter";
import { ReceiptCalculator } from "@/domain/receipt/ReceiptCalculator";
import { ForeignPayment } from "@/domain/payments/ForeignPayment";
import { EventLedger } from "@/domain/event/EventLedger";
import type { ReceiptInput } from "@/domain/receipt/types";

/** The plan's worked example (made-up rates): PHP 65 and THB 40 per euro → 1 THB = 1.625 PHP. */
const perEur = (php: string, thb: string, date = "2026-11-18") => ({ day: date, effectiveDate: date, perEur: { PHP: php, THB: thb, JPY: "162.5", IDR: "18055.5", USD: "1.08" }, source: "ecb" });
const thbToPhp = rateFromDay(perEur("65", "40"), "THB", "PHP")!;

describe("Currency", () => {
  it("formats two- and zero-decimal currencies, keeping the existing peso format", () => {
    expect(formatMinor(49500n, "PHP")).toBe("PHP 495.00");
    expect(formatMinor(139700n, "THB")).toBe("THB 1,397.00");
    expect(formatMinor(12000n, "JPY")).toBe("JPY 12,000");
    expect(formatMinor(-5n, "THB")).toBe("THB -0.05");
  });
  it("parses typed amounts per currency", () => {
    expect(parseMajor("1,397.5", "THB")).toBe(139750n);
    expect(parseMajor("฿22.50", "THB")).toBe(2250n);
    expect(parseMajor("THB 10", "THB")).toBe(1000n);
    expect(parseMajor("12,000", "JPY")).toBe(12000n);
    expect(parseMajor("500.00", "JPY")).toBe(500n);
    for (const bad of ["12.5", "abc", "-1", ""]) expect(() => parseMajor(bad, "JPY")).toThrow();
    for (const bad of ["1.234", "x", "1e3"]) expect(() => parseMajor(bad, "THB")).toThrow();
    expect(() => parseMajor("1", "XXX")).toThrow();
  });
  it("round-trips editable text", () => {
    expect(minorToInput(139750n, "THB")).toBe("1397.50");
    expect(minorToInput(18000n, "PHP")).toBe("180");
    expect(minorToInput(12000n, "JPY")).toBe("12000");
  });
  it("uses the Manila calendar", () => {
    expect(manilaDay(new Date("2026-11-18T16:30:00Z"))).toBe("2026-11-19");
    expect(manilaDay(new Date("2026-11-18T15:59:00Z"))).toBe("2026-11-18");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(shortDay("2026-11-18")).toBe("18 Nov");
  });
});

describe("ExchangeRate", () => {
  it("parses decimals exactly and never from floats", () => {
    expect(Decimal.parse("37.832").toString()).toBe("37.832");
    expect(Decimal.parse("40").toString()).toBe("40");
    expect(() => Decimal.parse("1e3")).toThrow();
  });
  it("rounds cross rates half-up to 8 significant digits", () => {
    expect(roundSignificant(new Fraction(13n, 8n)).toString()).toBe("1.625");
    expect(roundSignificant(new Fraction(2n, 3n)).toString()).toBe("0.66666667");
    expect(roundSignificant(new Fraction(65n, 18055n)).toString()).toBe("0.0036001108");
    expect(roundSignificant(new Fraction(18055n, 65n)).toString()).toBe("277.76923");
    expect(roundSignificant(new Fraction(999999999n, 10n)).toString()).toBe("100000000");
  });
  it("builds the plan's THB→PHP rate from per-euro quotes", () => {
    expect(thbToPhp.rateText()).toBe("1.625");
    expect(thbToPhp.date).toBe("2026-11-18");
    expect(ExchangeRate.fromWire(thbToPhp.toWire()).rateText()).toBe("1.625");
  });
  it("converts with one multiplication and half-up rounding (plan §2)", () => {
    expect(thbToPhp.convert(139700n)).toBe(227013n); // 2,270.125 → 2,270.13
    expect(thbToPhp.convert(69850n)).toBe(113506n); // 1,135.0625 → 1,135.06
    expect(thbToPhp.convertBack(113506n)).toBe(69850n);
  });
  it("adjusts for zero-decimal currencies", () => {
    const jpy = rateFromDay(perEur("65", "40"), "JPY", "PHP")!; // 65 / 162.5 = 0.4
    expect(jpy.rateText()).toBe("0.4");
    expect(jpy.convert(1200n)).toBe(48000n); // JPY 1,200 → PHP 480.00
    expect(jpy.convertBack(48000n)).toBe(1200n);
  });
  it("refuses missing and stale tables", () => {
    expect(rateFromDay(null, "THB", "PHP")).toBeNull();
    expect(rateFromDay({ ...perEur("65", "40"), day: "2026-11-26" }, "THB", "PHP")).toBeNull(); // 8 days old
    expect(rateFromDay({ ...perEur("65", "40"), day: "2026-11-25" }, "THB", "PHP")).not.toBeNull(); // 7 days old
    expect(rateFromDay(perEur("65", "40"), "THB", "KRW")).toBeNull();
    expect(rateFromDay(perEur("65", "40"), "EUR", "PHP")!.rateText()).toBe("65");
  });
});

const calc = new ReceiptCalculator();
const breakfast: ReceiptInput = {
  id: "breakfast",
  label: "Breakfast",
  payerId: "mark",
  payable: 139700n,
  equalSplit: { memberIds: ["mark", "ana"] },
  lines: [{ id: "l1", position: 0, label: "Set", quantity: 1, amount: 139700n, mode: "SHARED", claims: [{ memberId: "mark", units: 1 }, { memberId: "ana", units: 1 }] }],
  adjustments: [],
};

describe("ReceiptConverter", () => {
  it("converts the payable once, then splits it so the receipt still adds up (plan §2)", () => {
    const r = calc.calculate(breakfast, ["mark", "ana"]);
    if (!r.ok) throw new Error("calc");
    const out = new ReceiptConverter().convert(139700n, r.shares, ["mark", "ana"], thbToPhp);
    expect(out.payable).toBe(227013n);
    expect(out.shares.get("mark")).toBe(113507n); // the extra centavo goes to join order
    expect(out.shares.get("ana")).toBe(113506n);
  });

  it("is the identity when no rate applies, and conserves over many generated receipts", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const rates = [thbToPhp, rateFromDay(perEur("65", "40"), "JPY", "PHP")!, rateFromDay(perEur("65", "40"), "PHP", "IDR")!, rateFromDay(perEur("61.5", "37.832"), "THB", "PHP")!];
    for (let i = 0; i < 600; i++) {
      const people = ["a", "b", "c", "d"].slice(0, 1 + (next() % 4));
      const lines = Array.from({ length: 1 + (next() % 4) }, (_, k) => ({
        id: `l${k}`,
        position: k,
        label: `L${k}`,
        quantity: 1,
        amount: BigInt(1 + (next() % 500000)),
        mode: "SHARED" as const,
        claims: people.filter(() => next() % 3 !== 0).map((memberId) => ({ memberId, units: 1 })),
      })).map((l) => (l.claims.length ? l : { ...l, claims: [{ memberId: people[0], units: 1 }] }));
      const payable = lines.reduce((a, l) => a + l.amount, 0n);
      const r = calc.calculate({ id: "r", label: "R", payerId: people[0], payable, lines, adjustments: [] }, people);
      if (!r.ok) throw new Error("calc");
      const same = new ReceiptConverter().convert(payable, r.shares, people, null);
      for (const [id, s] of r.shares) expect(same.shares.get(id)).toBe(s.total);
      const rate = rates[i % rates.length];
      const out = new ReceiptConverter().convert(payable, r.shares, people, rate);
      expect([...out.shares.values()].reduce((a, v) => a + v, 0n)).toBe(out.payable);
      expect(out.payable).toBe(rate.convert(payable));
      for (const v of out.shares.values()) expect(v >= 0n).toBe(true);
    }
  });
});

describe("EventLedger with mixed currencies", () => {
  const snacks: ReceiptInput = {
    id: "snacks",
    label: "Airport snacks",
    payerId: "ana",
    payable: 60000n,
    lines: [{ id: "s1", position: 0, label: "Snacks", quantity: 1, amount: 60000n, mode: "SHARED", claims: [{ memberId: "mark", units: 1 }, { memberId: "ana", units: 1 }] }],
    adjustments: [],
  };

  it("nets the plan's example: Ana pays Mark PHP 835.06", () => {
    const out = new EventLedger().calculate([snacks, { ...breakfast, conversion: { currency: "THB", day: "2026-11-18", rate: thbToPhp } }], ["mark", "ana"]);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const ana = out.positions.find((p) => p.memberId === "ana")!;
    expect(ana.funding).toBe(60000n);
    expect(ana.cost).toBe(30000n + 113506n);
    expect(ana.net).toBe(-83506n);
    expect(out.edges).toEqual([{ from: "ana", to: "mark", amount: 83506n }]);
    const st = out.receipts.find((r) => r.receiptId === "breakfast")!;
    expect(st.payable).toBe(139700n);
    expect(st.settlePayable).toBe(227013n);
    expect(st.rate?.rateText()).toBe("1.625");
  });

  it("waits, never guesses, when a rate is missing", () => {
    const out = new EventLedger().calculate([{ ...breakfast, conversion: { currency: "THB", day: "2026-11-19", rate: null } }], ["mark", "ana"]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues[0]).toMatchObject({ code: "RATE_UNAVAILABLE", message: "Waiting for the 19 Nov THB exchange rate." });
  });
});

describe("ForeignPayment", () => {
  // Payment day, made-up: 1 THB = 1.63 PHP.
  const rate = rateFromDay(perEur("65.2", "40", "2026-11-25"), "THB", "PHP")!;
  const pay = new ForeignPayment(rate);

  it("clears the full transfer exactly (plan §2: send THB 512.31 for PHP 835.06)", () => {
    expect(rate.rateText()).toBe("1.63");
    expect(pay.toSend(83506n)).toBe(51231n);
    expect(pay.creditFor(51231n, 83506n)).toBe(83506n);
  });
  it("credits partial payments half-up and refuses more than the full amount", () => {
    expect(pay.creditFor(30000n, 83506n)).toBe(48900n); // THB 300 × 1.63
    expect(() => pay.creditFor(51232n, 83506n)).toThrow(/At most THB 512.31/);
    expect(() => pay.creditFor(0n, 83506n)).toThrow();
  });
  it("snaps to the capacity when rounding the full amount down", () => {
    expect(pay.toSend(100n)).toBe(61n); // 100 / 1.63 = 61.3
    expect(rate.convert(61n)).toBe(99n);
    expect(pay.creditFor(61n, 100n)).toBe(100n);
  });
  it("never credits more than the capacity, over many amounts", () => {
    const tiny = rateFromDay(perEur("65", "40"), "IDR", "PHP")!; // 1 IDR ≈ PHP 0.0036
    for (const r of [rate, tiny, rateFromDay(perEur("65", "40"), "JPY", "PHP")!]) {
      const p = new ForeignPayment(r);
      for (const capacity of [1n, 37n, 100n, 83506n, 99999999n]) {
        const full = p.toSend(capacity);
        if (full === 0n) {
          expect(() => p.creditFor(1n, capacity)).toThrow();
          continue;
        }
        expect(p.creditFor(full, capacity)).toBe(capacity);
        for (const sent of [1n, full / 3n, full - 1n].filter((x) => x > 0n)) {
          try {
            const c = p.creditFor(sent, capacity);
            expect(c > 0n && c <= capacity).toBe(true);
          } catch (e) {
            expect(String(e)).toMatch(/too small/);
          }
        }
      }
    }
  });
});
