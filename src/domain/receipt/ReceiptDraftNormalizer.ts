import { Money } from "../money/Money";

/**
 * What a receipt reader (e.g. a vision model) says it saw. Amounts are
 * strings exactly as read ("1,234.50"), never floats; the normalizer parses
 * them with exact peso parsing.
 */
export interface RawReceiptReading {
  isReceipt: boolean;
  merchant: string | null;
  lines: { label: string; quantity: number; unitPrice: string | null; lineTotal: string }[];
  /** Printed sum of the item lines ("Gross Sales", "Subtotal"), if the receipt shows one. Used only as a cross-check. */
  itemsSubtotal?: string | null;
  discounts: { label: string; amount: string; base: "gross" | "vat_exclusive" | "unknown" }[];
  serviceCharge: string | null;
  otherCharges: { label: string; amount: string }[];
  totalDue: string | null;
  unreadableNotes: string[];
}

export interface DraftLine {
  label: string;
  quantity: number;
  amount: bigint;
  unitPrice: bigint | null;
}

export interface DraftAdjustment {
  kind: "DISCOUNT" | "SERVICE" | "CHARGE";
  label: string;
  amount: bigint;
}

export interface ReceiptDraft {
  label: string;
  lines: DraftLine[];
  adjustments: DraftAdjustment[];
  payable: bigint;
  /** items − discounts + charges, after any normalization. */
  computedPayable: bigint;
  reconciled: boolean;
  /** Plain-language notes the person must check before saving. */
  warnings: string[];
}

const MAX_LINES = 50;
const MAX_ADJUSTMENTS = 20;
const MAX_LABEL = 80;
/** Philippine VAT is 12%: a VAT-exclusive discount d equals a VAT-inclusive reduction of d × 1.12, give or take 2 centavos of printed rounding. */
function isVatGrossUp(inclusive: bigint, printed: bigint): boolean {
  const off = inclusive * 100n - printed * 112n;
  return off >= -200n && off <= 200n;
}
/** Digits that thermal printing and photos commonly confuse with each other. */
const LOOKALIKE: Record<string, string> = { "0": "86", "1": "7", "3": "85", "5": "638", "6": "580", "7": "1", "8": "3605" };

/** Every value that differs from `value` by exactly one look-alike digit. */
function lookalikes(value: bigint): bigint[] {
  const digits = value.toString();
  const out: bigint[] = [];
  for (let i = 0; i < digits.length; i++) {
    for (const d of LOOKALIKE[digits[i]] ?? "") {
      if (i === 0 && d === "0") continue;
      out.push(BigInt(digits.slice(0, i) + d + digits.slice(i + 1)));
    }
  }
  return out;
}

/**
 * Turns an untrusted machine reading of a receipt into a draft the person
 * reviews in the normal receipt editor. Never trusted as final: it parses
 * amounts exactly, drops anything malformed with a warning, and reconciles.
 *
 * Special case (common on Philippine receipts): a senior/PWD/loyalty discount
 * printed on the VAT-exclusive base. Items are VAT-inclusive, so the printed
 * discount is too small for the total to add up. When the gap is explained
 * by a VAT gross-up of the printed discount, the discount is replaced by the
 * equivalent gross reduction (spec: "manual normalization must be explicit
 * and reconciled") and a warning says exactly what changed.
 *
 * Cross-checks (the "processing layer" between the reader and the form). A
 * reader only copies what it sees; this class checks the arithmetic:
 *  - quantity × unit price must equal the line total;
 *  - the lines must add up to the printed subtotal ("Gross Sales"), which is
 *    itself only believed when it agrees with the printed total.
 * When exactly one explanation makes everything agree (a line total that
 * should be quantity × unit price, or one look-alike digit such as 5/6), the
 * line is corrected and a warning names the change. Otherwise nothing is
 * guessed and the warning says how far off the items are.
 */
export class ReceiptDraftNormalizer {
  normalize(reading: RawReceiptReading): ReceiptDraft {
    const warnings: string[] = [];
    const money = (raw: string | null | undefined, what: string): bigint | null => {
      if (raw === null || raw === undefined || raw.trim() === "") return null;
      try {
        return Money.parsePesos(raw).assertWithin().centavos;
      } catch {
        warnings.push(`Couldn’t read the amount for ${what} (“${raw}”). Enter it by hand.`);
        return null;
      }
    };
    const label = (s: string, fallback: string) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) || fallback;

