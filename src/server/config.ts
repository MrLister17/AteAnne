import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z
    .string()
    .url()
    .default(
      process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000",
    ),
  /** "database" (default; works on Vercel) or "disk" (self-hosting with a persistent volume). */
  STORAGE_DRIVER: z.enum(["database", "disk"]).default("database"),
  JOIN_CODE_HASH_KEY: z.string().min(32, "JOIN_CODE_HASH_KEY must be at least 32 characters; run npm run setup"),
  PRIVATE_UPLOAD_DIR: z.string().min(1).default("./storage/uploads"),
  CLEANUP_TOKEN: z.string().optional(),
  /** Every event (finished or not) is deleted this many days after creation. */
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Enables photo → receipt draft scanning (Claude API). Optional. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  RECEIPT_SCAN_MODEL: z.string().min(1).default("claude-opus-5-5"),
  /** Free-tier option: photo → receipt draft via a Groq-hosted vision model. */
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_VISION_MODEL: z.string().min(1).default("qwen/qwen3.8-27b"),
  /** Which reader to use when several keys are set. "auto": Groq if its key is set, else Claude. */
  RECEIPT_SCAN_PROVIDER: z.enum(["auto", "groq", "claude"]).default("auto"),
  /** Test/demo only: deterministic fake reader. Ignored on Vercel production. */
  RECEIPT_SCAN_FAKE: z.enum(["0", "1"]).default("0"),
  /** Set by Vercel Cron; accepted as the cleanup bearer token. */
  CRON_SECRET: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = z.infer<typeof schema> & { secureCookies: boolean };

let cached: AppConfig | null = null;

/** Validated environment configuration (read once, lazily). */
export function config(): AppConfig {
  if (!cached) {
    const parsed = schema.parse(process.env);
    cached = { ...parsed, secureCookies: parsed.NODE_ENV === "production" || parsed.APP_ORIGIN.startsWith("https://") };
  }
  return cached;
}

/**
 * Missing/invalid settings, without throwing. Empty when fully configured.
 * Used for "preview mode": the UI can be deployed and explored before the
 * database is connected; every API call then answers 503 not_configured.
 */
export function configProblems(): string[] {
  const parsed = schema.safeParse(process.env);
  return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
}

/** Test hook: forget cached config after mutating process.env. */
export function resetConfigForTests(): void {
  cached = null;
}
