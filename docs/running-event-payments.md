# Running event payments and credit

Status: **implemented in v0.10.0** (decision D64). This spec adds cash payments to an open event and defines how those payments carry into the final bill.

Where the implementation made a choice the spec left open:
- **An agreed re-record must match the original handoff's amount and currency.** To change the amount, both people agree "no money was handed over", then the sender records a new payment.
- **Method.** The form offers Cash or E-wallet. Both are cash-style handoffs recorded outside the app.
- **Where cash tasks appear.** Confirm received and Report a problem appear in the Next card (Home, or Pay once frozen) and in the Payments card (Home during Add & claim, Pay once frozen, Money when Done).
- **Balance labels.** The balance banner keeps the app's existing "Net to pay" / "Net to receive" / "Settled" and adds **Credit**. The form's estimate uses the short labels.
- **When the balance banner appears.** During Add & claim it still waits until everyone has answered (D51). The Payments card meanwhile shows the paid/received lines and "Balance pending".

## Product behavior

A member can record cash already handed to another member during **Add & claim** or **Pay**. The amount can exceed the current estimate, and the action is available before the first receipt. The named recipient confirms that the cash arrived. The event payment view shows the resulting balance and identifies the actual recipient in activity.

Credit applies across the event. Future receipts can use it regardless of who paid the merchant. The app records cash handoffs and calculates what people still owe each other. It does not hold or move funds.

### Example

Assume THB is the event's settlement currency. A traveler currently owes THB 1,734.48 and another member is due THB 6,353.56. The traveler hands that member THB 2,000.00.

| State | Traveler | Recipient |
| --- | --- | --- |
| Cash reported | THB 1,734.48 to pay · THB 2,000.00 awaiting confirmation | THB 6,353.56 to receive · Confirm THB 2,000.00 |
| Cash confirmed | THB 265.52 credit · Paid THB 2,000.00 to the recipient | THB 4,353.56 to receive · Received THB 2,000.00 |
| A new receipt adds THB 100.00 to the traveler's share | THB 165.52 credit | Recalculate from their own expense and payment activity |

Balances remain estimates while the bill changes. The example uses settlement amounts directly. When THB appears as an approximate display number for a PHP event, use the event's PHP balance and the payment's locked FX conversion for the calculation.

## Pay flow

In **Pay**, keep the existing exact and partial payment flow for suggested transfers. Offer **Record cash payment** for a handoff that exceeds a transfer or has no matching transfer. The named recipient and actual amount stay on the report regardless of how the suggested transfers change.

1. During **Add & claim**, show **Record payment** on Event Home and open the shared Pay form from there. The current tab bar hides Pay in this phase. Keep the four tabs and make payment history and recipient tasks reachable through the Home payment entry point, including in the no-receipts and split-unavailable states. Select an active recipient other than the sender. A suggested transfer may prefill the recipient and amount. The member can edit both.
2. Show recipient, actual cash amount and currency before submission. If the split is available and the payment moves the sender into credit, show the estimated result. If the split is unavailable, show **Balance pending** and still accept the payment. Keep the actual cash amount visible throughout.
3. Submit an **Awaiting confirmation** report. Recipients see **Confirm received** and **Report a problem** next to the sender, amount and currency. Senders can cancel a pending report. Reuse the next-action and reminder surfaces. Open the payment task from Home during Add & claim and from Pay once frozen. A pending report never suggests paying the same balance again.
4. Confirmation immediately recomputes both balances. The sender sees **Credit** where applicable and a line such as **Paid THB 2,000.00 to Maya**. The recipient sees **Received THB 2,000.00 from Sam**. Keep the sender and actual recipient on every history entry. If several payments contributed, summarize the count and let the user expand the history to see each one.
5. Record an actual refund as a new payment in the reverse direction. Optionally link it to the original report for history. Use **Undo confirmation** for a reporting mistake, with a reason and audit entry. This action corrects the record. It represents no cash handoff.

Use short balance labels: **To pay**, **To receive**, **Credit**, **Settled**, or **Balance pending**. Show **Credit** when confirmed net outgoing payments create some or all of the positive balance. The expanded breakdown distinguishes reimbursement for money spent at merchants from the part created by paying ahead. A credit entry in the summary makes no claim that the last recipient personally owes that amount. The settlement plan determines who pays whom.

## Balance and lifecycle rules

```text
expenseNet   = paid to merchants − allocated expense share
paymentNet   = confirmed cash sent − confirmed cash received
remaining    = expenseNet + paymentNet
creditPart   = max(0, max(0, remaining) − max(0, expenseNet))
```

