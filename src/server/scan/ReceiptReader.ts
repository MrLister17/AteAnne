import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { RawReceiptReading } from "@/domain/receipt/ReceiptDraftNormalizer";

/** Port: anything that can turn a receipt photo into a raw reading. */
export interface ReceiptReader {
  read(image: Buffer, mediaType: "image/jpeg"): Promise<RawReceiptReading>;
}

export class ReceiptReadError extends Error {
  constructor(
    public readonly reason: "not_a_receipt" | "unreadable" | "refused" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

/** Structured-output schema. Amounts are strings to avoid float rounding. */
const ReadingSchema = z.object({
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
  discounts: z.array(z.object({ label: z.string(), amount: z.string(), base: z.enum(["gross", "vat_exclusive", "unknown"]) })),
  service_charge: z.string().nullable(),
  other_charges: z.array(z.object({ label: z.string(), amount: z.string() })),
  total_due: z.string().nullable(),
  unreadable_notes: z.array(z.string()),
});

const SYSTEM = `You transcribe photos of shop and restaurant receipts (mostly from the Philippines, in pesos) into structured data for a bill-splitting app. A person will check your draft against the photo, so accuracy matters more than completeness: never invent a line or a digit.

Write every amount as a plain decimal string with two decimals and no currency sign or thousands separator, e.g. "1234.50".

lines: one entry per purchased item line, in printed order. label = item name as printed (expand obvious abbreviations only if certain). quantity = printed quantity (1 if none). line_total = the line's printed total (prices on Philippine receipts are VAT-inclusive; copy them as printed). unit_price only if printed.

discounts: senior citizen, PWD, promo, loyalty or other discounts as positive amounts. base = "vat_exclusive" when the receipt shows the discount computed on the VAT-exclusive/net-of-VAT amount (typical for senior/PWD), "gross" when it is taken off the VAT-inclusive price, else "unknown".

service_charge: the printed service charge amount, if any (never compute it from a percentage).
other_charges: other amounts added to the bill (delivery, corkage, packaging, tip line if part of the amount due).

Do NOT include as lines, discounts or charges: subtotal, VATable sales, VAT amount, VAT-exempt or zero-rated sales, cash tendered, change, card/GCash/Maya payment lines, points, rounding notes, guest counts, or anything after the amount due.

total_due: the final amount due or paid for the purchase.
merchant: the store or restaurant name only. Do not copy names of people, card numbers, phone numbers, addresses or loyalty IDs anywhere.

If a digit is unclear, give your best reading and describe the doubt in unreadable_notes (e.g. "line 3 total could be 180.00 or 160.00"). If the image is not a receipt, or too blurry to read, set is_receipt to false and leave the lists empty.`;

/** Reads receipts with Claude vision + structured outputs. */
export class ClaudeReceiptReader implements ReceiptReader {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-opus-5-5",
  ) {
    this.client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  }

  async read(image: Buffer, mediaType: "image/jpeg"): Promise<RawReceiptReading> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // Server-side fallback if the model declines; harmless where unsupported.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(ReadingSchema) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
              { type: "text", text: "Transcribe this receipt." },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new ReceiptReadError("unavailable", "The receipt reader is busy. Try again in a minute.");
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ReceiptReadError("unavailable", "Receipt scanning isn’t set up correctly. Enter the receipt by hand for now.");
      }
      if (error instanceof Anthropic.APIError) throw new ReceiptReadError("unavailable", "Couldn’t reach the receipt reader. Try again, or enter it by hand.");
      throw error;
    }
    if (response.stop_reason === "refusal") throw new ReceiptReadError("refused", "This photo couldn’t be read. Enter the receipt by hand.");
    const out = response.parsed_output;
    if (!out || response.stop_reason === "max_tokens") throw new ReceiptReadError("unreadable", "Couldn’t read that photo. Try a sharper, well-lit photo, or enter it by hand.");
    if (!out.is_receipt) throw new ReceiptReadError("not_a_receipt", "That doesn’t look like a readable receipt. Try a clearer photo of the whole receipt.");
    return {
      isReceipt: true,
      merchant: out.merchant,
      lines: out.lines.map((l) => ({ label: l.label, quantity: l.quantity, unitPrice: l.unit_price, lineTotal: l.line_total })),
      discounts: out.discounts,
      serviceCharge: out.service_charge,
      otherCharges: out.other_charges,
      totalDue: out.total_due,
      unreadableNotes: out.unreadable_notes,
    };
  }
}

/**
 * Deterministic stand-in for tests and demos (RECEIPT_SCAN_FAKE=1). Never
 * enabled on a Vercel production deployment. Returns a synthetic receipt.
 */
export class FakeReceiptReader implements ReceiptReader {
  async read(): Promise<RawReceiptReading> {
    return {
      isReceipt: true,
      merchant: "Sample Kainan (demo scan)",
      lines: [
        { label: "Sisig", quantity: 1, unitPrice: null, lineTotal: "320.00" },
        { label: "Rice", quantity: 3, unitPrice: "35.00", lineTotal: "105.00" },
        { label: "Iced tea pitcher", quantity: 1, unitPrice: null, lineTotal: "180.00" },
      ],
      discounts: [],
      serviceCharge: "60.50",
      otherCharges: [],
      totalDue: "665.50",
      unreadableNotes: [],
    };
  }
}
