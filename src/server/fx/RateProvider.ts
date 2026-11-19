import { CURRENCY_CODES, DAY_PATTERN } from "@/domain/money/Currency";

export interface PublishedRates {
  /** The ECB date the rates were published for (the asked-for day, or the latest business day before it). */
  effectiveDate: string;
  /** Units of each currency per euro, as exact decimal text ("61.54"). */
  perEur: Record<string, string>;
}

/** Port: where daily reference rates come from. */
export interface RateProvider {
  /** Stored with every cached row and shown in /api/health. */
  readonly source: "ecb" | "fake";
  fetchDay(day: string): Promise<PublishedRates>;
}

export class RateFetchError extends Error {}

const DECIMAL_TEXT = /^\d{1,12}(?:\.\d{1,12})?$/;

/**
 * European Central Bank reference rates through Frankfurter (free, no key,
 * history by date). The ECB publishes once per business day around 16:00 CET;
 * asking for a weekend, a holiday or a day not published yet returns the
 * latest earlier publication, which `effectiveDate` reports (D62).
 *
 * Rates arrive as JSON numbers with at most 6 significant digits, so
 * `String(n)` gives back the published decimal exactly; anything else is refused.
 */
export class EcbRateProvider implements RateProvider {
  readonly source = "ecb" as const;

  constructor(
    private readonly baseUrls: readonly string[] = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"],
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 5_000,
  ) {}

  async fetchDay(day: string): Promise<PublishedRates> {
    if (!DAY_PATTERN.test(day)) throw new RateFetchError(`Bad day ${day}`);
    let lastError: unknown;
    for (const base of this.baseUrls) {
      try {
        const res = await this.fetchImpl(`${base.replace(/\/$/, "")}/${day}?base=EUR`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
        if (!res.ok) throw new RateFetchError(`Rate source answered ${res.status}`);
        return EcbRateProvider.parse(await res.json());
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new RateFetchError("Rate source unavailable");
  }

  /** Validate Frankfurter's `{ base: "EUR", date, rates: { PHP: 61.54, ... } }`. */
  static parse(body: unknown): PublishedRates {
    const b = body as { base?: unknown; date?: unknown; rates?: unknown };
    if (!b || b.base !== "EUR" || typeof b.date !== "string" || !DAY_PATTERN.test(b.date) || !b.rates || typeof b.rates !== "object") {
      throw new RateFetchError("Unexpected rate source reply");
    }
    const perEur: Record<string, string> = {};
    for (const code of CURRENCY_CODES) {
      if (code === "EUR") continue;
      const v = (b.rates as Record<string, unknown>)[code];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const text = String(v);
      if (DECIMAL_TEXT.test(text)) perEur[code] = text;
    }
    if (!perEur.PHP) throw new RateFetchError("The rate source has no peso rate");
    return { effectiveDate: b.date, perEur };
  }
}

/** Fixed per-euro table: PHP 65 and THB 40 give the plan's 1 THB = 1.625 PHP. */
export const FAKE_PER_EUR: Record<string, string> = {
  PHP: "65",
  THB: "40",
  JPY: "162.5",
  KRW: "1500",
  SGD: "1.45",
  HKD: "8.45",
  MYR: "4.8",
  IDR: "17500",
  CNY: "7.8",
  USD: "1.08",
  AUD: "1.65",
  GBP: "0.85",
  CAD: "1.5",
  NZD: "1.8",
  INR: "90",
  CHF: "0.95",
};

/**
 * Deterministic rates for tests and demos (FX_RATES_FAKE=1; never used on
 * Vercel production). `table` may vary rates by day or return null to act
 * like an outage.
 */
export class FakeRateProvider implements RateProvider {
  readonly source = "fake" as const;
  calls = 0;

  constructor(private readonly table: (day: string) => Record<string, string> | null = () => FAKE_PER_EUR) {}

  async fetchDay(day: string): Promise<PublishedRates> {
    this.calls++;
    const perEur = this.table(day);
    if (!perEur) throw new RateFetchError("Fake outage");
    return { effectiveDate: day, perEur };
  }
}
