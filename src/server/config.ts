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

/** Optional settings where a blank value means "not set" (a blank box in a hosting dashboard must not break the app). */
const OPTIONAL_KEYS = ["APP_ORIGIN", "STORAGE_DRIVER", "PRIVATE_UPLOAD_DIR", "CLEANUP_TOKEN", "EVENT_RETENTION_DAYS", "ANTHROPIC_API_KEY", "RECEIPT_SCAN_MODEL", "GROQ_API_KEY", "GROQ_VISION_MODEL", "RECEIPT_SCAN_PROVIDER", "RECEIPT_SCAN_FAKE", "CRON_SECRET"] as const;
/** Common ways the Groq key gets named by mistake; compared ignoring case and punctuation. */
const GROQ_KEY_ALIASES = new Set(["GROQAPIKEY", "GROQKEY", "GROQAPI", "GROQTOKEN", "GROQAPITOKEN", "GROQSECRETKEY", "GROQSECRET", "GROQCLOUDAPIKEY"]);
const squash = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Trim spaces/new lines and one pair of surrounding quotes, as often pasted into dashboards. */
const tidy = (v: string | undefined) => (v ?? "").trim().replace(/^(["'])(.*)\1$/s, "$2").trim();

/**
 * Forgiving read of the environment for OPTIONAL settings only: blank means
 * unset, pasted quotes/spaces are removed, and a mistyped name for the Groq
 * key (groq_api_key, GROQ_KEY, "GROQ_API_KEY " …) is still found.
 */
export function readEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const k of OPTIONAL_KEYS) {
    const v = tidy(out[k]);
    if (v) out[k] = v;
    else delete out[k];
  }
  if (!out.GROQ_API_KEY) {
    const alias = Object.keys(env).find((k) => k !== "GROQ_API_KEY" && GROQ_KEY_ALIASES.has(squash(k)) && tidy(env[k]));
    if (alias) out.GROQ_API_KEY = tidy(env[alias]);
  }
  if (out.RECEIPT_SCAN_PROVIDER) out.RECEIPT_SCAN_PROVIDER = out.RECEIPT_SCAN_PROVIDER.toLowerCase();
  return out;
}

/**
 * Plain-language reason why photo scanning is off, for /api/health. Mentions
 * setting NAMES only, never values.
 */
export function scanSetupHint(env: Record<string, string | undefined> = process.env): string {
  const where = env.VERCEL_ENV ? `the "${env.VERCEL_ENV}" environment` : "this server";
  const e = readEnv(env);
  const provider = e.RECEIPT_SCAN_PROVIDER ?? "auto";
  if (provider === "claude" && !e.ANTHROPIC_API_KEY) return `RECEIPT_SCAN_PROVIDER is "claude" but ANTHROPIC_API_KEY is not set in ${where}. Remove RECEIPT_SCAN_PROVIDER to use Groq, then redeploy.`;
  if (e.GROQ_API_KEY || e.ANTHROPIC_API_KEY) return "A key is set but the scanner did not start. Redeploy the newest deployment.";
  const lookalikes = Object.keys(env).filter((k) => /GROQ|GROK/i.test(k) && !["GROQ_VISION_MODEL"].includes(k));
  if (lookalikes.length) return `No usable GROQ_API_KEY in ${where}. Found similar setting name(s): ${lookalikes.join(", ")}. Rename it to exactly GROQ_API_KEY, make sure it has a value, then redeploy.`;
  return `GROQ_API_KEY is not set in ${where}. In Vercel: Settings → Environment Variables → add GROQ_API_KEY with "Production" ticked → Deployments → Redeploy the newest one.`;
}

let cached: AppConfig | null = null;

/** Validated environment configuration (read once, lazily). */
export function config(): AppConfig {
  if (!cached) {
    const parsed = schema.parse(readEnv());
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
  const parsed = schema.safeParse(readEnv());
  return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
}

/** Test hook: forget cached config after mutating process.env. */
export function resetConfigForTests(): void {
  cached = null;
}
