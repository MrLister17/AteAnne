import Groq from "groq-sdk";
import type { RawReceiptReading } from "@/domain/receipt/ReceiptDraftNormalizer";
import { ReceiptReadError, type ReceiptReader } from "./ReceiptReader";
import { RECEIPT_READING_SCHEMA, RECEIPT_SYSTEM_PROMPT, toRawReading } from "./receiptPrompt";

/** Verified live on 2026-11-16 (vision + JSON mode). Groq changes models often: override with GROQ_VISION_MODEL. */
export const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.8-27b";

const GROQ_JSON_SHAPE = JSON.stringify({
  is_receipt: true,
  merchant: "store name or null",
  lines: [{ label: "item", unit_price: "0.00 or null", quantity: 1, line_total: "0.00" }],
  items_subtotal: "0.00 or null",
  discounts: [{ label: "Senior/PWD/Promo", amount: "0.00", base: "gross | vat_exclusive | unknown" }],
  service_charge: "0.00 or null",
  other_charges: [{ label: "charge", amount: "0.00" }],
  total_due: "0.00 or null",
  unreadable_notes: ["describe any unclear digits"],
});

type ChatClient = Pick<Groq, "chat">;

/**
 * Reads receipts with a Groq-hosted vision model (free tier available).
 * Uses JSON mode; reasoning text such as <think>…</think> and code fences are
 * stripped, and the result is validated with the same Zod schema as every
 * other reader before it reaches the normalizer.
 */
export class GroqReceiptReader implements ReceiptReader {
  readonly name = "groq" as const;
  private readonly client: ChatClient;

  constructor(
    apiKey: string,
    private readonly model = DEFAULT_GROQ_VISION_MODEL,
    client?: ChatClient,
  ) {
    // No silent retries: on the free tier a 429 retry can wait out the whole request; tell the person "busy" instead.
    this.client = client ?? new Groq({ apiKey, timeout: 30_000, maxRetries: 0 });
  }

  async read(image: Buffer, mediaType: "image/jpeg"): Promise<RawReceiptReading> {
    // JSON mode, not json_schema: live testing (2026-11-16) showed Groq's
    // schema-constrained decoding returning garbage values with images on
    // qwen/qwen3.8-27b, while JSON mode produced correct readings. A compact
    // shape example keeps input tokens low (free tier: 7,000 input tokens/min).
    const messages = [
      { role: "system" as const, content: `${RECEIPT_SYSTEM_PROMPT}\n\nRespond with ONE JSON object only, no prose, exactly this shape:\n${GROQ_JSON_SHAPE}` },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Transcribe this receipt." },
          { type: "image_url" as const, image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` } },
        ],
      },
    ];

    let content: string | null | undefined;
    try {
      const ask = () => this.client.chat.completions.create({ model: this.model, messages, temperature: 0, max_completion_tokens: 4096, response_format: { type: "json_object" } });
      let res;
      try {
        res = await ask();
      } catch (first) {
        // One quick second try when Groq is momentarily over capacity (5xx). Never for 429: on the free tier that would just wait.
        if (!(first instanceof Groq.InternalServerError)) throw first;
        await new Promise((r) => setTimeout(r, 800));
        res = await ask();
      }
      content = res.choices[0]?.message?.content;
    } catch (error) {
      if (error instanceof Groq.RateLimitError) throw new ReceiptReadError("unavailable", "The free receipt reader is busy right now. Try again in a minute, or enter it by hand.");
      if (error instanceof Groq.AuthenticationError || error instanceof Groq.PermissionDeniedError) {
        throw new ReceiptReadError("unavailable", "Receipt scanning isn’t set up correctly. Enter the receipt by hand for now.");
      }
      if (error instanceof Groq.NotFoundError || error instanceof Groq.BadRequestError) {
        throw new ReceiptReadError("unavailable", "The receipt reader model isn’t available. Ask the app owner to update GROQ_VISION_MODEL.");
      }
      if (error instanceof Groq.APIError) throw new ReceiptReadError("unavailable", "Couldn’t reach the receipt reader. Try again, or enter it by hand.");
      throw error;
    }

    const json = extractJson(content ?? "");
    // Older or terse replies may leave the optional cross-check field out.
    const parsed = RECEIPT_READING_SCHEMA.safeParse(json && typeof json === "object" ? { items_subtotal: null, ...json } : json);
    if (!parsed.success) throw new ReceiptReadError("unreadable", "Couldn’t read that photo. Try a sharper, well-lit photo, or enter it by hand.");
    if (!parsed.data.is_receipt) throw new ReceiptReadError("not_a_receipt", "That doesn’t look like a readable receipt. Try a clearer photo of the whole receipt.");
    return toRawReading(parsed.data);
  }
}

/** Strip reasoning blocks / code fences and parse the outermost JSON object. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
