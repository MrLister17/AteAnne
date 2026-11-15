import { Money } from "@/domain/money/Money";

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
