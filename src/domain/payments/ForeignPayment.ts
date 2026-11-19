import { ConflictError, ValidationError } from "../errors";
import type { ExchangeRate } from "../fx/ExchangeRate";
import { formatMinorNumber } from "../money/Currency";

/**
 * Paying a transfer in another currency (rule 8). The transfer stays in the
 * event's settle-up currency; the rate is "1 paid-currency = x settle-up"
 * for the day the money is sent, and is locked into the payment.
 *
 * - Full payment: send convertBack(capacity); the credit is the capacity, exactly.
 * - Partial payment: credit = convert(sent), half-up, never above the capacity.
 *   Sending exactly the full-payment amount clears the capacity; more is refused.
 */
export class ForeignPayment {
  constructor(private readonly rate: ExchangeRate) {}

  /** How much of the paid currency clears `capacity` settle-up minor units. */
  toSend(capacity: bigint): bigint {
    return this.rate.convertBack(capacity);
  }

  /** Settle-up credit for `sent` paid-currency minor units, capped at `capacity`. */
  creditFor(sent: bigint, capacity: bigint): bigint {
    if (sent <= 0n) throw new ValidationError("amount_not_positive", "Report a positive amount");
    if (capacity <= 0n) throw new ValidationError("nothing_left", "Nothing is left to pay on this transfer");
    const full = this.toSend(capacity);
    if (full === 0n) throw new ValidationError("amount_too_small", `What's left is too small to pay in ${this.rate.base}`);
    if (sent > full) {
      throw new ConflictError("over_report", `At most ${this.rate.base} ${formatMinorNumber(full, this.rate.base)} can be reported on this transfer right now`, { capacity: capacity.toString(), maxSend: full.toString() });
    }
    if (sent === full) return capacity;
    const credit = this.rate.convert(sent);
    if (credit <= 0n) throw new ValidationError("amount_too_small", "That amount is too small to count after conversion");
    return credit < capacity ? credit : capacity;
  }
}
