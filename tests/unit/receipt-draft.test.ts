import { describe, expect, it } from "vitest";
import fixtures from "../../reference/AteAnne_Expected_Calculations.json";
import { RawReceiptReading, ReceiptDraftNormalizer } from "@/domain/receipt/ReceiptDraftNormalizer";
import { ReceiptReconciler } from "@/domain/receipt/ReceiptReconciler";

const base = (over: Partial<RawReceiptReading> = {}): RawReceiptReading => ({
  isReceipt: true,
  merchant: "Kusina",
  lines: [
    { label: "Sisig", quantity: 1, unitPrice: null, lineTotal: "600.00" },
    { label: "Rice", quantity: 3, unitPrice: "60.00", lineTotal: "180.00" },
  ],
  discounts: [],
  serviceCharge: null,
  otherCharges: [],
  totalDue: "780.00",
  unreadableNotes: [],
  ...over,
});

const n = new ReceiptDraftNormalizer();

describe("ReceiptDraftNormalizer", () => {
  it("parses exact centavos and reconciles a clean receipt", () => {
    const d = n.normalize(base());
    expect(d.lines.map((l) => [l.label, l.quantity, l.amount, l.unitPrice])).toEqual([
      ["Sisig", 1, 60000n, null],
      ["Rice", 3, 18000n, 6000n],
    ]);
    expect(d.payable).toBe(78000n);
    expect(d.reconciled).toBe(true);
    expect(d.warnings).toEqual([]);
  });

  it("pictured receipt: ex-VAT loyalty discount becomes the VAT-inclusive equivalent (592.63 → 663.75)", () => {
    const p = fixtures.pictured_receipt_reconciliation;
    const d = n.normalize(
      base({
        lines: [{ label: "Food items", quantity: 1, unitPrice: null, lineTotal: "4,425.00" }],
        discounts: [{ label: "Loyalty", amount: "592.63", base: "vat_exclusive" }],
        serviceCharge: "285.45",
        totalDue: "4,046.70",
      }),
    );
    const disc = d.adjustments.find((a) => a.kind === "DISCOUNT")!;
    expect(disc.amount).toBe(BigInt(p.effective_discount_on_gross_including_vat_centavos)); // 66375
    expect(d.payable).toBe(BigInt(p.total_due_centavos));
    expect(d.reconciled).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/PHP 592\.63.*PHP 663\.75/);
    // The editor's own reconciler agrees.
    const rec = new ReceiptReconciler().reconcile({
      id: "x",
      label: d.label,
      payerId: "m",
      payable: d.payable,
      lines: d.lines.map((l, i) => ({ id: `l${i}`, position: i, label: l.label, quantity: l.quantity, amount: l.amount, mode: "SHARED", claims: [] })),
      adjustments: d.adjustments.map((a, i) => ({ id: `a${i}`, position: i, kind: a.kind, label: a.label, amount: a.amount, eligibleLineIds: "ALL" })),
    });
    expect(rec.reconciled).toBe(true);
  });

  it("does not 'fix' a gap that a VAT gross-up can't explain; warns instead", () => {
    const d = n.normalize(base({ discounts: [{ label: "Promo", amount: "50.00", base: "unknown" }], totalDue: "600.00" }));
    expect(d.adjustments[0].amount).toBe(5000n);
    expect(d.reconciled).toBe(false);
    expect(d.warnings.join(" ")).toMatch(/come to more than the total by PHP 130\.00/);
  });

  it("drops malformed amounts with a warning, never guesses", () => {
    const d = n.normalize(base({ lines: [{ label: "Halo-halo", quantity: 2, unitPrice: null, lineTotal: "1O0.00" }, ...base().lines] }));
    expect(d.lines).toHaveLength(2);
    expect(d.warnings[0]).toMatch(/Halo-halo/);
  });

  it("missing total is computed and flagged; no lines flagged", () => {
    expect(n.normalize(base({ totalDue: null })).warnings[0]).toMatch(/No total/);
    expect(n.normalize(base({ lines: [], totalDue: "100.00" })).warnings.join(" ")).toMatch(/No items/);
  });

  it("service and other charges become adjustments; unreadable notes surface", () => {
    const d = n.normalize(base({ serviceCharge: "78.00", otherCharges: [{ label: "Corkage", amount: "100" }], totalDue: "958.00", unreadableNotes: ["second line smudged"] }));
    expect(d.adjustments.map((a) => [a.kind, a.amount])).toEqual([
      ["SERVICE", 7800n],
      ["CHARGE", 10000n],
    ]);
    expect(d.reconciled).toBe(true);
    expect(d.warnings).toEqual(["Hard to read: second line smudged"]);
  });
});
