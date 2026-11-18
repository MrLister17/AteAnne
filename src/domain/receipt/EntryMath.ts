/**
 * Exact helpers for typing a receipt by hand. They only fill in fields for the
 * person to see and correct; the server still recomputes and reconciles
 * everything when the receipt is saved.
 */
export class EntryMath {
  /** Quantity × price each, in centavos. Null when either part is missing. */
  static lineTotal(unitPrice: bigint | null, quantity: number): bigint | null {
    if (unitPrice === null || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    return unitPrice * BigInt(quantity);
  }

  /**
   * Parse a percentage like "10", "12.5" or "7.25%" into basis points
   * (1% = 100). Up to 2 decimals, at most 100%. Null when it isn't one.
   */
  static parsePercent(input: string): bigint | null {
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, "").trim());
    if (!m) return null;
    const bp = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
    return bp > 10_000n ? null : bp;
  }

  /** `percent` of `base` centavos, rounded half up to the centavo (receipts print it that way). */
  static percentOf(base: bigint, percent: string): bigint | null {
    const bp = EntryMath.parsePercent(percent);
    if (bp === null || base < 0n) return null;
    return (base * bp + 5_000n) / 10_000n;
  }
}
