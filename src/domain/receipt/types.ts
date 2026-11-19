import type { ExchangeRate } from "../fx/ExchangeRate";

export type ShareMode = "SHARED" | "UNITS";
export type AdjustmentKind = "DISCOUNT" | "SERVICE" | "CHARGE";

export interface LineClaimInput {
  memberId: string;
  /** SHARED: 1 means "I consumed this". UNITS: whole units claimed (≥ 1). */
  units: number;
}

export interface LineInput {
  id: string;
  position: number;
  label: string;
  quantity: number;
  /** Authoritative entered line total, centavos. */
  amount: bigint;
  mode: ShareMode;
  /** Only claims valid for the current receipt version. */
  claims: LineClaimInput[];
}

export interface AdjustmentInput {
  id: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  /** Positive magnitude in centavos. Discounts subtract, charges add. */
  amount: bigint;
  /** "ALL" or explicit line IDs the adjustment applies to. */
  eligibleLineIds: "ALL" | string[];
}

export interface ReceiptInput {
  id: string;
  label: string;
  payerId: string;
  /** In the receipt's own currency (minor units). */
  payable: bigint;
  /**
   * Set when the receipt is in a currency other than the event's settle-up
   * currency (D58/D61): the rate of the day it was bought, or null while no
   * rate is available (the bill then waits).
   */
  conversion?: { currency: string; day: string; rate: ExchangeRate | null };
  /** Explicit receipt-wide equal policy; every listed participant must accept all lines. */
  equalSplit?: { memberIds: string[] };
  lines: LineInput[];
  adjustments: AdjustmentInput[];
}

export interface CalculationIssue {
  code:
    | "RECONCILIATION_MISMATCH"
    | "DISCOUNT_EXCEEDS_BASE"
    | "ZERO_BASIS_CHARGE"
    | "LINE_UNALLOCATED"
    | "UNITS_UNDER_ALLOCATED"
    | "UNITS_OVER_ALLOCATED"
    | "NO_LINES"
    | "UNKNOWN_LINE_SCOPE"
    | "EQUAL_SPLIT_UNCONFIRMED"
    | "RATE_UNAVAILABLE";
  message: string;
  receiptId: string;
  lineId?: string;
  adjustmentId?: string;
}

export interface MemberReceiptShare {
  memberId: string;
  /** Gross item share per line ID. */
  lineShares: Map<string, bigint>;
  /** Discount amount (positive magnitude) per discount ID. */
  discountShares: Map<string, bigint>;
  /** Charge amount per service/charge ID. */
  chargeShares: Map<string, bigint>;
  itemsGross: bigint;
  discountTotal: bigint;
  chargeTotal: bigint;
  /** itemsGross − discountTotal + chargeTotal. */
  total: bigint;
}
