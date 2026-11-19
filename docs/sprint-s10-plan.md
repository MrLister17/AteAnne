# AteAnne Sprint S10 plan: mixed currencies, rate of the day bought

**Status: revision 2 (2026-11-19). The owner answered D58–D62; waiting for the go-ahead to build.**

- Baseline: `main` at `bb1993f` (v0.8.0, live).
- Proposed release: **v0.9.0**, decisions **D58–D62**, one additive migration.
- The money rules stay: integers only, no floats, the server recomputes everything, history is append-only.

### Owner's answers (2026-11-19)

| # | Answer | What it means for the design |
|---|---|---|
| D58 | **Mixed currencies in one event** | Each receipt has its own currency and purchase date. The event has one **settle-up currency** (default ₱) that totals and transfers use. |
| D59 | **"Your suggestion"** | My rules are in §4. |
| D60 | **Daily rate** | "Show totals in…" uses the latest daily ECB rate, marked ≈ and dated. |
| D61 | **Rate of the day the receipt was bought or paid for** | Each receipt is converted at its purchase-day rate. The frozen bill records that rate. |
| D62 | **ECB rates via Frankfurter** | Free, no key, daily history. Not available: VND, TWD, AED, SAR. |

---

## 0. The request, refined (revision 2)

> Add multi-currency support to AteAnne.
>
> 1. **Receipts in any currency.** Each receipt has the currency it was printed in and the day it was bought; a scan fills both in when they're printed. One trip can mix ₱ airport snacks with ฿ Bangkok dinners.
> 2. **One settle-up currency per event** (default ₱). Every receipt in another currency is converted at the official rate **for the day it was bought**. Everyone's share, balance and transfer is in the settle-up currency. Each receipt shows both amounts and the rate used, and the frozen bill keeps them.
> 3. **See totals another way.** Anyone can switch their own totals to another currency used in the event, or to pesos, at the daily rate. These amounts are marked "≈" and dated. Typing always stays in the receipt's own currency.
> 4. **Pay in the currency you choose.** Transfers are in the settle-up currency. A payer may send another currency the receiver accepts. That conversion uses the rate on the day the money is sent, because no receipt day applies to a transfer. The rate is locked into the payment so both people see it.
> 5. **Corrections and history.** Changing currencies follows the D59 rules (§4) and never rewrites a frozen bill or a confirmed payment. Peso-only events work exactly as they do today.

---

## 1. Baseline (unchanged from revision 1)

The money engine works on plain `bigint` integers and doesn't care which currency they are, so the splitting rules themselves don't change. Pesos are hard-coded only around it:

- `Money.parsePesos` and `toString`.
- About 110 `php()`/₱ calls across 14 UI files.
- `MoneyInput`'s ₱ prefix.
- The scanner prompt ("in pesos") and the Philippine 12% VAT fix.
- Export column names.

No currency field exists. This container's proxy blocks `api.frankfurter.dev`, so tests use a fake rate source and the live fetch is checked after deploy.

---

## 2. Worked example (made-up rates, for illustration only)

Bangkok trip, settle up in **₱**. Two people: **Mark** (organizer, joined first) and **Ana**.

| Receipt | Bought | Paid by | Amount | Rate (that day) | In ₱ | Mark | Ana |
|---|---|---|---|---|---|---|---|
| Airport snacks | 17 Nov | Ana | ₱600.00 | n/a | ₱600.00 | ₱300.00 | ₱300.00 |
| Breakfast (equal) | 18 Nov | Mark | ฿1,397.00 | 1 THB = 1.6250 PHP | ₱2,270.13 | ₱1,135.07 | ₱1,135.06 |

- **Breakfast is converted once, then split.** ฿1,397.00 × 1.6250 = 2,270.125, rounded half-up to ₱2,270.13. That total is split by the baht shares (฿698.50 each) using the existing largest-remainder rule. Mark gets the extra centavo because ties go to join order, so the receipt adds up exactly.
- **Ana's balance:** −1,135.06 + 600.00 − 300.00 = **Ana pays Mark ₱835.06**.
- **Paying in pesos:** Ana sends ₱835.06 and no conversion is needed.
- **Paying in baht** (Mark accepts baht), on a day when 1 THB = 1.6300 PHP: ₱835.06 ÷ 1.6300 = 512.307, rounded to **send ฿512.31**. That clears the full ₱835.06.

