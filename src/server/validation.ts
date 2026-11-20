import { z } from "zod";
import { MAX_RECEIPT_CENTAVOS } from "@/domain/money/Money";
import { DAY_PATTERN, isCurrency } from "@/domain/money/Currency";

/** Strip control characters; keep the text plain (React escapes on render). */
const plain = (max: number, min = 0) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

/** Decimal-string centavos within the documented bound → bigint. */
export const centavos = z
  .string()
  .regex(/^\d{1,12}$/, "Money must be a decimal string of centavos")
  .transform((s) => BigInt(s))
  .refine((v) => v <= MAX_RECEIPT_CENTAVOS, "Amount is too large (at most 100,000,000 of the smallest unit)");

export const positiveCentavos = centavos.refine((v) => v > 0n, "Amount must be positive");

export const id = z.string().min(1).max(40).regex(/^[a-z0-9]+$/i);
export const intent = z.enum(["WILL_PAY_ONLY", "PAID_EXPENSE"]);
/** A supported ISO 4217 code (see src/domain/money/Currency.ts). */
export const currencyCode = z.string().length(3).refine(isCurrency, "That currency isn't supported");
/** YYYY-MM-DD calendar day. */
export const calendarDay = z.string().regex(DAY_PATTERN, "Use a YYYY-MM-DD date").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "That date doesn't exist");
export const displayName = plain(40, 1);
export const idempotencyKey = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const createEventSchema = z.object({
  title: plain(80, 1),
  note: plain(500).default(""),
  displayName,
  intent: intent.default("WILL_PAY_ONLY"),
  /** Settle-up currency (D58). */
  currency: currencyCode.default("PHP"),
});

export const setCurrencySchema = z.object({ currency: currencyCode, expectedFinancialVersion: z.number().int().positive() });

export const joinSchema = z.object({ code: z.string().min(1).max(20), displayName, intent: intent.default("WILL_PAY_ONLY") });

/**
 * Recovery keys are copied from Notes, chats and screenshots, so be forgiving:
 * spaces, line breaks and zero-width characters picked up on the way are
 * removed (the key itself never contains them). A missing "AA-" is restored.
 */
export const recoverSchema = z.object({
  key: z
    .string()
    .max(200)
    .transform((s) => {
      const k = s.replace(/[\s\u200b-\u200d\ufeff]+/g, "").replace(/^[“"'`]+|[”"'`.,]+$/g, "");
      return /^aa-/i.test(k) ? `AA-${k.slice(3)}` : `AA-${k}`;
    })
    .pipe(z.string().min(20, "That doesn’t look like a whole recovery key. It starts with AA- and is about 46 characters long.").max(80)),
});

export const addGuestSchema = z.object({ displayName, intent: intent.default("WILL_PAY_ONLY") });
export const setAdminSchema = z.object({ isAdmin: z.boolean() });

export const updateMeSchema = z.object({
  displayName: displayName.optional(),
  intent: intent.optional(),
  entryComplete: z.boolean().optional(),
});

export const transitionSchema = z.object({
  target: z.enum(["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING", "DONE"]),
  expectedFinancialVersion: z.number().int().positive(),
  reason: plain(300, 3).optional(),
});

const lineSchema = z.object({
  id: id.optional(),
  label: plain(80, 1),
  quantity: z.number().int().min(1).max(1000),
  amount: centavos,
  unitPrice: centavos.nullable().optional(),
  mode: z.enum(["SHARED", "UNITS"]),
});

const adjustmentSchema = z.object({
  kind: z.enum(["DISCOUNT", "SERVICE", "CHARGE"]),
  label: plain(80, 1),
  amount: centavos,
  /** Indexes into the submitted `lines` array; null = applies to all lines. */
  eligibleLineIndexes: z.array(z.number().int().min(0).max(49)).max(50).nullable(),
});

export const receiptSchema = z.object({
  label: plain(80, 1),
  equalSplit: z.boolean().default(false),
  payerMemberId: id,
  /** The receipt's printed currency (default: the event's settle-up currency on create, unchanged on edit). */
  currency: currencyCode.optional(),
  /** The day it was bought (default: today in Manila on create, unchanged on edit). */
  purchasedOn: calendarDay.optional(),
  /** Minor units of `currency`. */
  payable: centavos,
  lines: z.array(lineSchema).min(1).max(50),
  adjustments: z.array(adjustmentSchema).max(20).default([]),
});

export const updateReceiptSchema = receiptSchema.extend({ expectedVersion: z.number().int().positive() });

export const fundingAckSchema = z.object({ receiptVersion: z.number().int().positive(), amount: centavos });

export const claimsSchema = z.object({
  receiptVersion: z.number().int().positive(),
  expectedClaimVersion: z.number().int().positive(),
  /** "finish" = I claimed my items; "none" = I got nothing; "draft" = save progress. */
  status: z.enum(["finish", "none", "draft"]),
  /** Explicit consent; the server derives every line rather than trusting a client list. */
  acceptEqualSplit: z.boolean().optional(),
  claims: z.array(z.object({ lineId: id, units: z.number().int().min(1).max(1000) })).max(50),
});

export const approveSchema = z.object({ financialVersion: z.number().int().positive() });

export const instructionsSchema = z.object({
  acceptsCash: z.boolean(),
  cashNote: plain(200).default(""),
  qrLabel: plain(60).default(""),
  /** Keep the current QR image, or remove it. New QR images arrive via upload. */
  keepQr: z.boolean().default(true),
  /** Currencies I accept payment in (D58); empty = the event's defaults. */
  acceptedCurrencies: z.array(currencyCode).max(17).default([]),
});

export const reportSchema = z.object({
  /** Credit against the transfer, in the event's settle-up currency. */
  amount: positiveCentavos,
  /** Sent in another currency (D58): what was sent, and the rate date the phone showed. */
  paid: z.object({ currency: currencyCode, amount: positiveCentavos, rateDate: calendarDay }).optional(),
  method: z.enum(["CASH", "QR"]),
  note: plain(200).default(""),
  idempotencyKey,
  replacesReportId: id.optional(),
});

/** D64: cash already handed to another member, recorded during Add & claim or Pay. */
export const cashReportSchema = z.object({
  recipientMemberId: id,
  /** Effective amount in the event's settle-up currency (no cap: it may exceed what's owed). */
  amount: positiveCentavos,
  /** Handed over in another currency: what was given, and the rate date the phone showed. */
  paid: z.object({ currency: currencyCode, amount: positiveCentavos, rateDate: calendarDay }).optional(),
  method: z.enum(["CASH", "QR"]).default("CASH"),
  note: plain(200).default(""),
  idempotencyKey,
  /** The one agreed re-record of a rejected handoff. */
  replacesReportId: id.optional(),
});

export const decisionSchema = z.object({ expectedVersion: z.number().int().positive().optional() });
export const rejectSchema = z.object({ reason: plain(200, 3), expectedVersion: z.number().int().positive().optional() });
export const reverseSchema = z.object({ reason: plain(200, 3) });
export const disputeChoiceSchema = z.object({ choice: z.enum(["NO_TRANSFER", "REPLACEMENT"]), expectedVersion: z.number().int().positive() });
