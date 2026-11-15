import { ValidationError } from "../errors";

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Exact non-floating rational number (bigint numerator / positive denominator).
 * Used for allocation weights and exact share computation.
 */
export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint = 1n) {
    if (den === 0n) throw new ValidationError("fraction_zero_denominator", "Denominator cannot be zero");
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den) || 1n;
    this.num = num / g;
    this.den = den / g;
  }

  static readonly ZERO = new Fraction(0n);

  /** Accept bigint, safe integers or Fractions — never floats. */
  static from(value: Fraction | bigint | number): Fraction {
    if (value instanceof Fraction) return value;
    if (typeof value === "bigint") return new Fraction(value);
    if (!Number.isInteger(value)) {
      throw new ValidationError("float_weight", "Floating point weights are not allowed");
    }
    return new Fraction(BigInt(value));
  }

  plus(o: Fraction): Fraction {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  minus(o: Fraction): Fraction {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  times(o: Fraction): Fraction {
    return new Fraction(this.num * o.num, this.den * o.den);
  }
  dividedBy(o: Fraction): Fraction {
    return new Fraction(this.num * o.den, this.den * o.num);
  }
  /** Floor toward −∞ (only non-negative values are used in allocation). */
  floor(): bigint {
    const q = this.num / this.den;
    return this.num < 0n && this.num % this.den !== 0n ? q - 1n : q;
  }
  isZero(): boolean {
    return this.num === 0n;
  }
  isNegative(): boolean {
    return this.num < 0n;
  }
  compare(o: Fraction): number {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }
}
