import { ValidationError } from "../errors";
import { Fraction } from "../money/Fraction";
import { currencyInfo, pow10 } from "../money/Currency";

/** Significant digits kept in every rate AteAnne stores, shows and uses (D63 rule 2). */
export const RATE_SIGNIFICANT_DIGITS = 8;
export const ECB_SOURCE = "ecb";

const DECIMAL = /^(\d{1,12})(?:\.(\d{1,12}))?$/;

/** An exact non-negative decimal: value / 10^scale. Parsed from text, never from a float. */
export class Decimal {
  constructor(
    readonly value: bigint,
    readonly scale: number,
  ) {
    if (value < 0n || scale < 0 || !Number.isInteger(scale)) throw new ValidationError("bad_decimal", "Decimals must be non-negative");
  }

  static parse(text: string): Decimal {
    const m = DECIMAL.exec(text.trim());
    if (!m) throw new ValidationError("bad_decimal", `"${text}" is not a plain decimal number`);
    const frac = m[2] ?? "";
    return new Decimal(BigInt(m[1] + frac), frac.length);
  }

  toFraction(): Fraction {
    return new Fraction(this.value, pow10(this.scale));
  }

  /** Plain text without trailing zeros ("1.625", "40"). */
  toString(): string {
    const digits = this.value.toString().padStart(this.scale + 1, "0");
    if (this.scale === 0) return digits;
    const whole = digits.slice(0, digits.length - this.scale);
    const frac = digits.slice(digits.length - this.scale).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole;
  }
}

/** floor(x + ½) for a non-negative exact fraction: half-up to a whole number. */
export function halfUp(x: Fraction): bigint {
  if (x.isNegative()) throw new ValidationError("negative_money", "Only non-negative amounts are converted");
  return x.plus(new Fraction(1n, 2n)).floor();
}

/** Round a positive fraction half-up to `digits` significant digits, as an exact decimal. */
export function roundSignificant(x: Fraction, digits = RATE_SIGNIFICANT_DIGITS): Decimal {
  if (x.isZero() || x.isNegative()) throw new ValidationError("bad_rate", "A rate must be positive");
  // Position of the first significant digit: 1.625 → 1, 280.5 → 3, 0.36 → 0, 0.0036 → −2.
  let intDigits: number;
  if (x.floor() > 0n) {
    intDigits = x.floor().toString().length;
  } else {
    let k = 1;
    while (x.times(new Fraction(pow10(k))).floor() === 0n) k++;
    intDigits = 1 - k;
  }
  const scale = Math.max(0, digits - intDigits);
  return new Decimal(halfUp(x.times(new Fraction(pow10(scale)))), scale);
}

export type RateWire = {
  /** 1 `base` = `rate` `quote`. */
  base: string;
  quote: string;
  rate: string;
  /** The ECB date this rate was published for (YYYY-MM-DD). */
  date: string;
  source: string;
};

/**
 * "1 base = rate quote", exact. Used two ways, always foreign → settle-up:
 * a THB receipt in a peso event is converted with THB→PHP, and a payment sent
 * in baht against a peso transfer is credited with THB→PHP.
 */
export class ExchangeRate {
  constructor(
    readonly base: string,
    readonly quote: string,
    readonly rate: Decimal,
    readonly date: string,
    readonly source: string = ECB_SOURCE,
  ) {
    currencyInfo(base);
    currencyInfo(quote);
    if (rate.value === 0n) throw new ValidationError("bad_rate", "A rate must be positive");
  }

  /**
   * Cross rate from the ECB's per-euro quotes:
   * (quote per EUR) ÷ (base per EUR), rounded half-up to 8 significant digits.
   */
  static fromPerEur(base: string, quote: string, basePerEur: Decimal, quotePerEur: Decimal, date: string, source = ECB_SOURCE): ExchangeRate {
    const exact = quotePerEur.toFraction().dividedBy(basePerEur.toFraction());
    return new ExchangeRate(base, quote, roundSignificant(exact), date, source);
  }

  static fromWire(w: RateWire): ExchangeRate {
    return new ExchangeRate(w.base, w.quote, Decimal.parse(w.rate), w.date, w.source);
  }

  /** Minor units of base → minor units of quote, as an exact fraction. */
  private factor(): Fraction {
    const shift = currencyInfo(this.quote).exponent - currencyInfo(this.base).exponent;
    const f = this.rate.toFraction();
    return shift >= 0 ? f.times(new Fraction(pow10(shift))) : f.dividedBy(new Fraction(pow10(-shift)));
  }

  /** base minor → quote minor: one multiplication, then half-up (rule 4). */
  convert(baseMinor: bigint): bigint {
    return halfUp(new Fraction(baseMinor).times(this.factor()));
  }

  /** quote minor → base minor (how much base money covers this quote amount), half-up. */
  convertBack(quoteMinor: bigint): bigint {
    return halfUp(new Fraction(quoteMinor).dividedBy(this.factor()));
  }

  /** "1.625" (exact, as stored). */
  rateText(): string {
    return this.rate.toString();
  }

  toWire(): RateWire {
    return { base: this.base, quote: this.quote, rate: this.rate.toString(), date: this.date, source: this.source };
  }
}

/** One ECB publication: rates per euro, keyed by currency code (EUR is 1). */
export interface DayRates {
  /** The day that was asked for (Asia/Manila calendar). */
  day: string;
  /** The ECB date actually published on or before `day`. */
  effectiveDate: string;
  perEur: Record<string, string>;
  source: string;
}

/** A rate older than this many days before the day it is used for counts as unavailable (rule 3). */
export const MAX_RATE_AGE_DAYS = 7;

/** "1 base = ? quote" from one day's per-euro table, or null when either side is missing or the table is too old. */
export function rateFromDay(rates: DayRates | null | undefined, base: string, quote: string): ExchangeRate | null {
  if (!rates) return null;
  const age = (Date.parse(`${rates.day}T00:00:00Z`) - Date.parse(`${rates.effectiveDate}T00:00:00Z`)) / 86_400_000;
  if (age < 0 || age > MAX_RATE_AGE_DAYS) return null;
  const perEur = (code: string) => (code === "EUR" ? "1" : rates.perEur[code]);
  const b = perEur(base);
  const q = perEur(quote);
  if (!b || !q) return null;
  try {
    return ExchangeRate.fromPerEur(base, quote, Decimal.parse(b), Decimal.parse(q), rates.effectiveDate, rates.source);
  } catch {
    return null;
  }
}