- Use signed integer minor units in the event settlement currency. Each confirmed transfer adds the same settled amount to the sender and subtracts it from the recipient. The sum of event balances remains zero. When the split is unavailable, show confirmed payment activity independently and defer the combined position.
- Reuse `EventAggregate.remainingNets()`, `CorrectionLedger` and `SettlementPlanner`. Extend `confirmedTransfers()` to cover verified, non-reversed event-level cash payments and existing verified settlement reports. Derive credit from the net and payment contribution. Keep receipt totals, allocations and merchant funding independent of payment activity.
- Use the existing `COLLECTING` flow and allow the supported legacy open phases `ALLOCATING` and `REVIEWING`. In `SETTLING`, use the event-level cash report for a payment outside the frozen plan. Existing frozen-edge reports retain their caps. `DONE` and cancelled events are read-only for these actions.
- A pending cash report blocks automatic and manual freeze. Make the blocker actionable for the two participants. Rejection records the reason and opens the existing two-party resolution flow. An unresolved dispute also blocks freeze. If both agree to re-record, allow one linked replacement for the same handoff. If they agree that no cash arrived, close the dispute with no ledger effect. Run the existing auto-advance check in the same transaction after resolving the last blocker. The first freeze may advance automatically, and corrected bills keep their existing organizer-driven refreeze.
- At freeze, carry verified event-level cash transfers into the immutable snapshot exactly once and generate final edges from the residual positions. Include a stable source report ID in the new carried facts so an export can trace each adjustment back to its confirmation. With THB 265.52 still in credit, the traveler is a receiver in the settlement plan. The actual cash recipient remains visible in history even if a different person is responsible for the remaining return transfer.
- Frozen position reporting starts from the snapshot's carried amounts and applies only new verified reports attached to that active snapshot. When a correction supersedes it, rebuild from raw receipt balances and all effective transfers so the original cash never counts twice. A mistaken confirmation can be reversed during Add & claim. During Pay, reversal requires the same guards and settlement revision as a new confirmation. Keep prior snapshots and audit history.
- Keep event deletion and settlement-currency changes locked once an event-level cash report exists, like the existing payment policy. Guard roster removals that would orphan payment parties. Before allowing event cancellation, require pending reports and disputes to be resolved and each member's effective event-level cash net to return to zero through documented cash handoffs or corrections. Existing scheduled retention still purges event data on its normal timeline.

### Confirming a cash payment during Pay

The screenshot's **Step 2 of 3 · Pay** is this case. The traveler may have paid THB 2,000.00 even though the frozen transfer is only THB 1,734.48. Record the full amount as one event payment. On confirmation, revise the payment plan from the same frozen receipts, shares and locked receipt rates.

1. Allow one outstanding event-level cash report or unresolved cash dispute at a time during Pay. For the first version, require existing edge reports and disputes to be resolved before opening one. While it is awaiting a decision, pause new edge reports, organizer correction and the Done transition. Keep confirm, reject and cancel available, and show why other payment actions are paused. This prevents superseding a statement with outstanding payment actions.
2. Under the event lock, confirm the cash report, recompute residual positions from the active snapshot's raw nets plus all effective verified transfers, then run the existing planner. In the same transaction, supersede the previous statement and create a new active snapshot with the same receipt and share facts, the new carried payments and residual edges. Bump the financial version, audit the old and new snapshot IDs with the report ID, and keep the event in Pay. Confirmation and replanning commit together.
3. Reload positions and suggestions for everyone. Explain that confirmed cash was included and the remaining transfers were updated. Old edge IDs are stale and must refresh before accepting new reports. A cash confirmation reversal follows the same locked replan with the reversed report excluded. Keep the current closeout delay, using the new snapshot or latest payment activity as its starting point.

## Storage and service integration

| Area | Proposed change |
| --- | --- |
| Prisma | Add an event-scoped cash report with event, sender and recipient IDs, status, version, idempotency key, original amount and currency, effective settlement amount, FX snapshot if applicable, created/decision timestamps and rejection reason. Preserve dispute decisions and link a single allowed replacement to its original report. Store a confirmation reversal as an append-only record with actor, timestamp and reason. Enforce distinct parties, positive amounts, event membership, uniqueness of sender request keys, and the existing Data API lockdown for new tables. |
| Routes and service | Add an event-level creation endpoint (for example `POST /api/events/[eventId]/cash-payments`) and decision endpoints following the existing payment-route pattern. Use a `BaseService` subclass, `inEvent` locking, server-side validation, audit, and the same guest/delegation conflict rules as existing payments. Block direct decisions by unrelated attendees. Apply status and expected-version checks in the event transaction. |
| Idempotency | A retry with the same key and original input returns the existing report, even if auto-freeze happened after the first request. A reused key with changed input conflicts. Concurrent decisions produce at most one effective confirmation or reversal. Recompute before writes that depend on phase or state. |
| Currency | Reuse recipient-accepted currencies, Manila payment-day handling and rate caching. For the first version, record cash handed over today in Manila. The server locks the ECB rate, effective date and source at report time. An agreed replacement for the same handoff reuses that rate. Reuse the existing rate-validation pattern and exact conversion, without the frozen-edge amount cap. Missing rates or zero after conversion produce a visible error. Switches in display currency only change presentation. Keep the exact event amount, original cash amount and currency in payment details. |
| Read model and data lifecycle | Load event-level cash reports via `EventRepository`. Add balance breakdown and cash payment activity to `EventViewBuilder`, including before a split can calculate. Apply the same event access and payment detail visibility as current reports. Include event-level cash reports, reversals and FX metadata in exports and audit. Extend purge ordering before member/event deletion. Existing events with no event-level cash reports calculate as before. |

