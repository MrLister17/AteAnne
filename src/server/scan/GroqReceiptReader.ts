import Groq from "groq-sdk";
import type { RawReceiptReading } from "@/domain/receipt/ReceiptDraftNormalizer";
import { ReceiptReadError, type ReceiptReader } from "./ReceiptReader";
import { RECEIPT_READING_JSON_SCHEMA, RECEIPT_READING_SCHEMA, RECEIPT_SYSTEM_PROMPT, toRawReading } from "./receiptPrompt";

export const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.6-27b";

type ChatClient = Pick<Groq, "chat">;

/**
 * Reads receipts with a Groq-hosted vision model (free tier available).
 * Asks for schema-constrained JSON; if the model doesn't support
 * `json_schema`, retries once in plain JSON mode. Reasoning text such as
 * <think>…</think> is stripped and the result is validated with the same
 * Zod schema as every other reader before it reaches the normalizer.
 */
export class GroqReceiptReader implements ReceiptReader {
  private readonly client: ChatClient;

  constructor(
    apiKey: string,
    private readonly model = DEFAULT_GROQ_VISION_MODEL,
    client?: ChatClient,
  ) {
    this.client = client ?? new Groq({ apiKey, timeout: 50_000, maxRetries: 1 });
  }

  async read(image: Buffer, mediaType: "image/jpeg"): Promise<RawReceiptReading> {
    const messages = [
      { role: "system" as const, content: `${RECEIPT_SYSTEM_PROMPT}\n\nRespond with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(RECEIPT_READING_JSON_SCHEMA)}` },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Transcribe this receipt." },
          { type: "image_url" as const, image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` } },
        ],
      },
    ];
    const base = { model: this.model, messages, temperature: 0, max_completion_tokens: 4096 };

    let content: string | null | undefined;
    try {
      try {
        const res = await this.client.chat.completions.create({
          ...base,
          response_format: { type: "json_schema", json_schema: { name: "receipt_reading", schema: RECEIPT_READING_JSON_SCHEMA } },
        });
        content = res.choices[0]?.message?.content;
      } catch (error) {
        // Some models don't support json_schema with images: fall back to JSON mode once.
        if (!(error instanceof Groq.BadRequestError)) throw error;
        const res = await this.client.chat.completions.create({ ...base, response_format: { type: "json_object" } });
        content = res.choices[0]?.message?.content;
      }
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

    const parsed = RECEIPT_READING_SCHEMA.safeParse(extractJson(content ?? ""));
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
