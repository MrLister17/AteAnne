import { describe, expect, it } from "vitest";
import Groq from "groq-sdk";
import { extractJson, GroqReceiptReader } from "@/server/scan/GroqReceiptReader";
import { ReceiptReadError } from "@/server/scan/ReceiptReader";
import { chooseReceiptReader } from "@/server/container";
import { readEnv, scanSetupHint } from "@/server/config";
import { ClaudeReceiptReader, FakeReceiptReader } from "@/server/scan/ReceiptReader";

const reading = {
  is_receipt: true,
  merchant: "Kusina",
  lines: [{ label: "Sisig", quantity: 1, unit_price: null, line_total: "320.00" }],
  discounts: [],
  service_charge: "32.00",
  other_charges: [],
  total_due: "352.00",
  unreadable_notes: [],
};

type Params = { response_format?: { type: string }; messages: { role: string; content: unknown }[]; model: string };
function fakeClient(handler: (p: Params) => string | Error) {
  const calls: Params[] = [];
  const client = {
    chat: {
      completions: {
        create: async (p: Params) => {
          calls.push(p);
          const out = handler(p);
          if (out instanceof Error) throw out;
          return { choices: [{ message: { content: out } }] };
        },
      },
    },
  };
  return { client: client as unknown as Pick<Groq, "chat">, calls };
}
const img = Buffer.from([0xff, 0xd8, 0xff]);
const badRequest = () => new Groq.BadRequestError(400, { error: { message: "json_schema not supported" } }, "json_schema not supported", new Headers());

