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

  describe("cross-checks against printed quantity × unit price and the printed subtotal", () => {
    // The owner's real GOMA receipt (2026-07-20) exactly as the live reader returned it after cropping: one digit wrong (460 read as 450).
    const goma = (over: Partial<RawReceiptReading> = {}): RawReceiptReading => ({
      isReceipt: true,
      merchant: "GOMA",
      lines: [
        { label: "CRWDFVORITES", quantity: 1, unitPrice: "680.00", lineTotal: "680.00" },
        { label: "MAKI MIXER", quantity: 1, unitPrice: "680.00", lineTotal: "680.00" },
        { label: "TENDON", quantity: 1, unitPrice: "375.00", lineTotal: "375.00" },
        { label: "KATSUDON", quantity: 3, unitPrice: "395.00", lineTotal: "1,185.00" },
        { label: "CHIZCURRYDON", quantity: 2, unitPrice: "380.00", lineTotal: "760.00" },
        { label: "SPICYPORKUDON", quantity: 1, unitPrice: "450.00", lineTotal: "450.00" },
        { label: "MOCHI&MTCHACC", quantity: 1, unitPrice: "285.00", lineTotal: "285.00" },
      ],
      itemsSubtotal: "4,425.00",
      discounts: [{ label: "15% LOYALTY", amount: "592.63", base: "vat_exclusive" }],
      serviceCharge: "285.45",
      otherCharges: [],
      totalDue: "4,046.70",
      unreadableNotes: [],
      ...over,
    });

    it("real receipt: one look-alike digit is corrected, the discount is converted, and it reconciles", () => {
      const d = n.normalize(goma());
      const pork = d.lines.find((l) => l.label === "SPICYPORKUDON")!;
      expect(pork.amount).toBe(46000n);
      expect(pork.unitPrice).toBe(46000n);
      expect(d.adjustments.find((a) => a.kind === "DISCOUNT")!.amount).toBe(66375n);
      expect(d.payable).toBe(404670n);
      expect(d.reconciled).toBe(true);
      expect(d.warnings.join(" ")).toMatch(/SPICYPORKUDON.*PHP 450\.00.*PHP 460\.00/);
    });

    it("real receipt, second live reading: service charge (285.45 read as 265.45) and one item digit are both corrected", () => {
      const d = n.normalize(goma({ serviceCharge: "265.45" }));
      expect(d.adjustments.find((a) => a.kind === "SERVICE")!.amount).toBe(28545n);
      expect(d.adjustments.find((a) => a.kind === "DISCOUNT")!.amount).toBe(66375n);
      expect(d.lines.find((l) => l.label === "SPICYPORKUDON")!.amount).toBe(46000n);
      expect(d.reconciled).toBe(true);
      expect(d.warnings.join(" ")).toMatch(/service charge was read as PHP 265\.45; changed to PHP 285\.45/);
    });

    it("a misread amount can no longer hide inside the discount: only an exact 12% gross-up is accepted", () => {
      // Without a printed subtotal, 450 + 265.45 used to be absorbed by inflating the discount to 633.75.
      const d = n.normalize(goma({ serviceCharge: "265.45", itemsSubtotal: null }));
      expect(d.adjustments.find((a) => a.kind === "DISCOUNT")!.amount).toBe(59263n);
      expect(d.reconciled).toBe(false);
    });

    it("a correct reading is left alone", () => {
      const lines = goma().lines.map((l) => (l.label === "SPICYPORKUDON" ? { ...l, unitPrice: "460.00", lineTotal: "460.00" } : l));
      const d = n.normalize(goma({ lines }));
      expect(d.reconciled).toBe(true);
      expect(d.warnings.filter((w) => /was read as/.test(w))).toEqual([]);
    });

    it("quantity follows from line total ÷ unit price", () => {
      const lines = goma().lines.map((l) => (l.label === "KATSUDON" ? { ...l, quantity: 1 } : l));
      const d = n.normalize(goma({ lines }));
      expect(d.lines.find((l) => l.label === "KATSUDON")!.quantity).toBe(3);
    });

    it("a line total that disagrees with quantity × unit price is corrected when that makes the items add up", () => {
      const lines = goma().lines.map((l) => (l.label === "SPICYPORKUDON" ? { ...l, unitPrice: "460.00", lineTotal: "460.00" } : l.label === "MAKI MIXER" ? { ...l, lineTotal: "580.00" } : l));
      const d = n.normalize(goma({ lines }));
      expect(d.lines.find((l) => l.label === "MAKI MIXER")!.amount).toBe(68000n);
      expect(d.reconciled).toBe(true);
    });

    it("never guesses when more than one digit could explain the gap; says how far off the items are", () => {
      // 100 short: 375→475 is not a look-alike, but two lines could each hide a look-alike hundred (none here) → no unique fix.
      const lines = goma().lines.map((l) => (l.label === "SPICYPORKUDON" ? { ...l, unitPrice: "460.00", lineTotal: "460.00" } : l)).filter((l) => l.label !== "MOCHI&MTCHACC");
      const d = n.normalize(goma({ lines }));
      expect(d.reconciled).toBe(false);
      expect(d.lines.map((l) => l.amount)).toEqual([68000n, 68000n, 37500n, 118500n, 76000n, 46000n]);
      expect(d.adjustments.find((a) => a.kind === "DISCOUNT")!.amount).toBe(66375n); // discount still converted from the printed subtotal
      expect(d.warnings.join(" ")).toMatch(/add up to PHP 4,140\.00.*printed subtotal is PHP 4,425\.00.*short by PHP 285\.00/);
    });

    it("ambiguous look-alike: two lines could each explain the gap, so nothing is changed", () => {
      const d = n.normalize(
        base({
          lines: [
            { label: "A", quantity: 1, unitPrice: null, lineTotal: "150.00" },
            { label: "B", quantity: 1, unitPrice: null, lineTotal: "250.00" },
          ],
          itemsSubtotal: "410.00",
          totalDue: "410.00",
        }),
      );
      expect(d.lines.map((l) => l.amount)).toEqual([15000n, 25000n]);
      expect(d.reconciled).toBe(false);
    });

    it("a misread printed subtotal that disagrees with the total is ignored", () => {
      const d = n.normalize(goma({ itemsSubtotal: "4,420.00" }));
      expect(d.lines.find((l) => l.label === "SPICYPORKUDON")!.amount).toBe(45000n);
      expect(d.adjustments.find((a) => a.kind === "DISCOUNT")!.amount).toBe(59263n); // not converted on the strength of a wrong subtotal
      expect(d.reconciled).toBe(false);
    });
  });
});
