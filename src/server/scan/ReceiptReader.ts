import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { RECEIPT_READING_SCHEMA as ReadingSchema, RECEIPT_SYSTEM_PROMPT as SYSTEM, toRawReading } from "./receiptPrompt";
import type { RawReceiptReading } from "@/domain/receipt/ReceiptDraftNormalizer";

/** Port: anything that can turn a receipt photo into a raw reading. */
export interface ReceiptReader {
  /** Shown in /api/health (never the key). */
  readonly name?: "groq" | "claude" | "fake";
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

/** Reads receipts with Claude vision + structured outputs. */
export class ClaudeReceiptReader implements ReceiptReader {
  readonly name = "claude" as const;
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
    return toRawReading(out);
  }
}

/**
 * Deterministic stand-in for tests and demos (RECEIPT_SCAN_FAKE=1). Never
 * enabled on a Vercel production deployment. Returns a synthetic receipt.
 */
export class FakeReceiptReader implements ReceiptReader {
  readonly name = "fake" as const;
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
