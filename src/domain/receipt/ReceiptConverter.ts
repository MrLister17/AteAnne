import { LargestRemainderAllocator } from "../allocation/LargestRemainderAllocator";
import type { ExchangeRate } from "../fx/ExchangeRate";
import type { MemberReceiptShare } from "./types";

export interface ConvertedReceipt {
  /** Payable in the event's settle-up currency: the payer's funding. */
  payable: bigint;
  /** Each person's share in the settle-up currency; Σ = payable exactly. */
  shares: Map<string, bigint>;
}

/**
 * Turns one receipt's exact shares (in the receipt's own currency) into the
 * event's settle-up currency at the rate of the day it was bought (D61).
 *
 * The payable is converted once (half-up to the minor unit), then split by
 * the original shares with the largest-remainder rule (ties in join order),
 * so every receipt still adds up exactly and the payer's funding equals the
 * sum of everyone's converted shares. With no rate (same currency) the
 * numbers are returned unchanged.
 */
export class ReceiptConverter {
  constructor(private readonly allocator = new LargestRemainderAllocator()) {}

  convert(payable: bigint, shares: ReadonlyMap<string, MemberReceiptShare>, memberOrder: readonly string[], rate: ExchangeRate | null): ConvertedReceipt {
    const ordered = memberOrder.filter((id) => shares.has(id));
    if (!rate) return { payable, shares: new Map(ordered.map((id) => [id, shares.get(id)!.total])) };
    const converted = rate.convert(payable);
    const split = this.allocator.allocate(
      converted,
      ordered.map((id) => ({ key: id, weight: shares.get(id)!.total })),
    );
    return { payable: converted, shares: split };
  }
}
