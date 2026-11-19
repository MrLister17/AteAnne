import type { Db } from "../db";
import { RateLimitedError } from "../http/HttpError";

export interface RateRule {
  /** Bucket namespace, e.g. "join-fail-ip". */
  name: string;
  limit: number;
  windowMs: number;
}

/** Baseline limits from the specification (tune during the pilot). */
export const RATE_RULES = {
  joinsPerEvent: { name: "join-event", limit: 60, windowMs: 60 * 60 * 1000 },
  failedCodePerIp: { name: "join-fail-ip", limit: 20, windowMs: 10 * 60 * 1000 },
  /** Receipt saves, claims and payment reports, per real person per event (D57): an organizer acting for guests shares one budget. */
  financialSavesPerPerson: { name: "fin-person", limit: 30, windowMs: 60 * 1000 },
  recoveryPerIp: { name: "recover-ip", limit: 20, windowMs: 10 * 60 * 1000 },
  createPerIp: { name: "create-ip", limit: 30, windowMs: 60 * 60 * 1000 },
  uploadsPerMember: { name: "upload-member", limit: 20, windowMs: 10 * 60 * 1000 },
  /** Each scan is a paid API call: cap per person and per event. */
  scansPerMember: { name: "scan-member", limit: 10, windowMs: 60 * 60 * 1000 },
  scansPerEvent: { name: "scan-event", limit: 40, windowMs: 24 * 60 * 60 * 1000 },
} satisfies Record<string, RateRule>;

/**
 * Fixed-window counters stored in PostgreSQL so limits survive restarts and
 * work across instances. Keys are hashed identifiers (never raw IPs).
 * Call these BEFORE opening an event transaction: they use their own pool
 * connection, and inside a transaction they would hold a second connection
 * while the event row is locked (S9.4c).
 */
export class RateLimiter {
  constructor(private readonly db: Db) {}

  /** Count one hit and throw 429 when the window is exhausted. */
  async hit(rule: RateRule, subject: string): Promise<void> {
    if (process.env.RATE_LIMIT_DISABLED === "1") return;
    const { allowed, windowStart } = await this.consume(rule, subject);
    if (!allowed) throw new RateLimitedError(secondsLeft(rule, windowStart));
  }

  /** Throw 429 if already exhausted, without counting. */
  async check(rule: RateRule, subject: string): Promise<void> {
    if (process.env.RATE_LIMIT_DISABLED === "1") return;
    const key = `${rule.name}:${subject}`;
    const bucket = await this.db.rateLimitBucket.findUnique({ where: { key } });
    if (bucket && Date.now() - bucket.windowStart.getTime() < rule.windowMs && bucket.count >= rule.limit) {
      throw new RateLimitedError(secondsLeft(rule, bucket.windowStart));
    }
  }

  async consume(rule: RateRule, subject: string): Promise<{ allowed: boolean; windowStart: Date }> {
    const key = `${rule.name}:${subject}`;
    const now = new Date();
    const windowFloor = new Date(now.getTime() - rule.windowMs);
    // Atomic upsert: reset when the window has elapsed, else increment.
    const rows = await this.db.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" < ${windowFloor} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < ${windowFloor} THEN ${now} ELSE "RateLimitBucket"."windowStart" END
      RETURNING "count", "windowStart"`;
    return { allowed: Number(rows[0]?.count ?? 0) <= rule.limit, windowStart: new Date(rows[0]?.windowStart ?? now) };
  }
}

/** Whole seconds until this window resets (at least 1). */
function secondsLeft(rule: RateRule, windowStart: Date): number {
  return Math.max(1, Math.ceil((windowStart.getTime() + rule.windowMs - Date.now()) / 1000));
}
