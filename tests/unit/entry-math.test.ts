import { describe, expect, it } from "vitest";
import { EntryMath } from "@/domain/receipt/EntryMath";

describe("EntryMath", () => {
  it("multiplies quantity by price each exactly", () => {
    expect(EntryMath.lineTotal(18000n, 2)).toBe(36000n);
    expect(EntryMath.lineTotal(1999n, 3)).toBe(5997n);
    expect(EntryMath.lineTotal(null, 2)).toBeNull();
    expect(EntryMath.lineTotal(100n, 0)).toBeNull();
  });
  it("parses percentages to basis points", () => {
    expect(EntryMath.parsePercent("10")).toBe(1000n);
    expect(EntryMath.parsePercent("12.5")).toBe(1250n);
    expect(EntryMath.parsePercent("7.25%")).toBe(725n);
    expect(EntryMath.parsePercent("100")).toBe(10000n);
    for (const bad of ["", "abc", "101", "1.234", "-5", "10%%"]) expect(EntryMath.parsePercent(bad)).toBeNull();
  });
  it("takes a percentage of an amount, rounding half up to the centavo", () => {
    expect(EntryMath.percentOf(123450n, "10")).toBe(12345n); // 10% of 1,234.50
    expect(EntryMath.percentOf(12345n, "10")).toBe(1235n); // 123.45 → 12.345 → 12.35
    expect(EntryMath.percentOf(12344n, "10")).toBe(1234n);
    expect(EntryMath.percentOf(100000n, "12.5")).toBe(12500n);
    expect(EntryMath.percentOf(100000n, "x")).toBeNull();
  });
});
