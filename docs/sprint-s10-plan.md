# AteAnne Sprint S10 plan: bill currency, peso view, pay in another currency

**Status: draft, waiting for the owner's approval. Nothing is implemented yet.**
Baseline: `main` at `bb1993f` (v0.8.0, live). Proposed release: **v0.9.0**, decisions **D58–D62**. One additive migration. The money rules stay as they are: amounts are integers, there are no floats, the server recomputes everything, and history is append-only.

---

## 0. Your request, refined

> Add multi-currency support to AteAnne.
>
> 1. **Bill currency per event.** When starting a hatian, the organizer picks the currency the receipts are in. The default is ₱ PHP; ฿ THB would suit a Bangkok trip. Receipts, claims, shares and transfers are all in that currency. The organizer can change the currency of a current event, or fix one that was entered under the wrong currency. A change only swaps the label: the numbers people typed stay as they are and are never converted. It must not rewrite a frozen statement or a confirmed payment.
> 2. **See it in pesos.** Anyone can switch their own screen between the bill currency and pesos, on current and finished events. Converted amounts are marked "≈" and show the rate used and its date. Typing always stays in the bill currency.
> 3. **Pay in the currency you choose.** On Pay, the payer chooses which currency to send, from the ones the receiver accepts. If it isn't the bill currency, the app converts using the official reference rate for the day of the payment. It shows the exact amount to send and saves that rate and date with the payment, so both people see the same numbers. The receiver confirms the amount that was actually sent. Paying the full amount always clears the transfer exactly.
>
> Rules: money stays `bigint` minor units with no floats. Rates are exact decimals. The server fetches rates and recomputes every amount; it never trusts the phone's numbers. Existing peso events look and behave exactly as they do today. Run the full test chain and update the docs.

---

## 1. Baseline: what the code does today

- **The good news:** the money engine doesn't care about currency. `LargestRemainderAllocator`, `ReceiptCalculator`, `SettlementPlanner`, `PaymentLedger` and `CorrectionLedger` all work on plain `bigint` integers. The same math works for satang (฿0.01) or yen, so no money rule has to change.
- **Pesos are hard-coded around that engine:**
  - `Money.parsePesos()` strips ₱/PHP. `Money.toString()` prints "PHP …", and the bound message says "PHP 1,000,000.00".
  - `src/ui/format.ts` (`php`, `phpAbs`, `pesos`, `toCentavos`, `toInput`) is called about **110 times across 14 UI files**. ReceiptEditor, SettlementSection, MoneyTab, PersonScreen, NextCard, next.ts and reminders.ts use it the most.
  - The `MoneyInput` box always shows a "₱" prefix (`ui.tsx:160`).
  - The scanner prompt says receipts are "mostly from the Philippines, in pesos". `ReceiptDraftNormalizer` applies a Philippine-only 12% VAT-discount fix.
  - Exports name their columns `amount_php`, `amountPhp` and so on. `PaymentLedger`'s error text says "PHP".
- **No currency field exists anywhere** (`prisma/schema.prisma`). A `PaymentReport` holds a single `amountCentavos`.
- **Network:** rates have to come from the server. The CSP keeps `connect-src 'self'`, so phones never call a third party. This container's proxy blocks `api.frankfurter.dev` (403). Tests will use a fake rate source, and the live fetch can only be checked after deployment (see §8).

---

## 2. Decisions for you

| # | Question | My recommendation | Alternatives |
|---|---|---|---|
| **D58** | How many currencies can one event have? | **One "bill currency" per event**, chosen on the Start screen, defaulting to ₱. | Each receipt has its own currency, converted into one bill currency, so a trip can mix airport ₱ receipts with Bangkok ฿ receipts. This touches the receipt math and the freeze; I'd do it next sprint. Workaround for now: a separate event for ₱ costs. |
| **D59** | When can the organizer change the bill currency? | **Freely during Add & claim. After the bill freezes, only through Correct the bill, and only if nobody has reported a payment yet. Never after Done.** A change swaps the label only; the numbers stay as typed. It is audited. | Allow a change at any time before Done, with a reason. The risk: a payment already confirmed as "₱400" would quietly become "฿400". |
| **D60** | Which rate does "See it in pesos" use? | **The latest ECB reference rate**, marked "≈" with its date. It applies to read-only amounts only. It is a per-person switch that works on current and Done events. | Use the rate on the day the bill froze, so a finished trip's numbers never move. Events are deleted after 30 days, so the difference is small. |
| **D61** | Which day's rate converts a payment? | **The day the payer taps "I sent".** The rate is locked into that payment and both people see it. This matches your "rate for that day". | (b) The receipt's day: matches what the payer's card charged in pesos, but needs a date on every receipt. (c) The freeze day, for everyone: nobody gains by paying early or late. |
| **D62** | Where do rates come from? | **ECB reference rates via Frankfurter**: free, no key, daily history, the same number for everyone. Covers THB, JPY, KRW, SGD, HKD, MYR, IDR, CNY, USD, EUR, AUD, GBP and others. Bank and GCash fees are paid by the sender. | The BSP reference rate is the official Philippine rate, but it has no API. A free aggregated API also covers **VND, TWD, AED and SAR**, but it's less authoritative. A paid API is the third option. |

