import { ValidationError } from "../errors";

/** PHP 1,000,000.00 — documented per-receipt / per-line / per-adjustment bound. */
export const MAX_RECEIPT_CENTAVOS = 100_000_000n;

const DECIMAL_INPUT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const CENTAVO_STRING = /^-?\d{1,19}$/;

/**
 * Immutable value object for Philippine pesos stored as integer centavos.
 *
 * Money never touches binary floating point: it wraps a `bigint` and only
 * exposes exact operations. On the wire it travels as a decimal string of
 * centavos ("12550" = PHP 125.50) so JSON never rounds it.
 */
export class Money {
  private constructor(public readonly centavos: bigint) {}

  static readonly ZERO = new Money(0n);

  static of(centavos: bigint | number): Money {
    if (typeof centavos === "number") {
      if (!Number.isSafeInteger(centavos)) {
        throw new ValidationError("money_not_integer", "Money must be integer centavos");
      }
      return new Money(BigInt(centavos));
    }
    return new Money(centavos);
  }

  /** Parse user input such as "1,234.5" or "180" (pesos, ≤ 2 decimals). */
  static parsePesos(input: string): Money {
    const cleaned = input.trim().replace(/,/g, "").replace(/^₱|^PHP\s*/i, "");
    const match = DECIMAL_INPUT.exec(cleaned);
    if (!match) {
      throw new ValidationError("money_malformed", `"${input}" is not a valid peso amount (up to 2 decimals)`);
    }
    const pesos = BigInt(match[1]);
    const fraction = (match[2] ?? "").padEnd(2, "0");
    return new Money(pesos * 100n + BigInt(fraction || "0"));
  }

  /** Parse the wire format (decimal-string centavos). */
  static fromWire(value: string): Money {
    if (typeof value !== "string" || !CENTAVO_STRING.test(value)) {
      throw new ValidationError("money_wire_malformed", "Money must be a decimal string of centavos");
    }
    return new Money(BigInt(value));
  }

  static sum(values: Iterable<Money>): Money {
    let total = 0n;
    for (const v of values) total += v.centavos;
    return new Money(total);
  }

  plus(other: Money): Money {
    return new Money(this.centavos + other.centavos);
  }

  minus(other: Money): Money {
    return new Money(this.centavos - other.centavos);
  }

  negate(): Money {
    return new Money(-this.centavos);
  }

  min(other: Money): Money {
    return this.centavos <= other.centavos ? this : other;
  }

  isZero(): boolean {
    return this.centavos === 0n;
  }
  isPositive(): boolean {
    return this.centavos > 0n;
  }
  isNegative(): boolean {
    return this.centavos < 0n;
  }
  equals(other: Money): boolean {
    return this.centavos === other.centavos;
  }
  compare(other: Money): -1 | 0 | 1 {
    return this.centavos < other.centavos ? -1 : this.centavos > other.centavos ? 1 : 0;
  }

  /** Throw unless 0 ≤ value ≤ bound. */
  assertWithin(bound: bigint = MAX_RECEIPT_CENTAVOS, field = "amount"): this {
    if (this.centavos < 0n || this.centavos > bound) {
      throw new ValidationError("money_out_of_bounds", `${field} must be between PHP 0.00 and PHP ${Money.of(bound).format()}`);
    }
    return this;
  }

  toWire(): string {
    return this.centavos.toString();
  }

  toJSON(): string {
    return this.toWire();
  }

  /** "4,628.25" (no currency sign); negative values keep a leading minus. */
  format(): string {
    const negative = this.centavos < 0n;
    const abs = negative ? -this.centavos : this.centavos;
    const pesos = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const cents = (abs % 100n).toString().padStart(2, "0");
    return `${negative ? "-" : ""}${pesos}.${cents}`;
  }

  /** "PHP 4,628.25". */
  toString(): string {
    return `PHP ${this.format()}`;
  }
}
