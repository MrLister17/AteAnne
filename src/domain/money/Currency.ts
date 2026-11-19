import { ValidationError } from "../errors";

export interface CurrencyInfo {
  /** ISO 4217 code. */
  code: string;
  name: string;
  /** Short sign shown inside money boxes and chips. */
  symbol: string;
  /** Digits after the decimal point that this app stores (minor units = major × 10^exponent). */
  exponent: 0 | 2;
}

/**
 * Currencies AteAnne supports: every one the European Central Bank publishes a
 * daily reference rate for and that Filipino groups commonly travel with (D62).
 * IDR is kept in whole rupiah, which is how prices are written.
 */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: "PHP", name: "Philippine peso", symbol: "₱", exponent: 2 },
  { code: "THB", name: "Thai baht", symbol: "฿", exponent: 2 },
  { code: "JPY", name: "Japanese yen", symbol: "¥", exponent: 0 },
  { code: "KRW", name: "South Korean won", symbol: "₩", exponent: 0 },
  { code: "SGD", name: "Singapore dollar", symbol: "S$", exponent: 2 },
  { code: "HKD", name: "Hong Kong dollar", symbol: "HK$", exponent: 2 },
  { code: "MYR", name: "Malaysian ringgit", symbol: "RM", exponent: 2 },
  { code: "IDR", name: "Indonesian rupiah", symbol: "Rp", exponent: 0 },
  { code: "CNY", name: "Chinese yuan", symbol: "CN¥", exponent: 2 },
  { code: "USD", name: "US dollar", symbol: "US$", exponent: 2 },
  { code: "EUR", name: "Euro", symbol: "€", exponent: 2 },
  { code: "AUD", name: "Australian dollar", symbol: "A$", exponent: 2 },
  { code: "GBP", name: "British pound", symbol: "£", exponent: 2 },
  { code: "CAD", name: "Canadian dollar", symbol: "C$", exponent: 2 },
  { code: "NZD", name: "New Zealand dollar", symbol: "NZ$", exponent: 2 },
  { code: "INR", name: "Indian rupee", symbol: "₹", exponent: 2 },
  { code: "CHF", name: "Swiss franc", symbol: "CHF", exponent: 2 },
] as const;

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
export const HOME_CURRENCY = "PHP";

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isCurrency(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

export function currencyInfo(code: string): CurrencyInfo {
  const c = BY_CODE.get(code);
  if (!c) throw new ValidationError("unknown_currency", `${code} is not a supported currency`);
  return c;
}

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** "1,397.00" for THB, "12,000" for JPY (no code); negatives keep a leading minus. */
export function formatMinorNumber(minor: bigint, code: string): string {
  const { exponent } = currencyInfo(code);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const unit = pow10(exponent);
  const major = (abs / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = exponent > 0 ? `.${(abs % unit).toString().padStart(exponent, "0")}` : "";
  return `${negative ? "-" : ""}${major}${fraction}`;
}

/** "THB 1,397.00", "JPY 12,000", "PHP 495.00" (the app's existing peso format). */
export function formatMinor(minor: bigint, code: string): string {
  return `${code} ${formatMinorNumber(minor, code)}`;
}

/**
 * Parse what a person typed ("1,397.5", "฿1397", "12000") into minor units.
 * At most `exponent` decimals; currency signs, codes and commas are ignored.
 */
export function parseMajor(input: string, code: string): bigint {
  const { exponent, symbol } = currencyInfo(code);
  let cleaned = input.trim().replace(/,/g, "");
  if (cleaned.toUpperCase().startsWith(code)) cleaned = cleaned.slice(code.length).trim();
  if (cleaned.startsWith(symbol)) cleaned = cleaned.slice(symbol.length).trim();
  const pattern = exponent === 0 ? /^(\d{1,12})(?:\.0{1,2})?$/ : /^(\d{1,10})(?:\.(\d{1,2}))?$/;
  const match = pattern.exec(cleaned);
  if (!match) {
    throw new ValidationError("money_malformed", exponent === 0 ? `"${input}" is not a whole ${code} amount` : `"${input}" is not a valid ${code} amount (up to 2 decimals)`);
  }
  const major = BigInt(match[1]);
  const fraction = exponent === 0 ? 0n : BigInt((match[2] ?? "").padEnd(exponent, "0") || "0");
  return major * pow10(exponent) + fraction;
}

/** Minor units → editable text: no commas, and whole amounts drop ".00" (139750 THB → "1397.50", 18000 → "180"). */
export function minorToInput(minor: bigint, code: string): string {
  const f = formatMinorNumber(minor, code).replace(/,/g, "");
  return f.endsWith(".00") ? f.slice(0, -3) : f;
}

/** YYYY-MM-DD for an instant, in Asia/Manila (the app's calendar). */
export function manilaDay(at: Date = new Date()): string {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "18 Nov" for a YYYY-MM-DD date. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
