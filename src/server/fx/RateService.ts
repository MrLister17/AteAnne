import type { Prisma } from "@/generated/prisma/client";
import { addDays, manilaDay } from "@/domain/money/Currency";
import type { DayRates } from "@/domain/fx/ExchangeRate";
import type { Db, Tx } from "../db";
import type { RateProvider } from "./RateProvider";

/** How long a provisional answer (today's rate not out yet) is reused before asking again. */
const PROVISIONAL_TTL_MS = 30 * 60 * 1000;
/** The ECB publishes around 14:00–15:00 UTC; after 18:00 UTC a day's answer is final. */
const FINAL_AFTER_UTC_HOUR = 18;
/** Receipts may be dated up to a year back. */
export const MAX_PURCHASE_AGE_DAYS = 366;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

type Reader = Pick<Db, "exchangeRate"> | Pick<Tx, "exchangeRate">;

/**
 * The daily-rate cache (D60–D62). Rates are fetched only here, always outside
 * an event's locked transaction (D57: no outside calls or second connection
 * while the event row is held); everything else reads the cache.
 *
 * A cached answer for a day is final once the ECB has published that day (or
 * the day is past its publication time, for weekends and holidays). Until
 * then it holds the latest earlier rate and is refreshed at most every 30
 * minutes, so a receipt bought today shows yesterday's rate until tonight.
 */
export class RateService {
  constructor(
    private readonly db: Db,
    private readonly provider: RateProvider | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** "ecb", "fake", or "off" when nothing can be fetched (cached rates still work). */
  get source(): "ecb" | "fake" | "off" {
    return this.provider?.source ?? "off";
  }

  today(): string {
    return manilaDay(this.now());
  }

  private isFinal(row: { day: Date; effectiveDate: Date; fetchedAt: Date }): boolean {
    const day = iso(row.day);
    return iso(row.effectiveDate) === day || row.fetchedAt.getTime() >= Date.parse(`${day}T${String(FINAL_AFTER_UTC_HOUR).padStart(2, "0")}:00:00Z`);
  }

  /**
   * Make sure each day has a usable cached answer. Never throws: when the
   * source is down, callers fall back to what's cached (or wait, never guess).
   */
  async ensureDays(days: Iterable<string>): Promise<void> {
    if (!this.provider) return;
    const today = this.today();
    const wanted = [...new Set(days)].filter((d) => d <= today && d >= addDays(today, -MAX_PURCHASE_AGE_DAYS)).sort();
    if (!wanted.length) return;
    const rows = await this.db.exchangeRate.findMany({ where: { source: this.provider.source, day: { in: wanted.map(asDate) } } });
    const byDay = new Map(rows.map((r) => [iso(r.day), r]));
    for (const day of wanted) {
      const row = byDay.get(day);
      if (row && (this.isFinal(row) || this.now().getTime() - row.fetchedAt.getTime() < PROVISIONAL_TTL_MS)) continue;
      try {
        const got = await this.provider.fetchDay(day);
        if (got.effectiveDate > day) continue; // never use a rate from after the day
        const data = { effectiveDate: asDate(got.effectiveDate), perEur: got.perEur as Prisma.InputJsonValue, fetchedAt: this.now() };
        await this.db.exchangeRate.upsert({
          where: { source_day: { source: this.provider.source, day: asDate(day) } },
          create: { source: this.provider.source, day: asDate(day), ...data },
          update: data,
        });
      } catch (e) {
        console.warn(`[fx] could not fetch ${day}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Cached rates for these days (ECB preferred over fake rows when both exist). */
  static async load(db: Reader, days: Iterable<string>): Promise<Map<string, DayRates>> {
    const wanted = [...new Set(days)];
    const out = new Map<string, DayRates>();
    if (!wanted.length) return out;
    const rows = await (db.exchangeRate as Db["exchangeRate"]).findMany({ where: { day: { in: wanted.map(asDate) } } });
    for (const r of rows.sort((a, b) => (a.source === "ecb" ? 1 : 0) - (b.source === "ecb" ? 1 : 0))) {
      out.set(iso(r.day), { day: iso(r.day), effectiveDate: iso(r.effectiveDate), perEur: r.perEur as Record<string, string>, source: r.source });
    }
    return out;
  }

  /** Today's cached table, if any (no fetch). */
  async todayRates(): Promise<DayRates | null> {
    return (await RateService.load(this.db, [this.today()])).get(this.today()) ?? null;
  }

  /** Daily job: refresh today plus every day a still-open event's foreign receipts need. */
  async refreshForOpenEvents(): Promise<number> {
    const receipts = await this.db.receipt.findMany({
      where: { event: { phase: { not: "DONE" } } },
      select: { currency: true, purchasedOn: true, createdAt: true, event: { select: { currency: true } } },
    });
    const days = new Set<string>([this.today()]);
    for (const r of receipts) if (r.currency !== r.event.currency) days.add(r.purchasedOn ? iso(r.purchasedOn) : manilaDay(r.createdAt));
    await this.ensureDays(days);
    return days.size;
  }

  /** For /api/health: the newest cached day and its ECB date. */
  async latest(): Promise<{ day: string; effectiveDate: string } | null> {
    const row = await this.db.exchangeRate.findFirst({ orderBy: { day: "desc" }, where: this.provider ? { source: this.provider.source } : {} });
    return row ? { day: iso(row.day), effectiveDate: iso(row.effectiveDate) } : null;
  }
}

/** The calendar day a receipt was bought (null purchasedOn = the day it was entered, in Manila). */
export function receiptDay(r: { purchasedOn: Date | null; createdAt: Date }): string {
  return r.purchasedOn ? iso(r.purchasedOn) : manilaDay(r.createdAt);
}