describe("GroqReceiptReader", () => {
  it("sends the image as a data URL in JSON mode and maps the reading", async () => {
    const { client, calls } = fakeClient(() => JSON.stringify(reading));
    const out = await new GroqReceiptReader("k", "qwen/qwen3.8-27b", client).read(img, "image/jpeg");
    expect(out.lines[0]).toEqual({ label: "Sisig", quantity: 1, unitPrice: null, lineTotal: "320.00" });
    expect(out.serviceCharge).toBe("32.00");
    expect(calls[0].model).toBe("qwen/qwen3.8-27b");
    expect(calls[0].response_format?.type).toBe("json_object");
    expect(calls).toHaveLength(1);
    const user = calls[0].messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(user.find((p) => p.type === "image_url")!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("strips <think> reasoning and code fences before validating", async () => {
    const { client } = fakeClient(() => `<think>reading the total…</think>\n\`\`\`json\n${JSON.stringify(reading)}\n\`\`\``);
    const out = await new GroqReceiptReader("k", "m", client).read(img, "image/jpeg");
    expect(out.totalDue).toBe("352.00");
  });

  it("an unknown or retired model becomes a clear 'update GROQ_VISION_MODEL' message", async () => {
    await expect(new GroqReceiptReader("k", "old/model", fakeClient(() => badRequest()).client).read(img, "image/jpeg")).rejects.toMatchObject({ reason: "unavailable", message: expect.stringMatching(/GROQ_VISION_MODEL/) });
  });

  it("invalid or non-receipt output becomes a friendly error, never a guessed draft", async () => {
    await expect(new GroqReceiptReader("k", "m", fakeClient(() => "sorry, I can't").client).read(img, "image/jpeg")).rejects.toMatchObject({ reason: "unreadable" });
    await expect(new GroqReceiptReader("k", "m", fakeClient(() => JSON.stringify({ ...reading, lines: "nope" })).client).read(img, "image/jpeg")).rejects.toBeInstanceOf(ReceiptReadError);
    await expect(new GroqReceiptReader("k", "m", fakeClient(() => JSON.stringify({ ...reading, is_receipt: false })).client).read(img, "image/jpeg")).rejects.toMatchObject({ reason: "not_a_receipt" });
  });

  it("rate limits and bad keys map to 'unavailable'", async () => {
    const rate = new Groq.RateLimitError(429, {}, "slow down", new Headers());
    const auth = new Groq.AuthenticationError(401, {}, "bad key", new Headers());
    await expect(new GroqReceiptReader("k", "m", fakeClient(() => rate).client).read(img, "image/jpeg")).rejects.toMatchObject({ reason: "unavailable", message: expect.stringMatching(/busy/) });
    await expect(new GroqReceiptReader("k", "m", fakeClient(() => auth).client).read(img, "image/jpeg")).rejects.toMatchObject({ reason: "unavailable", message: expect.stringMatching(/set up/) });
  });

  it("extractJson handles fences, reasoning and garbage", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("<think>{not json}</think>{\"b\":2}")).toEqual({ b: 2 });
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("chooseReceiptReader", () => {
  const base = { RECEIPT_SCAN_FAKE: "0", RECEIPT_SCAN_PROVIDER: "auto", GROQ_API_KEY: undefined, GROQ_VISION_MODEL: "qwen/qwen3.8-27b", ANTHROPIC_API_KEY: undefined, RECEIPT_SCAN_MODEL: "claude-opus-5-5" } as const;
  it("no keys → scanning off; Groq key → Groq; both → Groq unless provider=claude; fake for tests", () => {
    expect(chooseReceiptReader({ ...base })).toBeNull();
    expect(chooseReceiptReader({ ...base, GROQ_API_KEY: "g" })).toBeInstanceOf(GroqReceiptReader);
    expect(chooseReceiptReader({ ...base, ANTHROPIC_API_KEY: "a" })).toBeInstanceOf(ClaudeReceiptReader);
    expect(chooseReceiptReader({ ...base, GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBeInstanceOf(GroqReceiptReader);
    expect(chooseReceiptReader({ ...base, GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a", RECEIPT_SCAN_PROVIDER: "claude" })).toBeInstanceOf(ClaudeReceiptReader);
    expect(chooseReceiptReader({ ...base, RECEIPT_SCAN_FAKE: "1" })).toBeInstanceOf(FakeReceiptReader);
  });
});

describe("forgiving setup: the Groq key is found despite common dashboard mistakes", () => {
  it("removes pasted quotes, spaces and new lines", () => {
    expect(readEnv({ GROQ_API_KEY: '  "gsk_abc"\n' }).GROQ_API_KEY).toBe("gsk_abc");
  });
  it("treats blank optional settings as not set instead of breaking the app", () => {
    const env = readEnv({ GROQ_API_KEY: "", ANTHROPIC_API_KEY: "  ", RECEIPT_SCAN_PROVIDER: "", GROQ_VISION_MODEL: "" });
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.RECEIPT_SCAN_PROVIDER).toBeUndefined();
    expect(env.GROQ_VISION_MODEL).toBeUndefined();
  });
  it("accepts mistyped names for the key", () => {
    for (const name of ["groq_api_key", "GROQ_KEY", "GROQ-API-KEY", "Groq_Api_Key", "GROQ_APIKEY", "GROQ_API_KEY "]) {
      expect(readEnv({ [name]: "gsk_x" }).GROQ_API_KEY, name).toBe("gsk_x");
    }
    expect(readEnv({ GROQ_VISION_MODEL: "m" }).GROQ_API_KEY).toBeUndefined();
  });
  it("lower-cases the provider choice", () => {
    expect(readEnv({ RECEIPT_SCAN_PROVIDER: "Groq" }).RECEIPT_SCAN_PROVIDER).toBe("groq");
  });
  it("explains why scanning is off using setting names only, never values", () => {
    expect(scanSetupHint({ VERCEL_ENV: "production" })).toMatch(/GROQ_API_KEY is not set in the "production" environment/);
    const lookalike = scanSetupHint({ GROK_API_KEY: "super-secret-value" });
    expect(lookalike).toMatch(/GROK_API_KEY/);
    expect(lookalike).not.toMatch(/super-secret-value/);
    expect(scanSetupHint({ RECEIPT_SCAN_PROVIDER: "claude", GROQ_API_KEY: "gsk_x" })).toMatch(/RECEIPT_SCAN_PROVIDER is "claude"/);
  });
});
