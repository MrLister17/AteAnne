# Architecture

AteAnne is a **modular monolith**: one Next.js app with a layered, object-oriented core and PostgreSQL. There are no microservices, queues, model APIs or bank integrations.

```
Browser (installable PWA)
  │  fetch JSON (decimal-string centavos), HttpOnly session cookie
  ▼
app/api/**/route.ts     ← thin adapters, wrapped by http/route.ts
  │  Origin/CSRF check · session → actorId · size-limited JSON · error → status · no-store
  ▼
server/services/*Service  (application layer, one class per area)
  │  BEGIN; SELECT … FROM "Event" … FOR UPDATE; load EventAggregate; check authority, phase, versions
  ▼
server/aggregate/EventAggregate  (aggregate root over the loaded records)
  │  delegates every rule to …
  ▼
domain/*  (pure classes: no I/O, no framework, exhaustively unit-tested)
  ▼
PostgreSQL (bigint money, CHECK constraints, append-only history)   +   PrivateStorage (outside public/)
```

## Object-oriented design

| Layer | Classes | OOP concepts used |
| --- | --- | --- |
| Value objects | `Money`, `Fraction` | Immutability, encapsulation (private constructor + factories `of`, `parsePesos`, `fromWire`), operator methods |
| Domain services | `LargestRemainderAllocator`, `ReceiptReconciler`, `ReceiptCalculator`, `EventLedger`, `SettlementPlanner`, `PaymentLedger`, `PhaseMachine` | Single responsibility; **composition** (`EventLedger` has a `ReceiptCalculator` and a `SettlementPlanner`; `ReceiptCalculator` has an allocator + reconciler); constructor injection for testability |
| Errors | `DomainError` → `ValidationError`, `ConflictError`, `PermissionError`; `HttpError` → `NotFoundError`, `GoneError`, `RateLimitedError`… | **Inheritance + polymorphism**: the HTTP layer maps by subclass (`statusFor`) without the domain knowing HTTP |
| Aggregate | `EventAggregate`, `EventRepository` | Aggregate root encapsulates loaded records and exposes intention-revealing methods (`allocationGate()`, `paymentLedger()`, `memberForActor()`) |
| Application services | `BaseService` (abstract) → `EventService`, `ReceiptService`, `PaymentService`, `AssetService`; plus `RecoveryService`, `QueryService`, `CleanupService` | **Abstract base class** with the template "lock event → load aggregate → resolve member → act → audit" (`inEvent`) shared by subclasses |
| Ports & adapters | `PrivateStorage` (interface) ← `LocalDiskStorage` | **Interface / dependency inversion**: swap in an object-storage adapter without touching services |
| Infrastructure | `SessionManager`, `SecretGenerator`, `JoinCodeCodec`, `RateLimiter`, `EventViewBuilder` | Encapsulated security primitives |
| Composition root | `AppContainer` | Dependency injection: tests build a container on the test DB + temp storage |
| UI | `ApiClient`, `ApiError` | Small typed client class |

```mermaid
classDiagram
  class Money { +centavos: bigint +of() +parsePesos() +fromWire() +plus() +minus() +format() }
  class Fraction { +num +den +plus() +times() +floor() }
  class LargestRemainderAllocator { +allocate(total, entries) Map }
  class ReceiptReconciler { +reconcile(receipt) }
  class ReceiptCalculator { +calculate(receipt, order) +claimIssues() }
  class EventLedger { +calculate(receipts, order) }
  class SettlementPlanner { +plan(balances) TransferEdge[] }
  class PaymentLedger { +edgeStates() +remainingNets() +assertCanReport() +completionBlockers() }
  class PhaseMachine { +canMoveTo() +assertIn() }
  ReceiptCalculator o-- LargestRemainderAllocator
  ReceiptCalculator o-- ReceiptReconciler
  EventLedger o-- ReceiptCalculator
  EventLedger o-- SettlementPlanner
  LargestRemainderAllocator ..> Fraction

  class EventAggregate { +allocationGate() +reviewGate() +settlementGate() +doneGate() +calculation() +paymentLedger() }
  EventAggregate o-- EventLedger
  EventAggregate ..> PaymentLedger
  EventAggregate ..> PhaseMachine

  class BaseService { <<abstract>> #inEvent() #audit() #bumpFinancial() }
  BaseService <|-- EventService
  BaseService <|-- ReceiptService
  BaseService <|-- PaymentService
  BaseService <|-- AssetService
  BaseService ..> EventAggregate
  class PrivateStorage { <<interface>> +put() +get() +delete() }
  PrivateStorage <|.. LocalDiskStorage
  AssetService o-- PrivateStorage

  class DomainError
  DomainError <|-- ValidationError
  DomainError <|-- ConflictError
  DomainError <|-- PermissionError
  DomainError <|-- HttpError
```

