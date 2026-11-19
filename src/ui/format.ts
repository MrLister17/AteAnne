import { Money } from "@/domain/money/Money";
import { formatMinor, minorToInput, parseMajor } from "@/domain/money/Currency";

const big = (v: string | bigint) => (typeof v === "string" ? BigInt(v) : v);

/** "THB 1,397.00" / "JPY 12,000" / "PHP 495.00" from wire minor units. */
export function money(minor: string | bigint | null | undefined, currency = "PHP"): string {
  return formatMinor(minor === null || minor === undefined ? 0n : big(minor), currency);
}

/** Absolute value, e.g. "PHP 495.00" (the sign is carried by the words around it). */
export function moneyAbs(minor: string | bigint, currency = "PHP"): string {
  const v = big(minor);
  return money(v < 0n ? -v : v, currency);
}

/** Typed amount → wire minor units, or null if invalid / above the bound. */
export function toMinor(input: string, currency = "PHP"): string | null {
  try {
    const v = parseMajor(input, currency);
    return v <= 100_000_000n ? v.toString() : null;
  } catch {
    return null;
  }
}

/** Wire minor units → editable text ("180.00" → "180"; yen stays whole). */
export function toMinorInput(minor: string, currency = "PHP"): string {
  return minorToInput(big(minor), currency);
}

/** "PHP 1,234.50" from wire centavos. */
export function php(centavos: string | bigint | null | undefined): string {
  if (centavos === null || centavos === undefined) return "PHP 0.00";
  return Money.of(typeof centavos === "string" ? BigInt(centavos) : centavos).toString();
}

/** "1,234.50" (no currency). */
export function pesos(centavos: string | bigint): string {
  return Money.of(typeof centavos === "string" ? BigInt(centavos) : centavos).format();
}

/** Abs value as "PHP 495.00" (sign carried separately in text). */
export function phpAbs(centavos: string | bigint): string {
  const v = typeof centavos === "string" ? BigInt(centavos) : centavos;
  return php(v < 0n ? -v : v);
}

/** Parse peso input to wire centavos, or null if invalid. */
export function toCentavos(input: string): string | null {
  try {
    return Money.parsePesos(input).assertWithin().toWire();
  } catch {
    return null;
  }
}

/** Wire centavos → editable peso string ("180.00" → "180"). */
export function toInput(centavos: string): string {
  const f = pesos(centavos).replace(/,/g, "");
  return f.endsWith(".00") ? f.slice(0, -3) : f;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

/** Put a direction sign after a leading "≈ " so it reads "≈ −THB 513.88", not "−≈ THB 513.88". */
export function signed(sign: string, text: string): string {
  return text.startsWith("≈ ") ? `≈ ${sign}${text.slice(2)}` : `${sign}${text}`;
}
