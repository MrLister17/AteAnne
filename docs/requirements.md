# Requirements traceability

Source: *AteAnne — Full SDLC & Financial Specification v1.0* ([docs/spec/](spec/)). Status key: **Done** = implemented and covered by an automated test. **Done (manual)** = implemented and checked by hand or script, without a dedicated automated test. **Partial** = see the note. Test paths are relative to `tests/`.

## Functional requirements

| ID | Requirement (short) | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| FR-01 | Event title 1–80, note ≤500, PHP; ≤20 people, ≤25 receipts, ≤50 lines | Done | `validation.ts`, `EventAggregate` limits, `EventService.join` | `integration/security.test.ts` (20-person limit), E2E create |
| FR-02 | Join by random code + name; separate session and recovery credentials; code grants no authority | Done | `JoinCodeCodec`, `SessionManager`, `EventService.join` | security tests: rotated code, no owner authority, hash-only storage |
| FR-03 | Intent guides UI only; anyone can fund and consume | Done | `IntentPicker`, domain has no roles | `unit/domain.test.ts` "payer can also owe", E2E (Mark pays and eats) |
| FR-04 | Manual receipt: label, one payer, lines (qty, exact total), adjustments, payable, optional private photo | Done | `ReceiptService`, `ReceiptEditor`, `AssetService` | workflow + E2E + image tests |
| FR-05 | Named payer confirms funding for the exact receipt version | Done | `ReceiptService.acknowledgeFunding`, `FundingAck` unique per version | workflow: only payer; organizer edit makes ack stale |
| FR-06 | Entry gate: all complete, reconciled, payer-confirmed; owner locks roster | Done | `EventAggregate.allocationGate`, `EventService.transition` | workflow "entry gate…locks the roster" |
| FR-07 | Each member answers every receipt; None ≠ unanswered; progress saved | Done | `ReceiptService.saveClaims` (finish/none/draft), `ReceiptAck` | workflow (Paolo unanswered blocks review), E2E |
| FR-08 | Shared-equal / units / solo | Done | `ReceiptCalculator` | fixtures (dinner, rice), E2E rice by piece |
| FR-09 | Conflict gate; no silent edits to others' claims; visible corrections | Done | `reviewGate`, claims are always the caller's own; organizer receipt edits are audited as `receipt.organizer_correction` and make claims stale | security "claims are always the caller's own"; workflow organizer correction |
| FR-10 | Scoped discounts; service on post-discount eligible spending; exact rounding | Done | `ReceiptCalculator` | fixtures (scoped discount), generated tests |
| FR-11 | Receipt shares = payable; nets sum to zero; server recomputes | Done | `ReceiptCalculator` invariants, `EventLedger`, freeze recomputes in lock | fixtures + 500 generated receipts |
| FR-12 | Review shows breakdown; all approve the same version; edits reset approvals | Done | `MoneyTab`, `approveReview`, `financialVersion` | workflow review; E2E approvals |
| FR-13 | Immutable snapshot + edges | Done | `EventService.freeze`, `Snapshot` (status-only update) | workflow reopen → superseded |
| FR-14 | Cash and/or own QR; recipient and instruction version shown; no transfer execution | Done | `PaymentService.setInstructions`, `PaymentInstruction` versions | E2E QR + cash; QR visibility test |
| FR-15 | Reports: partial/full, pending reserves capacity, idempotent | Done | `PaymentService.report`, `PaymentLedger` | workflow pending/idempotent/over-report; E2E partial |
| FR-16 | Recipient-only confirm/reject; one reasoned reversal before Done | Done | `verify`, `reject`, `reverse` | workflow; fixture rejections |
| FR-17 | Done only when all edges verified, no pending/disputes; zero-debt needs no fake payment | Done | `EventAggregate.doneGate` | workflow Done; E2E Done blocked while pending |
| FR-18 | History, stable identity across recovery, private images, export, audit | Partial | `RecoveryService`, `QueryService.export`, `AuditEvent` | recovery + image tests. **Gap:** deactivating a member who already has financial references is not implemented. Owners can only remove unreferenced members while Collecting. |

## Acceptance tests

