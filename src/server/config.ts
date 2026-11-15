import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  JOIN_CODE_HASH_KEY: z.string().min(32, "JOIN_CODE_HASH_KEY must be at least 32 characters; run npm run setup"),
  PRIVATE_UPLOAD_DIR: z.string().min(1).default("./storage/uploads"),
  CLEANUP_TOKEN: z.string().optional(),
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

/** Test hook: forget cached config after mutating process.env. */
export function resetConfigForTests(): void {
  cached = null;
}
