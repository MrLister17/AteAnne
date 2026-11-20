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

## Currencies (D58–D62, v0.9)

- **Minor units.** Every amount is a `bigint` of its currency's smallest unit: centavos, satang, cents; whole yen, won and rupiah (`src/domain/money/Currency.ts`). Database columns named `*Centavos` hold minor units of the row's currency. The bound stays 100,000,000 minor units per receipt, line and adjustment.
- **Exact rates.** The ECB publishes units per euro. A cross rate "1 A = r B" is (B per EUR) ÷ (A per EUR), computed exactly with `Fraction`, then rounded half-up to **8 significant digits** (`ExchangeRate.fromPerEur`). Only that rounded rate is stored and used.
- **Converting** = one multiplication by the rate, adjusted for the two exponents, then half-up to the minor unit (`ExchangeRate.convert`).
- **Receipt in another currency** (`ReceiptConverter`): calculate the receipt exactly as before in its own currency; convert its payable once at the rate of the day it was bought; split that converted payable by everyone's own-currency shares with the largest-remainder rule (ties in join order). Σ converted shares = converted payable = the payer's funding, so Σ funding = Σ cost and Σ net = 0 still hold. With no conversion the result is identical to before (the identity is unit-tested on 600 generated receipts).
- **Rate day.** The ECB rate dated the purchase day, or the latest before it (weekends, holidays, not yet published). Older than 7 days → unavailable: the receipt shows "Waiting for the … exchange rate" and the freeze waits. Rates are fixed when the bill freezes and recorded in the snapshot facts (policy `ateanne-allocation-v3`).

### Worked example (synthetic; fake rates PHP 65 / THB 40 per euro)

| Receipt | Bought | Paid by | Amount | Rate | Settle-up (₱) | Mark | Ana |
|---|---|---|---|---|---|---|---|
| Airport snacks | today | Ana | PHP 600.00 | — | 600.00 | 300.00 | 300.00 |
| Breakfast (equal) | yesterday | Mark | THB 1,397.00 | 1 THB = 1.625 PHP | 2,270.13 (2,270.125 half-up) | 1,135.07 | 1,135.06 |

Ana's net = −1,135.06 + 600.00 − 300.00 = **−835.06**: one transfer, Ana → Mark PHP 835.06 (`tests/unit/currency.test.ts`, `tests/integration/currency.test.ts`).

### Paying in another currency (`ForeignPayment`)

The transfer stays in the settle-up currency. The rate "1 sent-currency = r settle-up" is the one for the day the money is sent and is locked into the payment record.

- **Full:** send `convertBack(capacity)` (half-up); the credit is exactly the capacity. Example at 1 THB = 1.63 PHP: PHP 835.06 → send **THB 512.31**.
- **Partial:** credit = `convert(sent)`, half-up, capped at the capacity; sending more than the full amount is refused (`over_report`); a credit that rounds to 0 is refused. Paying in parts can differ from paying at once by one minor unit per part.
- The server re-derives the rate from its cache and the credit from the amount sent, and refuses a mismatch (409 `rate_changed`). Only the credit enters `PaymentLedger`, so verification, disputes, reversals, Done and the D47 carry-forward are unchanged. An agreed replacement must be the same currency and reuses the rejected payment's rate.

### Changing currencies (D59)

A receipt's currency/date can change during Add & claim (an ordinary edit) or through Correct the bill. The settle-up currency can change only during Add & claim and only while no payment has been reported in any statement. Changing either relabels: typed numbers are never converted.

## Running event payments and credit (D64, v0.10)

- A **cash report** records money one member already handed another, at any time during Add & claim or Pay. It has no cap. Only the recipient's confirmation makes it count; reported, rejected and cancelled reports, and undone confirmations, have no effect.
- **Every effective transfer is applied to raw receipt nets**, never to an already-adjusted balance: settlement-edge reports from every statement plus confirmed cash (`confirmedTransfers`). Σ remaining = 0 always.

```text
expenseNet = paid to merchants − allocated share        (frozen statement, or live split; pending while it can't calculate)
paymentNet = confirmed money sent − confirmed money received
remaining  = expenseNet + paymentNet
credit     = max(0, max(0, remaining) − max(0, expenseNet))
```

**Example (synthetic, THB event).** Sam owes THB 1,734.48 and Maya is due THB 6,353.56. Sam hands Maya THB 2,000.00 and Maya confirms. Sam's remaining becomes +265.52, all of it credit; Maya's becomes 4,353.56. If Sam later shares THB 100.00 of a receipt Tess paid, his credit drops to 165.52.

- **At the freeze**, the residual positions are planned with `SettlementPlanner`. Each confirmed transfer is recorded once in `facts.carriedPayments`, with `source` and `reportId`. A correction rebuilds from raw nets plus all effective transfers, so cash is never counted twice.
- **During Pay**, confirming cash (or undoing a confirmation) supersedes the active statement. The new statement copies its receipt facts, shares and locked rates, then plans the residual transfers again, all in one transaction. Example: after the freeze above, Tess hands Maya THB 5,000.00 against her THB 4,353.56 transfer. The new plan is Maya → Sam THB 265.52 and Maya → Tess THB 380.92.
- **Another currency:** credit = convert(amount handed over) at today's locked ECB rate, half-up. There is no cap.