Small questions:
- Should **pesos be the only view currency**? I recommend yes for v1.
- Do you have a current event that was entered in baht but shows ₱? If it isn't Done yet, D59 lets you fix it through Correct the bill, as long as nobody has reported a payment.

---

## 3. Screens and copy

Example: a Bangkok trip with the bill in **฿**. **Breakfast** cost ฿1,397.00, split equally and paid by **Mark**, so **Ana** owes ฿698.50. *Example rate (made up for illustration): 1 THB = 1.6250 PHP.*

**Start a hatian:** a new row, **Currency · ₱ Philippine peso ›**. It opens a list with the common travel currencies first (฿ Thai baht, ¥ Japanese yen, ₩ Korean won, S$ Singapore dollar, …). The join screen says *This bill is in Thai baht (฿).*

**Header chip** (shown only when the bill isn't in ₱): **฿ THB ▾** opens:
```
Show amounts in
(•) Thai baht — the bill
( ) Philippine pesos (≈ today's rate)
1 THB = 1.6250 PHP · ECB, 18 Nov
```
In peso view, amounts read **≈ ₱1,135.06**. Key places (the balance banner, the Pay card and the big-text screen) also show **฿698.50** small underneath. Receipt and claim inputs stay in ฿. If no rate is available: *Today's rate isn't available. Showing baht.*

**Event settings → Bill currency** (organizer):
- During Add & claim: a picker with the note *Amounts keep the numbers you typed. Only the currency changes.*
- After the bill freezes: *Locked. To change it, use Correct the bill (only before anyone reports a payment).*

**Pay (Ana):**
```
Pay Mark ฿698.50
Pay in   [ ฿ Baht ] [ ₱ Pesos ]          ← only currencies Mark accepts
At today's rate: 1 THB = 1.6250 PHP (ECB, 18 Nov)
Send ₱1,135.06
[ I sent ₱1,135.06 ]                     ← amount editable, in ₱
  Covers ฿698.50 · How is this worked out?
```
Partial payment: Ana types ₱500, which covers **฿307.69**. Afterwards: **Sent ₱500 · Waiting for Mark** · *฿390.81 left* (≈ ₱635.07 today). Paying in parts can come to ₱0.01 more or less than paying at once.

**Receive (Mark):** **Did ₱1,135.06 from Ana arrive?** · *for ฿698.50 · 1 THB = 1.6250 PHP, ECB 18 Nov* · **[Yes, I got it]** / **It didn't arrive** (same flow as today).

**How I want to be paid** (receiver): a new row, **I accept: ☑ Baht ☑ Pesos**. The default is the bill currency plus pesos, and at least one must stay ticked.

**Big-text screen:** shows ฿698.50 big with ≈ ₱1,135.06 under it, in English and Tagalog. **Copy reminder** writes amounts in the bill currency, adding "(≈ ₱… today)".

**₱ events:** nothing changes. There is no chip and no "Pay in" row, unless a receiver opts in to accepting another currency.

---

## 4. Money rules (new section in `financial-rules.md`)

1. **Minor units.** Each currency has an exponent: PHP, THB, USD, SGD and similar have 2 decimals; JPY, KRW and IDR have 0 (IDR is treated as whole rupiah, which is how prices are written). Money stays `bigint`. Existing `*Centavos` columns mean "minor units of the event's currency"; they are documented rather than renamed. The bound stays at 100,000,000 minor units per receipt, line and adjustment.
2. **Rates are exact decimals.** ECB publishes rates per euro. A cross rate is (quote per EUR) ÷ (base per EUR), computed with `Fraction` and then **rounded half-up to 8 significant digits**. The rounded rate is the one stored, shown ("How is this worked out?") and used, so anyone can recheck it by hand.
3. **"The rate for that day"** is the latest ECB rate published on or before that day in Manila. ECB publishes each business day at about 16:00 CET, which is about 23:00 in Manila. On weekends and holidays the earlier rate applies, with its date shown. A rate older than 5 days counts as unavailable. The app never guesses.
4. **Converting** means one multiplication, adjusted for the two exponents, then **half-up to the minor unit**. This is the same rounding as `EntryMath`.
5. **The ledger always works in the bill currency.** A foreign payment stores what was sent (currency and amount), the locked rate (value, date and source), and the **bill-currency credit**. The credit is what `PaymentLedger` counts. Capacity, Done, disputes, reversals and the D47 correction carry-forward stay exactly as they are.
6. **Full payment:** the amount to send = convert(capacity), and the credit = capacity exactly.
   **Partial payment:** the credit = half-up(paid ÷ rate). If the amount paid is at least the full-payment amount, the credit = capacity. A payment can't exceed capacity, and a credit must be above 0.
7. **The server decides.** The phone sends the chosen currency, the amount and the rate date it showed. The server fetches the rate **before** taking the event lock (the D57 rule: no outside calls or second connection while the lock is held). It recomputes both the amount and the credit. If the rate changed in between, it answers 409 `rate_changed` with the new figures.
8. **Replacement after a dispute** is the same money. It must use the same currency, amount and rate as the rejected payment.

---

## 5. Data model (one additive migration)

```prisma
model Event          { currency String @default("PHP") @db.Char(3) }
model PaymentInstruction { acceptedCurrencies String[] @default([]) } // [] = bill currency + PHP
model PaymentReport {
  // amountCentavos = credit in the bill currency (unchanged meaning for old rows)
  paidCurrency String?   @db.Char(3)   // null = paid in the bill currency
  paidMinor    BigInt?
  rateValue    BigInt?                 // rate = rateValue / 10^rateScale
  rateScale    Int?
  rateDate     DateTime? @db.Date
  rateSource   String?   @db.VarChar(20)
}
/// Daily rate cache (per EUR, as published). RLS on, like every table.
model ExchangeRate {
  source String; date DateTime @db.Date; currency String @db.Char(3)
  perEurValue BigInt; perEurScale Int; fetchedAt DateTime @default(now())
  @@id([source, date, currency])
}
```
- A check constraint requires the foreign-payment columns to be either all null or all set.
- New snapshots record `currency` in `facts` (JSON, no migration needed). Older snapshots without it are ₱.
- Audit entries: `event.currency_changed {from, to, reason?}` and `payment.reported` with the currency details.
- `database-security.test.ts` already fails if a new table lacks RLS.

---

## 6. Code changes by layer

**Domain (pure, unit-tested)**
- `src/domain/money/Currency.ts`: the supported list (code, symbol, name, exponent), `parse(input, ccy)` and `format(minor, ccy)`. `Money.parsePesos` stays as a PHP wrapper.
- `src/domain/fx/ExchangeRate.ts`: exact rate value object, cross rate from per-EUR quotes, `convert()`.
- `src/domain/payments/ForeignPayment.ts`: `quote(capacity, rate)` and `creditFor(paid, capacity, rate)`, implementing rules 4.4–4.6.
- `PaymentLedger` keeps its logic; only its message becomes currency-neutral. `ReceiptDraftNormalizer` applies the VAT fix only to ₱ events.

**Server**
- `src/server/fx/RateProvider.ts`: `EcbRateProvider` (Frankfurter, 5 s timeout, one retry) and `FakeRateProvider` (`FX_RATES_FAKE=1`, ignored in Vercel production, like `RECEIPT_SCAN_FAKE`).
- `RateService` checks the DB cache first, fetches outside any event lock, and stores the result.
- `EventService.setCurrency` (organizer only, `ctx.actor()`, phase rules from D59), plus `currency` in `createEventSchema`.
- `PaymentService.report` accepts `paidCurrency`, `paidAmount` and `rateDate`, and its idempotent replay compares them too. `setInstructions` accepts `acceptedCurrencies`.
- Routes: `GET /api/events/:id/rates?to=PHP` (members only, rate-limited, `no-store`) and `POST /api/events/:id/currency`.
- `EventViewBuilder` adds `event.currency`, payment currency details and accepted currencies. The scanner gets a currency hint. Exports get `currency`, `paid_currency`, `paid_amount`, `rate`, `rate_date` and `rate_source`, and `amount_php` becomes `amount`. `/api/health` reports the newest cached rate date.

**UI**
- A `useMoney()` hook in `EventContext` provides `fmt` (bill currency), `fmtView` (follows the switch, adds "≈") and `currency`. All ~110 `php()`/₱ call sites move to it; this is the biggest and most mechanical piece of work. `MoneyInput` gets a `currency` prop that sets the symbol and blocks decimals for 0-decimal currencies.
- The currency picker on /new, the currency line on /join and the Bill currency row in Event settings.
- The header chip and view sheet. The choice is saved per person per event in `localStorage`, wrapped in try/catch.
- `SettlementSection`: the Pay-in segmented control, the quote, the editable amount, the "covers" line and the rate disclosure. The receive card shows the amount actually sent and its rate. `InstructionsEditor` gets the "I accept" row.
- `PersonScreen`, `NextCard`, `next.ts` and `reminders.ts` use the hook. Inputs stay at least 16px and targets at least 44px, and the layout is checked at 360px.

**Build order**
1. Domain and unit tests
2. Migration, rate provider and cache
3. Bill currency (create, settings, formatter rollout, scanner, export)
4. Peso view
5. Pay in another currency
6. E2E tests, docs and the full chain

---

## 7. Edge cases covered

- **Old events and old payments:** they read as ₱ and as "paid in the bill currency". No backfill is needed.
- **No rate available:** paying in the bill currency always works. The foreign option says *Today's rate isn't available. Pay in baht or try later.*
- **ECB publishes a new rate while the sheet is open:** the server answers 409 and the sheet shows the new amount.
- **Acting for a guest:** the manager picks the currency. The D39 conflict rule is unchanged.
- **Corrections:** carried-forward credits are in the bill currency, so they're unaffected. A currency change during a correction is blocked once any payment exists (D59).
- **Mixed payments to one receiver:** the receiver sees totals in the bill currency, plus *Received ₱1,135.06 + ฿500.00*.
- **Bank and GCash fees** are outside the app. The reference rate is the agreed rate.

---

## 8. Tests and verification

- **Unit:**
  - parse/format for 2- and 0-decimal currencies
  - cross rates and rounding against hand-worked fixtures (the Breakfast numbers above)
  - `ForeignPayment`: full payment is exact; partial payments; overpayment snaps to capacity; tiny amounts are rejected
  - a property test: a credit never exceeds capacity, and the full quote always clears it
  - the VAT fix stays off for ฿
- **Integration (PostgreSQL):**
  - creating a ฿ event
  - D59 change rules (who, when, audit)
  - a ₱ payment against a ฿ bill storing the locked rate
  - `rate_changed`
  - idempotent replay
  - a ₱ + ฿ mix settling to zero and reaching Done
  - replacement lock
  - correction carry-forward
  - export columns
  - rate provider down
  - every existing suite passing unchanged, which proves ₱ events didn't move
- **E2E (iPhone 15 and 360px):** a new `currency.spec.ts` walks through: create ฿ → add a receipt → peso view → pay in ₱ with the fake rate → receiver sees ₱ and the rate → confirm → Done. A ₱ event shows no chip.
- **The full chain from CLAUDE.md**, with real results in `test-report.md`.
- **What I can't check from this container:** a live ECB fetch (`api.frankfurter.dev` is blocked here). After deployment, `/api/health` shows the newest rate date. Alternatively, you can allow that host in this environment's network settings.
- **Still needs a person:** a real iPhone run of the Pay sheet with relatives.

---

## 9. Release and rollback

- **v0.9.0**, D58–D62, with migration `…_currencies`. Docs to update: `decisions.md`, `financial-rules.md`, `GUIDE.md`, `architecture.md`, `handoff.md`, `CHANGELOG.md` and `test-report.md`.
- **Rollback:** the migration only adds columns and a table. However, once a non-₱ event exists, v0.8.0 would show its amounts as ₱. After that point, use a forward fix only.

## 10. Not in this sprint

- More than one currency in an event (per-receipt currency)
- Viewing in currencies other than ₱
- VND, TWD, AED and SAR (these need a second rate source)
- Sending money through the app (it still only records payments)