## Event lifecycle

```mermaid
stateDiagram-v2
  [*] --> Collecting: create event (owner + join code)
  note right of Collecting: "Add & claim" (v0.7, D49). Receipts AND claims.\n"Everyone's here" (owner) sets rosterLockedAt.\n"Cancelled" is an overlay flag, not a phase;\nit never forgives money.
  Collecting --> Settling: AUTOMATIC (advanceIfReady) the first time freezeGate passes · roster locked · everyone entry-complete · receipts reconcile · payers confirmed · everyone answered every receipt · calculation OK · no approvals (D50) · FREEZE snapshot + edges
  Collecting --> Settling: owner by hand after a correction (or legacy Allocating/Reviewing) · same freezeGate
  Settling --> Collecting: owner correction · reason · no pending report or open dispute · old snapshot SUPERSEDED
  Settling --> Done: AUTOMATIC (daily cleanup) 24 h after the last payment activity once doneGate passes · or owner "Close it now"
  Done --> [*]: read-only
```

## Payment report state machine

```mermaid
stateDiagram-v2
  [*] --> Reported: sender reports (≤ outstanding − pending) · idempotency key
  Reported --> Verified: named recipient confirms (atomic, idempotent)
  Reported --> Rejected: named recipient, reason → opens Dispute
  Reported --> Cancelled: sender only
  Verified --> Verified_Reversed: recipient only · once · before Done · reason (appended PaymentReversal)
  Rejected --> [*]: immutable
  state Dispute {
    [*] --> Open
    Open --> Resolved: both choose "No transfer" (debt stays)
    Open --> AwaitingReplacement: both choose "Re-record"
    AwaitingReplacement --> Resolved: sender files linked replacement report (same money)
  }
```

Effects: only **Verified, not reversed** reports reduce an edge's outstanding amount. Pending reports reserve capacity. Rejected or cancelled reports have no financial effect.

## Data model (ER)

```mermaid
erDiagram
  Actor ||--o{ Session : has
  Actor ||--o{ Member : "binds (per event)"
  Event ||--o{ Member : roster
  Event ||--o| Member : owner
  Event ||--o{ Receipt : has
  Receipt ||--o{ ReceiptLine : has
  Receipt ||--o{ Adjustment : has
  Receipt ||--o{ FundingAck : "payer signs (per version)"
  Receipt ||--o{ ReceiptAck : "member FINISHED/NONE"
  ReceiptLine ||--o{ Claim : "member units"
  Event ||--o{ ReviewApproval : "member × financialVersion"
  Event ||--o{ Snapshot : "frozen (ACTIVE/SUPERSEDED)"
  Snapshot ||--o{ SnapshotShare : "funding/cost/net"
  Snapshot ||--o{ SettlementEdge : "from → to amount"
  SettlementEdge ||--o{ PaymentReport : reports
  PaymentReport ||--o| PaymentReversal : "≤1"
  PaymentReport ||--o| Dispute : "opened by rejection"
  PaymentReport ||--o| PaymentReport : "replacement of"
  Member ||--o{ PaymentInstruction : "versioned cash/QR"
  Event ||--o{ Asset : "private images"
  Event ||--o{ AuditEvent : history
```

Key constraints: money is stored as `BigInt` centavos with `CHECK` bounds (0 to PHP 1,000,000). Uniques: one claim per member and line, one approval per member and version, one funding ack per receipt version, one reversal per report, one idempotency key per sender. Ledger foreign keys use `Restrict`, so a member referenced by money cannot be cascaded away. Whole-event purge is a separate, ordered routine.

## Concurrency and versions

- **Event row lock**: every money-affecting write starts with `SELECT … FOR UPDATE` on the event. This gives one consistent lock order, and concurrent unit claims, reports and confirmations serialize. Tested with parallel requests.
- **Versions**: `Event.structuralVersion` (roster), `Event.financialVersion` (bumped by any money change; approvals bind to it), `Receipt.version` (claims and acks from older versions become stale drafts), `Member.claimVersion` (your own optimistic concurrency, so routine saves do not clash with other members), immutable `Snapshot.id`.
- **Idempotency**: report creation is keyed by sender + key. Verify is a conditional `UPDATE … WHERE status='REPORTED'`, so a double click returns success once. Reversal is unique per report.

