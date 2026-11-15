import { ValidationError } from "../errors";
import { Fraction } from "../money/Fraction";

export interface WeightedEntry<K extends string = string> {
  /** Stable identifier (participant ID or line ID). */
  key: K;
  /** Non-negative exact weight. */
  weight: Fraction | bigint | number;
}

/**
 * Largest-remainder ("Hamilton") allocation of an integer number of centavos.
 *
 * 1. exact share = total × wᵢ / Σw (rational, no floats)
 * 2. floor every share to whole centavos
 * 3. hand leftover centavos to the greatest fractional remainders; ties are
 *    broken by the entry's position in the input list, so callers pass entries
 *    in stable participant-ID (or line-position) order.
 *
 * Guarantees: Σ result = total, zero weight → zero, all results ≥ 0.
 * A positive total with zero basis is an error — never a silent equal split.
 */
export class LargestRemainderAllocator {
  allocate<K extends string>(totalCentavos: bigint, entries: readonly WeightedEntry<K>[]): Map<K, bigint> {
    if (typeof totalCentavos !== "bigint") {
      throw new ValidationError("money_not_integer", "Money must be integer centavos");
    }
    if (totalCentavos < 0n) {
      throw new ValidationError("negative_money", "Allocate nonnegative magnitudes; discounts subtract later");
    }
    const seen = new Set<K>();
    const weights = entries.map((e) => {
      if (seen.has(e.key)) throw new ValidationError("duplicate_key", `Duplicate allocation key ${e.key}`);
      seen.add(e.key);
      const w = Fraction.from(e.weight);
      if (w.isNegative()) throw new ValidationError("negative_weight", "Weights must be nonnegative");
      return { key: e.key, weight: w };
    });

    const basis = weights.reduce((acc, e) => acc.plus(e.weight), Fraction.ZERO);
    const result = new Map<K, bigint>();
    if (basis.isZero()) {
      if (totalCentavos !== 0n) {
        throw new ValidationError("zero_basis", "Cannot allocate a positive amount with a zero basis");
      }
      for (const e of weights) result.set(e.key, 0n);
      return result;
    }

    const total = new Fraction(totalCentavos);
    const rows = weights.map((e, index) => {
      const exact = total.times(e.weight).dividedBy(basis);
      const floor = exact.floor();
      return { key: e.key, index, floor, remainder: exact.minus(new Fraction(floor)) };
    });
    let leftover = totalCentavos - rows.reduce((acc, r) => acc + r.floor, 0n);
    const order = [...rows].sort((a, b) => b.remainder.compare(a.remainder) || a.index - b.index);
    for (const r of order) {
      if (leftover === 0n) break;
      r.floor += 1n;
      leftover -= 1n;
    }
    for (const r of rows) result.set(r.key, r.floor);
    return result;
  }
}

export const allocator = new LargestRemainderAllocator();