| ID | Evidence | Status |
| --- | --- | --- |
| AT-01 | E2E creates/joins a persistent event; 20-person limit in integration | Done |
| AT-02 | Rotated/closed/expired codes; non-owner rotate denied; two events isolated | Done (expiry path is code-reviewed; not time-travel tested) |
| AT-03 | Payer also owes; zero consumer funds a receipt; unconfirmed funding blocks the gate | Done |
| AT-04 | Pictured-receipt reconciliation (VAT not re-added, card line ignored); funding ack tracks version | Done |
| AT-05 | Gate advances only on complete current records; join after lock rejected | Done |
| AT-06 | None vs unanswered; progress persists | Done |
| AT-07 | Dinner fixture incl. Juan zero rice; stable centavo rounding | Done |
| AT-08 | 4 concurrent claims on 3 rice units → exactly one 409 | Done |
| AT-09 | Scoped discount; zero service basis flagged, never split equally | Done |
| AT-10 | Service follows adjusted spending; every allocation sums exactly | Done |
| AT-11 | All fixtures match; nets and residuals sum to zero | Done |
| AT-12 | Same-version approvals; stale version rejected; owner cannot approve for others (approvals are self-only by construction) | Done |
| AT-13 | Reopening keeps the superseded snapshot; D47 now permits reasoned post-report correction after resolving pending/disputed payments | Done |
| AT-14 | QR + cash; instruction version shown; QR hidden from non-debtors; cross-event asset read denied | Done |
| AT-15 | Pending leaves verified balance unchanged; idempotent replay | Done |
| AT-16 | Sender/owner cannot verify; concurrent double confirm credits once | Done |
| AT-17 | Reversal recipient-only, once, before Done; disputed edge blocks new reports | Done |
| AT-18 | Done gate; zero-debt snapshot with no edges can close | Done (zero-debt path covered by gate logic; no dedicated E2E) |
| AT-19 | Recovery keeps member ID and money; old key single-use; no identity merge | Partial (no deactivation flow; see FR-18) |
| AT-20 | Format/size/metadata/scope checks; receipt vs transfer statements kept separate; retention job | Done |
| AT-21 | 360px + iPhone layout, labels, 44px targets, focus, reduced motion, persistence after reload, build, restore rehearsal | Done; restore rehearsed on dev data without snapshots |

## Owner additions after the spec

| Change | Status | Evidence |
| --- | --- | --- |
| Receipt scanning: photo to draft receipt via Groq (default) or Claude (D27, D28) | Done with a fake reader. **A live Claude call has not been verified yet** (no API key available in the build session) | `unit/receipt-draft.test.ts`, `integration/scan.test.ts`, `e2e/scan.spec.ts` |
| 30-day retention for all events (D24) | Done | `integration/retention.test.ts` |
| First-visit tutorial (D22) | Done | `e2e/tutorial.spec.ts` |

## Non-goals (v1, per spec)

Bank or payment APIs (OCR/AI scanning was later added by the owner; see above), QR decoding, multiple funders per receipt, pooled advances, custom fractional weights in the UI, in-app chat, public event directory.

## Sprint S7 owner additions (D43–D47)

These override the original spec’s no-reset and post-report freeze limitations; original source documents remain historical specifications.

| ID | Acceptance requirement | Implementation / evidence |
| --- | --- | --- |
| S7-01 | Home Screen guidance before mobile identity creation; native prompt where supported; honest Safari steps; explicit browser fallback | `InstallProvider`, `InstallFirst`, `InstallPrompt`; `e2e/install.spec.ts` |
| S7-02 | Organizer-attested, expiring single-use recovery; stable financial identity and revoked old access; admin/nonmember denial and redemption races | `RecoveryPolicy`, `RecoveryService`; `integration/recovery-reissue.test.ts`, `e2e/recovery.spec.ts` |
| S7-03 | Equal whole receipt; everyone accepts own share; exact conservation and ≤1c difference; disagreement blocks review | `EqualReceiptSplit`, `ReceiptService`; `unit/equal-receipt.test.ts`, `integration/equal-receipt.test.ts`, `e2e/equal-receipt.spec.ts` |
| S7-04 | Preview and copy person/group reminders for Messenger; current next steps, no credentials, no duplicate-transfer nudges | `reminders.ts`, `ReminderPanel`; `unit/reminders.test.ts`, `e2e/reminders.spec.ts` |
| S7-05 | Reasoned correction before Done, pending/dispute gate, immutable history, stable roster, fresh approval and confirmed-payment carry-forward | `CorrectionLedger`, `EventAggregate`, `EventService`, `PaymentService`; `unit/correction-ledger.test.ts`, `integration/corrections.test.ts`, `e2e/corrections.spec.ts` |

See `test-report.md` for actual command outcomes; presence of a test file alone is not a claim that it passed.
