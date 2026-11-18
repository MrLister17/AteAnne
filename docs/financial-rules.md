# Financial rules (as implemented)

All money is integer **centavos** (`bigint`). JSON carries decimal strings (`"12550"` = PHP 125.50). There is no floating point anywhere in money paths.

## Definitions

- **Fᵢ, funding**: what person *i* paid to merchants (sum of payable totals of receipts where *i* is the confirmed payer).
- **Cᵢ, cost**: *i*'s item shares − discounts + charges.
- **Nᵢ = Fᵢ − Cᵢ**: positive = *net to receive*, negative = *net to pay*. A positive net is reimbursement, not income.
- **Rᵢ = Nᵢ + confirmed outbound − confirmed inbound**: remaining balance. Pending, rejected and cancelled reports have no effect. A reversal cancels exactly one confirmation.

## Largest-remainder allocation (`LargestRemainderAllocator`)

For a total *A* and non-negative weights *w*, in stable order:

1. exact share = *A × wᵢ / Σw* (a `Fraction`)
2. floor to centavos
3. give the leftover centavos to the largest fractional remainders; ties go to the earlier entry in stable order (join sequence for people, position for lines)

The sum always equals *A*, and a zero weight always gets zero. A positive *A* with zero basis is an **error**, never a silent equal split.

| Fixture | Result |
| --- | --- |
| PHP 1.00 ÷ 3 | 34 / 33 / 33 centavos |
| 1 centavo ÷ 3 | 1 / 0 / 0 |
| 101 by ½, ⅓, ⅙ | 50 / 34 / 17 |

## Receipt order of operations (`ReceiptCalculator`)

1. **Reconcile first** (`ReceiptReconciler`): Σ lines − Σ discounts + Σ charges must equal the payable total. A discount cannot exceed its eligible lines. A positive charge needs eligible lines worth more than zero.
2. **Lines.** Shared: weight 1 per consumer. By piece: weight = units claimed, and Σ units must equal the quantity. Only claims for the *current* receipt version count.
3. **Discounts**, in entered order: split across eligible lines by remaining line value, then within each line across its consumers by remaining share. Largest remainder at both levels.
4. **Service**, then **other charges**: proportional to each person's post-discount spending on the charge's eligible lines. Charges never compound on charges.
5. **Invariant checks**: no negative share, and Σ shares = payable (otherwise the code throws an internal error).

### Worked example (synthetic): Mark paid; Juan skipped the rice

Shared dishes PHP 1,800 ÷ 9; rice PHP 180 shared by 8 (not Juan); solo meals; service PHP 478 on PHP 4,780 of items. Juan's service = 478 × 450 / 4,780 = **PHP 45.00**. Their total is PHP 495.00 and Mark's net is +PHP 4,628.25. Every figure is asserted in `tests/unit/fixtures.test.ts`.

### Pictured receipt (totals only)

Gross PHP 4,425.00. The printed PHP 592.63 discount is on an ex-VAT base, so it is entered as the **equivalent gross reduction of PHP 663.75**. Service is the printed PHP 285.45. Total PHP 4,046.70. The included VAT (PHP 402.99) is not added again, and the card-payment line is not an adjustment. No diners or allocations are inferred from the photo.

## Netting (`SettlementPlanner`)

Debtors and creditors are sorted by stable order. Each step sends min(debt, credit) and advances whichever side reaches zero. This is deterministic and settles every net, but it does **not** promise the minimum number of transfers. Edges settle the event as a whole; they are never labelled as payment for a particular dish. Receipt statements are kept separately in the snapshot facts.

## Settlement (`PaymentLedger`)

Per edge: `verified` = confirmed and not reversed; `pending` = reported; `outstanding` = amount − verified; `capacity` = outstanding − pending. A new report must be > 0 and ≤ capacity, and is blocked while the edge has an open dispute (except the agreed replacement). **Done** requires every edge to have outstanding = 0, pending = 0 and no open dispute.

## Whole-receipt equal policy (D45)

Item-by-item allocation remains the default. When a receipt explicitly proposes equal sharing, all roster members accept their own full receipt share; missing/declined answers block review. The reconciler still validates discounts/scopes and positive charge bases. The equal policy uses cumulative uniform component allocations and differences between them so every line/adjustment conserves centavos while each person’s final receipt share equals payable ÷ roster size (±1 centavo). This policy deliberately distributes rounding across components instead of repeatedly awarding every line’s extra centavo to the first person. Frozen facts retain the equal policy and `ateanne-allocation-v2` policy identifier; earlier snapshots retain their original policy.

## Post-report corrections (D47)

Before Done, organizer may start a reasoned correction only when no report is pending and no dispute is open. Original snapshot facts, shares, edges, reports and reversals remain unchanged; only its status becomes superseded. The roster stays locked. Since v0.7 the event goes back to Add & claim (Collecting), where receipts and claims can be corrected; the organizer then freezes the corrected bill by hand (it never re-freezes automatically). There is no approval round (D50).

For each person, new remaining net = corrected merchant funding − corrected consumption + **all non-reversed receiver-confirmed outgoing repayments across all statements** − confirmed incoming repayments. New deterministic edges settle these residuals. Thus a prior overpayment becomes a return transfer, never a fake reversal/refund or erased payment. New reports belong only to the active statement; old statements cannot receive or alter payments after superseding. Correct mistaken confirmations before starting correction. Done also checks zero remaining nets. Done events cannot reopen.