## Compact event UI

The Pay screen should answer three questions at a glance: what is my balance, who did I pay, and does anything need my action? Use the repo's existing `Icon`, buttons and disclosures. Use familiar icons for navigation or secondary controls with accessible names. Keep short text labels for financial states, unusual actions and anything that changes money.

| Area | Visible by default | One tap away |
| --- | --- | --- |
| Pay header | Event name, phase, amount and currency, clear balance status, estimate marker when needed | Statement version, calculation copy and the detailed balance explanation |
| Everyone | Avatar, name, amount and status, chevron. Show the relevant recipient in the viewer's confirmed payment summary. | Merchant spend, allocated share, sent and received totals, exact settlement amount |
| Payment activity | Actionable reports with sender, recipient, amount, currency and status. Show the latest applicable confirmed recipient or a concise payment count. | Older, rejected, cancelled or reversed reports, timestamps, notes and FX details |
| Share and rates | Compact **Your share** and currency controls. Keep estimate cues and the exact settlement amount in the main balance and confirmation where applicable. | Receipt line items, conversion rate and date, prior statements and split policy |
| Home and People | Next action, roles, names, join code and blockers | Organizer notes behind a named control, secondary group explanations, event settings help |
| Receipts and Claim | Receipt or item name, payer, amount/currency, selection, claim state, warnings and primary actions | Split explanations, rate provenance, photo guidance and other optional detail |

Use chevrons to identify disclosures, keep the summaries keyboard-accessible and reserve at least 44 CSS px for touch targets. Decorative icons are hidden from screen readers. Keep error and pending states discernible through text, with color as a supporting cue. Preserve the existing short bottom navigation labels. Check both themes, the repo's 360 px and iPhone layouts, long names, large currency amounts, text zoom and disclosure focus.

The existing paths for this work are [PaymentService](../src/server/services/PaymentService.ts), [EventAggregate](../src/server/aggregate/EventAggregate.ts), [BaseService](../src/server/services/BaseService.ts), [EventViewBuilder](../src/server/readmodels/EventViewBuilder.ts) and [the Prisma schema](../prisma/schema.prisma). Event payment decisions should extend [the domain next-action policy](../src/domain/event/NextAction.ts). The UI starts from [EventApp](../src/ui/event/EventApp.tsx), [MoneyTab](../src/ui/event/MoneyTab.tsx) and [SettlementSection](../src/ui/event/SettlementSection.tsx).

## Implementation order

1. Add the migration, transaction service and routes. Cover reporting, confirmation, rejection, cancellation, reversal and FX independently of a frozen statement.
2. Integrate live balances, freeze/correction carry-forward, lifecycle guards, exports, audit and retention. Compare the new read model against an event with only legacy frozen payments.
3. Add the open-event Home entry point, shared Pay form, recipient task, balance and activity views. Use existing UI patterns from the compact event screen review.
4. Verify the full flow on two signed-in participants, including after reload and after the event freezes. Roll out the additive migration before exposing writes. After confirmed payments exist, retain support for their balances through forward fixes.

## Acceptance checks

- A THB 2,000.00 payment against THB 1,734.48 owed shows THB 265.52 credit after confirmation. The recipient's receivable decreases THB 2,000.00. Both history entries show the actual counterparty.
- From Step 2 Pay, record and confirm an amount that exceeds a frozen edge. Verify that receipt facts and shares match the earlier statement, its history remains accessible, residual edges are correct, and a stale edge report is rejected. Cover an existing pending edge report, a second simultaneous cash report, rejection or cancellation, and reversal after a revision.
- Report before any receipts, confirm as recipient, then add and claim a receipt. The combined balance appears when available. When the same traveler later owes THB 100.00 more, credit becomes THB 165.52, even if a third member paid for that receipt.
- Check partial, exact and multiple payments, and an amount greater than the recipient's receivable. Balances conserve money even when one or both parties cross zero.
- Check pending, rejected, cancelled and reversed records, retries, cross-event IDs, guest authorization and simultaneous decisions. Only effective confirmed amounts enter balances.
- Confirm the last pending report while a ready event is waiting to freeze. Verify that the amount is carried once at freeze, survives reload, and carries once after correction and refreeze. Verify that settlement can reach `DONE` only after all residual edges are complete.
- Record an actual refund. Verify both balances and the new transfer entry, with the original payment still visible.
- Verify a different accepted cash currency with a locked rate, a missing rate and a display-currency toggle. Check original and settlement amounts, rounding and export.
- Verify legacy settlement reports, corrected bills, export, restrictions on roster removal and deletion, and scheduled retention. At phone sizes, confirm primary actions and warnings remain visible and each collapsed detail is reachable.
