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
/** Philippine VAT is 12%; allow a little slack for rounding on the printed figures. */
const VAT_GROSS_UP_MAX = 1.135;

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
    const gross = sum(lines.map((l) => l.amount));
    const charges = sum(adjustments.filter((a) => a.kind !== "DISCOUNT").map((a) => a.amount));
    let discounts = sum(adjustments.filter((a) => a.kind === "DISCOUNT").map((a) => a.amount));

    let payable = money(reading.totalDue, "the total");
    if (payable === null) {
      payable = gross - discounts + charges;
      warnings.push("No total was found, so the total was calculated from the items. Check it against the receipt.");
    }

    // VAT-exclusive discount normalization.
    const needed = gross + charges - payable; // discount that would make it reconcile
    if (discounts > 0n && needed !== discounts && needed > discounts && needed <= gross) {
      const ratio = Number(needed) / Number(discounts);
      const printedOnExVat = reading.discounts.some((d) => d.base === "vat_exclusive") || ratio <= VAT_GROSS_UP_MAX;
      if (printedOnExVat && ratio <= VAT_GROSS_UP_MAX) {
        const printed = discounts;
        const names = adjustments.filter((a) => a.kind === "DISCOUNT").map((a) => a.label).join(" + ");
        adjustments = [{ kind: "DISCOUNT", label: `${names} (VAT-inclusive equivalent)`.slice(0, MAX_LABEL), amount: needed }, ...adjustments.filter((a) => a.kind !== "DISCOUNT")];
        discounts = needed;
        warnings.push(
          `The discount was printed as ${Money.of(printed).toString()} on the VAT-exclusive price, so it was changed to the VAT-inclusive equivalent of ${Money.of(needed).toString()} to match the total. Check this is right.`,
        );
      }
    }

    const computedPayable = gross - discounts + charges;
    const reconciled = computedPayable === payable && lines.length > 0;
    if (!lines.length) warnings.push("No items could be read. Add them by hand.");
    else if (!reconciled) {
      const diff = payable - computedPayable;
      warnings.push(`The items ${diff > 0n ? "come to less" : "come to more"} than the total by ${Money.of(diff < 0n ? -diff : diff).toString()}. An item may be missing or misread.`);
    }
    for (const note of reading.unreadableNotes.slice(0, 5)) warnings.push(`Hard to read: ${note.slice(0, 160)}`);

    return { label: label(reading.merchant ?? "", "Scanned receipt"), lines, adjustments, payable, computedPayable, reconciled, warnings };
  }
}