## Security model (summary)

Opaque 32-byte session and recovery secrets, stored as SHA-256 only, in HttpOnly SameSite=Lax cookies (`Secure` over HTTPS). Join codes: 10 characters from a 32-symbol alphabet, indexed by HMAC-SHA256 under `JOIN_CODE_HASH_KEY`, AES-GCM encrypted for owner re-display, 7-day expiry, closed at roster lock. Every write checks Origin plus membership, self, author, payer or recipient authority, phase and version on the server. 404 for non-members, so existence does not leak. DB-backed rate limits. Strict Zod schemas. `no-store` on private responses. Strict CSP. Private images are decoded and re-encoded by sharp (metadata stripped), stored under random keys outside `public/`, and served only to authorized members; QR codes go only to their owner and to people who owe them.

## Sprint S7 extensions

- `InstallProvider` captures the single-use native install event across routes. `InstallFirst` prevents mobile create/join from issuing a new identity until installation guidance or an explicit browser choice. iOS uses instructions; its OS Share sheet cannot be invoked by a website.
- `RecoveryPolicy` authorizes only the organizer’s attested reissue; `RecoveryService` issues/redeems hash-only credentials under the event lock, preserving identity and ledger references. Existing browser binding changes only on successful redemption.
- `Receipt.equalSplit` defaults false. `EqualReceiptSplit` owns whole-receipt consent validation and centavo component rounding; `ReceiptService` derives only the caller’s claims. Normal item allocation is unchanged.
- `CorrectionLedger` calculates revised residual balances from corrected economic nets plus all verified, non-reversed transfers across snapshots. Correction uses the normal phase workflow with fresh approvals; `EventService` supersedes only after checking pending/dispute gates. Old snapshot facts and report records remain untouched. `PaymentService` only mutates the active snapshot’s reports. Projection/export includes immutable statement/payment history and equal-policy metadata.
- `ReminderButton` (`ReminderPanel.tsx`, inside Home’s Next step card) refreshes the authorized read model, then `remindersFor` produces plain-text phase tasks with no credential inclusion or automatic delivery. It avoids payment nudges while a report is pending.

## Sprint S10 extensions (v0.9, D58–D62)

- **Domain:** `money/Currency` (supported currencies, minor units, parse/format), `fx/ExchangeRate` (exact decimal rate, cross rate from per-euro quotes, `convert`/`convertBack`, `rateFromDay`), `receipt/ReceiptConverter` (convert once, split by largest remainder), `payments/ForeignPayment` (full/partial credit). `EventLedger` sums funding and cost in the settle-up currency; `PaymentLedger` takes the currency only for messages.
- **Server:** `fx/RateProvider` (`EcbRateProvider` → Frankfurter, two base URLs, 5 s timeout; `FakeRateProvider`), `fx/RateService` (per-day cache in `ExchangeRate`, fetched only outside event locks; `ensureDays`, static `load`, `refreshForOpenEvents`). `EventRepository.load` reads cached rates for the event's foreign receipt days on the same transaction; `EventAggregate.receiptRate` builds each receipt's conversion. `BaseService.freeze` writes currency, day, rate and converted shares into the snapshot facts. `EventService.setCurrency`, `freezeWaitingEvents` (daily job); `PaymentService.report` with `paid`; `QueryService` prefetches today's and receipt-day rates before building the view.
- **Data:** `Event.currency`, `Receipt.currency/purchasedOn`, `PaymentInstruction.acceptedCurrencies`, `PaymentReport.paidCurrency/paidMinor/rate/rateDate/rateSource` (all-or-none check constraint), new `ExchangeRate(source, day, effectiveDate, perEur JSON, fetchedAt)`. Migration `20261119120000_currencies`, additive.
- **UI:** `useEvent()` gives `money` (exact; settle-up currency unless another is passed), `shown` (follows "Show totals in", "≈"), `currency`, `viewRate`. `CurrencySwitch` on Home and Pay/Money; currency/date fields in `ReceiptEditor`; Pay in / quote / "Counts as" in `SettlementSection`; "I accept" in payment details; settle-up currency in Event settings and Start a hatian.