---

## 3. Screens and copy

- **Start a hatian:** *Receipts can be in any currency.* · **Settle up in · ₱ Philippine peso ›**
- **Receipt editor:**
  - Next to the total: a **฿ THB ▾** chip and **Bought 18 Nov ▾**.
  - Defaults: your last receipt's currency in this event and today's date (Manila). A scan fills in the printed currency and date for the person to check.
  - When the receipt's currency differs from the settle-up currency, a line under the total reads **= ₱2,270.13 · 1 THB = 1.6250 PHP (ECB, 18 Nov)**.
  - For a receipt bought today: *Today's rate comes out tonight. Showing 17 Nov's for now.*
- **Receipt list and Claim:** *Breakfast · Mark paid ฿1,397.00 (₱2,270.13)* · **Your share ฿698.50 (₱1,135.06)**.
- **Totals switch** (D60, shown only when the event uses more than one currency or settles in a currency other than ₱):
  - A header chip **₱ ▾** opens *Show totals in: (•) ₱ Pesos, the settle-up currency · ( ) ฿ Baht (≈ today's rate)*.
  - Totals then read **≈ ฿512.31**, with the dated rate shown underneath. Inputs never change currency.
- **Pay (Ana):** **Pay Mark ₱835.06** · *Pay in* **[₱ Pesos] [฿ Baht]**, showing only the currencies Mark accepts.
  - Choosing baht shows: *At today's rate 1 THB = 1.6300 PHP (ECB, 25 Nov) · Send ฿512.31* · **[I sent ฿512.31]**. The amount is editable for partial payments.
- **Receive (Mark):** **Did ฿512.31 from Ana arrive?** · *for ₱835.06 at 1.6300 (25 Nov)* · **[Yes, I got it]** / **It didn't arrive**.
- **How I want to be paid:** a new row, **I accept: ☑ Pesos ☑ Baht**. The defaults are the settle-up currency and each receipt currency in the event.
- **Peso-only events:** the screens look exactly as they do today.

---

## 4. D59: who can change currencies, and when (my suggestion)

1. **A receipt's currency and purchase date** are part of the receipt, so they follow today's receipt-editing rules.
   - **During Add & claim:** whoever can edit the receipt can change them. Because this counts as an edit, people re-check the receipt, as with any edit today.
   - **After the bill freezes:** only through **Correct the bill**, which already keeps confirmed payments and turns overpayments into return transfers. This is how you fix a receipt that was typed as ₱ but was really ฿.
2. **The settle-up currency** belongs to the organizer.
   - **During Add & claim:** the organizer can change it freely.
   - **After the bill freezes:** only through **Correct the bill**, and only while **nobody has reported a payment in any statement**. Confirmed payments are recorded in this currency, so changing it later would change what people confirmed.
3. **Done events stay read-only.** The totals switch still works on them.
4. **Every change is audited.** Everyone sees a notice such as *Totals are now in baht* or *Breakfast is now in baht*.

---

## 5. Money rules (new section in `financial-rules.md`)

1. **Minor units per currency.** PHP, THB, USD and SGD use 2 decimals. JPY, KRW and IDR use 0 (IDR as whole rupiah). The existing `*Centavos` columns mean "minor units of that row's currency"; they are documented, not renamed. The bound stays at 100,000,000 minor units.
2. **Exact rates.** ECB publishes rates per euro. A cross rate is (quote per EUR) ÷ (base per EUR), computed with `Fraction` and **rounded half-up to 8 significant digits**. That rounded number is stored, shown and used.
3. **"The rate for day D"** is the ECB rate dated D. If none is published yet, or D is a weekend or holiday, the latest earlier one applies. A rate more than 7 days older than D counts as unavailable, and the app never guesses. ECB publishes at about 16:00 CET, which is around 22:00–23:00 in Manila.
4. **Receipt conversion (D61):**
   - Compute the receipt's shares exactly as today, in its own currency.
   - Convert the payable total once: `payable × rate`, adjusted for the two exponents and rounded half-up.
   - Split that total by the original shares with `LargestRemainderAllocator` (ties by join order).
   - The payer's funding is the converted total, so every receipt still sums exactly.
   - When the receipt is already in the settle-up currency, the rate is 1 and the numbers are unchanged. A unit test proves this identity, so every existing fixture keeps passing.
5. **When rates become final.** Rates are fixed at the **freeze**, the moment the bill becomes official, as today. Until then, receipts show the rate they would use right now. The frozen bill records each receipt's currency, date, rate and converted amounts (policy `ateanne-allocation-v3`, used only when an event has converted receipts).
6. **Freezing needs a rate for every converted receipt.** If one is missing, the freeze waits. The Next card says *Waiting for the 19 Nov exchange rate. It usually comes out tonight.*, and the D53 "never an empty wait" test is extended to cover it.
7. **Rates are fetched outside the event lock (D57).** They are fetched when a receipt is saved and once a day by the existing 03:17 Manila job. The freeze reads rates from the database only.
8. **Paying in another currency (§0.4):**
   - The rate is the one for the day the money is sent, locked into the payment.
   - Full payment: the amount to send = convert(capacity), and the credit = capacity exactly.
   - Partial payment: the credit = half-up(sent ÷ rate). Sending at least the full amount gives credit = capacity.
   - The ledger counts only settle-up-currency credits, so `PaymentLedger`, disputes, reversals and the D47 carry-forward are unchanged.
   - The server recomputes everything and answers 409 `rate_changed` if the rate moved after the sheet opened.
   - A replacement after a dispute must reuse the same currency, amount and rate.

---

## 6. Data model (one additive migration)

| Table | New fields | Notes |
|---|---|---|
| `Event` | `currency` (Char 3, default PHP) | The settle-up currency. |
| `Receipt` | `currency` (default PHP), `purchasedOn` (Date, nullable) | `purchasedOn` null = the receipt's creation date in Manila. |
| `PaymentInstruction` | `acceptedCurrencies String[]` | Empty = the defaults in §3. |
| `PaymentReport` | `paidCurrency`, `paidMinor`, `rateValue`, `rateScale`, `rateDate`, `rateSource` | All null for normal payments. A check constraint requires all null or all set. |
| `ExchangeRate` (new) | `source`, `date`, `currency`, `perEurValue`, `perEurScale`, `fetchedAt` | Daily cache, keyed by (source, date, currency). RLS enabled. `database-security.test.ts` already enforces RLS on every table. |

- **Snapshot facts** (JSON, no migration) gain the currency, rate and converted amount for each receipt.
- **Old rows** read as ₱, bought on their creation day, paid in the settle-up currency. No backfill is needed.

---

## 7. Code changes by layer

### Domain (pure, unit-tested)

- `money/Currency.ts`: the supported currencies, `parse` and `format`.
- `fx/ExchangeRate.ts`: the exact cross rate and `convert`.
- `receipt/ReceiptConverter.ts`: rule 5.4.
- `payments/ForeignPayment.ts`: rule 5.8.
- `EventLedger` takes converted receipts.
- `AutoAdvance.freezeGate` adds the rate check; `NextAction` adds the system wait.
- `ReceiptDraftNormalizer` applies the VAT fix only to ₱ receipts.
- The `PaymentLedger` message becomes currency-neutral.

### Server

- `fx/RateProvider.ts`:
  - `EcbRateProvider` (Frankfurter, 5 s timeout, one retry).
  - `FakeRateProvider` (`FX_RATES_FAKE=1`, ignored on Vercel production).
- `RateService`: reads the cache, fetches outside any lock, and gets daily warm-up from `CleanupService`.
- `ReceiptService`: saves currency and date, prefetching the rate before the lock.
- `EventService`:
  - `currency` on create.
  - `setCurrency` (organizer, `ctx.actor()`, §4 rules).
  - Freeze writes the v3 facts.
- `PaymentService`:
  - `report` gains currency, amount and rate date.
  - Idempotent replay compares them too.
  - `setInstructions` gains `acceptedCurrencies`.
- Routes:
  - `GET /api/events/:id/rates` (members only, rate-limited, `no-store`).
  - `POST /api/events/:id/currency`.
- `EventViewBuilder` exposes the new fields and converted estimates.
- Scanner prompt and normalizer read the printed currency and date.
- Exports add currency, date, rate and converted columns; `amount_php` becomes `amount` + `currency`.
- `/api/health` reports the newest cached rate date.

### UI

- **Formatter:** a `useMoney()` hook replaces about 110 `php()`/₱ call sites. This is the biggest, most mechanical part.
- **MoneyInput:** gets a `currency` prop (symbol; no decimals for 0-decimal currencies).
- **Screens:**
  - Currency and date chips in `ReceiptEditor`.
  - Two-currency lines in `ReceiptsTab` and `ClaimTab`.
  - The settle-up row on /new and in Event settings.
  - The totals-switch chip and sheet (saved per person per event in `localStorage`, wrapped in try/catch).
  - Pay-in and receive lines plus "I accept" in `SettlementSection`.
  - `PersonScreen`, `NextCard`, `next.ts` and `reminders.ts` move to the hook.
- **Mobile rules:** inputs at least 16px, targets at least 44px, checked at 360px.

### Build order

1. Domain classes and unit tests.
2. Migration, rate source and cache.
3. Receipt currency and date (editor, scan, conversion, freeze, Next card).
4. Settle-up currency and the formatter rollout.
5. Totals switch.
6. Paying in another currency.
7. E2E tests, docs and the full chain.

---

## 8. Tests and verification

- **Unit:**
  - Parse and format for 2- and 0-decimal currencies.
  - Cross rates and rounding against the §2 fixtures.
  - `ReceiptConverter` conservation and the rate-1 identity, run across the existing 2,500 generated cases.
  - `ForeignPayment` (full payment exact, partial, snap to capacity, tiny amounts rejected).
  - Freeze gate waits for a missing rate; `NextAction` covers the new wait.
  - No VAT fix for ฿.
- **Integration (PostgreSQL):**
  - A mixed ₱/฿ event through to the freeze, with the rates stored in the facts.
  - §4 change rules (who, when, after a report, through a correction, audit).
  - A missing rate blocks the freeze until it is cached.
  - Paying in baht, `rate_changed`, idempotent replay.
  - A mix of payments settling to zero and reaching Done.
  - Correction carry-forward.
  - Export columns.
  - Rate source down.
  - Every existing suite passing unchanged (peso events unaffected).
- **E2E (iPhone 15 and 360px):** a new `currency.spec.ts`:
  - A ₱ receipt and a ฿ receipt, both lines shown, claim.
  - Automatic freeze with rates.
  - Totals switch to ฿.
  - Pay in ฿; the receiver sees the amount and rate; confirm; Done.
  - A peso-only event shows no chips.
- **Full chain** from CLAUDE.md, with real results in `test-report.md`.
- **Not checkable from here:** a live ECB fetch (the host is blocked in this container). It gets checked through `/api/health` after deploy. Real-iPhone use still needs a person.

## 9. Release and rollback

- **Release:** v0.9.0 with migration `…_currencies`. Docs to update: `decisions.md` (D58–D62), `financial-rules.md`, `GUIDE.md`, `architecture.md`, `handoff.md`, `CHANGELOG.md`, `test-report.md`.
- **Rollback:** the migration only adds fields, so it is safe to leave in place. Once any non-₱ receipt exists, though, v0.8.0 would show those amounts as ₱ without converting them. From that point, use forward fixes only.

## 10. Not in this sprint

- VND, TWD, AED and SAR (they need a second rate source).
- Several payers on one receipt.
- Sending money through the app.
