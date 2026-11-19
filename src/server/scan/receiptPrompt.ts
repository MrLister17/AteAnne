import { z } from "zod";
import type { RawReceiptReading } from "@/domain/receipt/ReceiptDraftNormalizer";

/**
 * Shared by every vision reader (Claude, Groq) so they get identical
 * instructions and are validated against the same schema.
 */
/** Structured-output schema. Amounts are strings to avoid float rounding. */
export const RECEIPT_READING_SCHEMA = z.object({
  is_receipt: z.boolean(),
  merchant: z.string().nullable(),
  lines: z.array(
    z.object({
      label: z.string(),
      quantity: z.number(),
      unit_price: z.string().nullable(),
      line_total: z.string(),
    }),
  ),
  /** Printed sum of the item lines before discounts/service ("Gross Sales", "Subtotal"), used only to cross-check the lines. */
  items_subtotal: z.string().nullable(),
  discounts: z.array(z.object({ label: z.string(), amount: z.string(), base: z.enum(["gross", "vat_exclusive", "unknown"]) })),
  service_charge: z.string().nullable(),
  other_charges: z.array(z.object({ label: z.string(), amount: z.string() })),
  total_due: z.string().nullable(),
  /** ISO 4217 code of the receipt's currency (PHP, THB, JPY…), or null if not shown. */
  currency: z.string().nullish(),
  /** Purchase date as YYYY-MM-DD, or null if not printed. */
  date: z.string().nullish(),
  unreadable_notes: z.array(z.string()),
});

export const RECEIPT_SYSTEM_PROMPT = `You transcribe photos of shop and restaurant receipts (mostly from the Philippines in pesos, sometimes from trips abroad) into structured data for a bill-splitting app. A person will check your draft against the photo, so accuracy matters more than completeness: never invent a line or a digit.

Write every amount as a plain decimal string with two decimals and no currency sign or thousands separator, e.g. "1234.50" (for currencies without decimals, such as yen or won, write "1200.00").

currency: the ISO 4217 code of the currency the amounts are in, when the receipt shows it by symbol (₱, ฿, ¥, ₩, S$…), code (PHP, THB, JPY…) or a clear country/address; null if unsure.
date: the purchase date as YYYY-MM-DD if printed (read day/month order from the country's convention); null if not printed or unclear.

Your job is to COPY what is printed, not to calculate. Another program checks the arithmetic afterwards, so never adjust a number to make things add up.

lines: one entry per purchased item line, in printed order. Read each row left to right, one row at a time. label = item name as printed (expand obvious abbreviations only if certain). Receipts often print columns such as "Description  U.Cost  Qty  Amount": unit_price = the unit cost column, quantity = the quantity column (1 if none), line_total = the last amount on the row (prices on Philippine receipts are VAT-inclusive; copy them as printed). Always give unit_price when a unit cost is printed; null only when it is not. When quantity and amount are printed close together (e.g. "3 1,185.00"), the single digit before the space is the quantity and the rest is the amount. Ignore tax-code letters after an amount (such as "V").

items_subtotal: the printed total of the item lines before any discount, VAT breakdown or service charge (labelled e.g. "Gross Sales", "Subtotal", "Sub Total", "Total Sales"). null if not printed. Copy it; do not add the lines up yourself.

discounts: senior citizen, PWD, promo, loyalty or other discounts as positive amounts. base = "vat_exclusive" when the receipt shows the discount computed on the VAT-exclusive/net-of-VAT amount (typical for senior/PWD), "gross" when it is taken off the VAT-inclusive price, else "unknown".

service_charge: the printed service charge amount, if any (never compute it from a percentage).
other_charges: other amounts added to the bill (delivery, corkage, packaging, tip line if part of the amount due).

Do NOT include as lines, discounts or charges: subtotal, VATable sales, VAT amount, VAT-exempt or zero-rated sales, cash tendered, change, card/GCash/Maya payment lines, points, rounding notes, guest counts, or anything after the amount due.

Exception for VAT exemption: when VAT is SUBTRACTED from the bill (typical for senior citizen/PWD sales, printed like "Less: VAT", "VAT Exemption" or "VAT Exempt Disc"), include that subtracted amount in discounts with label "VAT exemption" and base "gross". The senior/PWD discount itself is a separate discount entry.

total_due: the final amount due or paid for the purchase.
merchant: the store or restaurant name only. Do not copy names of people, card numbers, phone numbers, addresses or loyalty IDs anywhere.

If a digit is unclear, give your best reading and describe the doubt in unreadable_notes (e.g. "line 3 total could be 180.00 or 160.00"). If the image is not a receipt, or too blurry to read, set is_receipt to false and leave the lists empty.`;

export type ReceiptReadingJson = z.infer<typeof RECEIPT_READING_SCHEMA>;

/** JSON Schema for providers that take a raw schema (e.g. Groq json_schema). */
export const RECEIPT_READING_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(RECEIPT_READING_SCHEMA) as Record<string, unknown>;
  void _ignored;
  return schema;
})();

export function toRawReading(out: ReceiptReadingJson): RawReceiptReading {
  return {
    isReceipt: out.is_receipt,
    merchant: out.merchant,
    lines: out.lines.map((l) => ({ label: l.label, quantity: l.quantity, unitPrice: l.unit_price, lineTotal: l.line_total })),
    itemsSubtotal: out.items_subtotal ?? null,
    discounts: out.discounts,
    serviceCharge: out.service_charge,
    otherCharges: out.other_charges,
    totalDue: out.total_due,
    currency: out.currency ?? null,
    date: out.date ?? null,
    unreadableNotes: out.unreadable_notes,
  };
}