    const lines: DraftLine[] = [];
    for (const [i, l] of reading.lines.entries()) {
      if (lines.length >= MAX_LINES) {
        warnings.push(`Only the first ${MAX_LINES} items were kept.`);
        break;
      }
      const name = label(l.label, `Item ${i + 1}`);
      const amount = money(l.lineTotal, `“${name}”`);
      if (amount === null) continue;
      const quantity = Number.isFinite(l.quantity) && l.quantity >= 1 ? Math.min(1000, Math.round(l.quantity)) : 1;
      lines.push({ label: name, quantity, amount, unitPrice: money(l.unitPrice, `the unit price of “${name}”`) });
    }

    let adjustments: DraftAdjustment[] = [];
    for (const d of reading.discounts) {
      const amount = money(d.amount, `discount “${d.label}”`);
      if (amount !== null && amount > 0n) adjustments.push({ kind: "DISCOUNT", label: label(d.label, "Discount"), amount });
    }
    const service = money(reading.serviceCharge, "the service charge");
    if (service !== null && service > 0n) adjustments.push({ kind: "SERVICE", label: "Service charge", amount: service });
    for (const c of reading.otherCharges) {
      const amount = money(c.amount, `charge “${c.label}”`);
      if (amount !== null && amount > 0n) adjustments.push({ kind: "CHARGE", label: label(c.label, "Charge"), amount });
    }
    if (adjustments.length > MAX_ADJUSTMENTS) {
      adjustments = adjustments.slice(0, MAX_ADJUSTMENTS);
      warnings.push(`Only the first ${MAX_ADJUSTMENTS} discounts/charges were kept.`);
    }

    const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
    const php = (c: bigint) => Money.of(c).toString();

    // A quantity is certain when the line total is an exact multiple of the unit price.
    for (const l of lines) {
      if (l.unitPrice === null || l.unitPrice <= 0n || l.amount % l.unitPrice !== 0n) continue;
      const k = l.amount / l.unitPrice;
      if (k >= 1n && k <= 1000n && Number(k) !== l.quantity) {
        warnings.push(`“${l.label}”: quantity set to ${k} because ${k} × ${php(l.unitPrice)} = ${php(l.amount)}.`);
        l.quantity = Number(k);
      }
    }

    let gross = sum(lines.map((l) => l.amount));
    let charges = sum(adjustments.filter((a) => a.kind !== "DISCOUNT").map((a) => a.amount));
    let discounts = sum(adjustments.filter((a) => a.kind === "DISCOUNT").map((a) => a.amount));

    const totalRead = money(reading.totalDue, "the total");
    let payable = totalRead;
    if (payable === null) {
      payable = gross - discounts + charges;
      warnings.push("No total was found, so the total was calculated from the items. Check it against the receipt.");
    }

    // The printed subtotal is believed only when it agrees with the printed total
    // (with the discount as printed, or as a VAT-exclusive figure).
    let subtotal: bigint | null = null;
    if (totalRead !== null && lines.length > 0 && gross - discounts + charges !== payable) {
      let printed: bigint | null = null;
      try {
        printed = reading.itemsSubtotal ? Money.parsePesos(reading.itemsSubtotal).assertWithin().centavos : null;
      } catch {
        printed = null;
      }
      if (printed !== null && printed > 0n) {
        // Strict: the discount as printed, or exactly its 12% VAT gross-up (± 2 centavos of rounding).
        const agrees = (chargeTotal: bigint) => {
          const need = printed + chargeTotal - payable!;
          return need === discounts || (discounts > 0n && isVatGrossUp(need, discounts));
        };
        if (agrees(charges)) subtotal = printed;
        else {
          // The service charge itself may hold the misread digit: accept one look-alike digit there if exactly one makes the printed figures agree.
          const services = adjustments.filter((a) => a.kind === "SERVICE");
          if (services.length === 1) {
            const fixes = lookalikes(services[0].amount).filter((v) => agrees(charges - services[0].amount + v));
            if (fixes.length === 1) {
              warnings.push(`The service charge was read as ${php(services[0].amount)}; changed to ${php(fixes[0])} because that one look-alike digit makes the printed subtotal and total agree. Check it against the photo.`);
              charges += fixes[0] - services[0].amount;
              services[0].amount = fixes[0];
              subtotal = printed;
            }
          }
        }
      }
      // What the items should add up to: the verified subtotal, else what the total implies.
      const target = subtotal ?? payable - charges + discounts;
      if (gross !== target) gross += this.repairLines(lines, target - gross, subtotal !== null, warnings, php);
    }

