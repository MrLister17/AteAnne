import { z } from "zod";
import { MAX_RECEIPT_CENTAVOS } from "@/domain/money/Money";

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
  .refine((v) => v <= MAX_RECEIPT_CENTAVOS, "Amount exceeds PHP 1,000,000.00");

export const positiveCentavos = centavos.refine((v) => v > 0n, "Amount must be positive");

export const id = z.string().min(1).max(40).regex(/^[a-z0-9]+$/i);
export const intent = z.enum(["WILL_PAY_ONLY", "PAID_EXPENSE"]);
export const displayName = plain(40, 1);
export const idempotencyKey = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const createEventSchema = z.object({
  title: plain(80, 1),
  note: plain(500).default(""),
  displayName,
  intent: intent.default("WILL_PAY_ONLY"),
});

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
});

export const reportSchema = z.object({
  amount: positiveCentavos,
  method: z.enum(["CASH", "QR"]),
  note: plain(200).default(""),
  idempotencyKey,
  replacesReportId: id.optional(),
});

export const decisionSchema = z.object({ expectedVersion: z.number().int().positive().optional() });
export const rejectSchema = z.object({ reason: plain(200, 3), expectedVersion: z.number().int().positive().optional() });
export const reverseSchema = z.object({ reason: plain(200, 3) });
export const disputeChoiceSchema = z.object({ choice: z.enum(["NO_TRANSFER", "REPLACEMENT"]), expectedVersion: z.number().int().positive() });