    // VAT-exclusive discount normalization, measured against the verified subtotal when there is one.
    const basis = subtotal ?? gross;
    const needed = basis + charges - payable; // discount that would make it reconcile
    if (discounts > 0n && needed !== discounts && needed > discounts && needed <= basis) {
      // Only an exact 12% gross-up counts. A looser window would let a misread amount hide inside the discount.
      if (isVatGrossUp(needed, discounts)) {
        const printed = discounts;
        const names = adjustments.filter((a) => a.kind === "DISCOUNT").map((a) => a.label).join(" + ");
        adjustments = [{ kind: "DISCOUNT", label: `${names} (VAT-inclusive equivalent)`.slice(0, MAX_LABEL), amount: needed }, ...adjustments.filter((a) => a.kind !== "DISCOUNT")];
        discounts = needed;
        warnings.push(
          `The discount was printed as ${php(printed)} on the VAT-exclusive price, so it was changed to the VAT-inclusive equivalent of ${php(needed)} to match the total. Check this is right.`,
        );
      }
    }

    const computedPayable = gross - discounts + charges;
    const reconciled = computedPayable === payable && lines.length > 0;
    if (!lines.length) warnings.push("No items could be read. Add them by hand.");
    else if (!reconciled && subtotal !== null && gross !== subtotal) {
      const diff = subtotal - gross;
      warnings.push(`The items add up to ${php(gross)}, but the receipt’s printed subtotal is ${php(subtotal)} (${diff > 0n ? "short" : "over"} by ${php(diff < 0n ? -diff : diff)}). An item is probably ${diff > 0n ? "missing or misread" : "misread or listed twice"}; compare each amount with the photo.`);
    } else if (!reconciled) {
      const diff = payable - computedPayable;
      warnings.push(`The items ${diff > 0n ? "come to less" : "come to more"} than the total by ${Money.of(diff < 0n ? -diff : diff).toString()}. An item may be missing or misread.`);
    }
    for (const note of reading.unreadableNotes.slice(0, 5)) warnings.push(`Hard to read: ${note.slice(0, 160)}`);

    return { label: label(reading.merchant ?? "", "Scanned receipt"), lines, adjustments, payable, computedPayable, reconciled, warnings };
  }

  /**
   * Tries to close `gap` (target − current item sum) with ONE well-supported
   * correction. Mutates the lines and returns the amount added to the sum
   * (0 when nothing certain was found).
   */
  private repairLines(lines: DraftLine[], gap: bigint, digitRepairAllowed: boolean, warnings: string[], php: (c: bigint) => string): bigint {
    // 1. Line totals that disagree with quantity × unit price.
    const expected = (l: DraftLine) => BigInt(l.quantity) * (l.unitPrice ?? 0n);
    const odd = lines.filter((l) => l.unitPrice !== null && l.unitPrice > 0n && expected(l) !== l.amount);
    const fix = (group: DraftLine[]) => {
      for (const l of group) {
        warnings.push(`“${l.label}” was read as ${php(l.amount)}, but ${l.quantity} × ${php(l.unitPrice!)} = ${php(expected(l))}, which makes the items add up. Changed to ${php(expected(l))}; check it.`);
        l.amount = expected(l);
      }
      return gap;
    };
    const single = odd.filter((l) => expected(l) - l.amount === gap);
    if (single.length === 1) return fix(single);
    if (odd.length > 1 && odd.reduce((a, l) => a + expected(l) - l.amount, 0n) === gap) return fix(odd);

    // 2. One look-alike digit (5/6, 3/8, 1/7 …), only against a verified printed subtotal and only when unique.
    if (!digitRepairAllowed) return 0n;
    const options: { line: DraftLine; amount: bigint; unitPrice: bigint | null }[] = [];
    for (const l of lines) {
      const viaUnit = l.unitPrice !== null && l.unitPrice > 0n && expected(l) === l.amount;
      for (const value of lookalikes(viaUnit ? l.unitPrice! : l.amount)) {
        const amount = viaUnit ? value * BigInt(l.quantity) : value;
        if (amount - l.amount === gap) options.push({ line: l, amount, unitPrice: viaUnit ? value : l.unitPrice });
      }
    }
    if (options.length !== 1) return 0n;
    const [{ line, amount, unitPrice }] = options;
    warnings.push(`“${line.label}” was read as ${php(line.amount)}; changed to ${php(amount)} because that one look-alike digit makes the items match the receipt’s printed subtotal. Check this line against the photo.`);
    line.amount = amount;
    line.unitPrice = unitPrice;
    return gap;
  }
}
