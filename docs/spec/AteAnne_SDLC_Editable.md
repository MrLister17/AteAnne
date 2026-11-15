# AteAnne — Full SDLC & Financial Specification
Version 1.0 • 15 November 2026

## AteAnne
PROJECT 03 / STANDALONE PORTFOLIO APPLICATION

Hatian na malinaw. Bayaran na tama.

Full SDLC & Financial Specification
Manual receipts • Item-based sharing • Proportional charges • Verified repayments

**The product**
AteAnne is a Filipino pun on “hatian.” It helps a small group record who paid, identify who consumed each item, review a fair split, and settle through cash or a personally supplied payment QR.

Paying the entire restaurant bill does not mean consuming the entire bill. Eating a solo meal does not mean sharing everyone else’s meal. This application keeps those facts separate and explains every centavo.

### Your intended journey

- Create an event and share a join code. Everyone enters the expenses they paid.
- Work through each receipt and claim the food or items actually consumed.
- Review item shares, proportional service charge, payer credits and net amounts.
- Send money outside the app, report it, and let the recipient verify receipt.
- Mark the event Done only when all obligations are verified as settled.

| Document | Baseline |
| --- | --- |
| Version / date | 1.0 / 15 November 2026 |
| Locale | Philippine pesos (PHP); Asia/Manila |
| Default implementation | TypeScript web application + PostgreSQL + private image storage |
| Application AI | None; no OCR or bank/payment API required |
| Status | Development specification; not a deployed app or completed pilot |

Kulayan remains your planning project. The Lucena commute guide remains separate. AteAnne is the shared-expense project, replacing the earlier working name Ambagan.

## One event, five clear phases
PRODUCT FLOW / PHASE GATES

| Phase | What happens | Gate to advance |
| --- | --- | --- |
| 1 • Collecting | Join by code; enter receipts, actual payer, items, totals and adjustments. | Everyone on roster is done entering; receipts reconcile; actual payers confirm funding. |
| 2 • Allocating | Each member reviews every receipt and claims items or explicitly claims none. | All items/units allocated, each member finished, no conflicts or open disputes. |
| 3 • Reviewing | Show itemized shares, charges, funding and proposed repayments. | Every roster member approves the same current financial version. |
| 4 • Settling | Freeze statement; report actual cash/QR payments; recipient verifies. | All transfer edges settled; no pending reports or open disputes. |
| 5 • Done | Read-only event statement and payment history. | Owner explicitly closes an eligible event; no artificial payment for zero-debt cases. |

### Intent is not a financial role

“Will pay only” and “I paid an expense” help the person get started. A contributor may still owe more than they paid. Someone who consumed nothing on a receipt may still be owed its entire cost. Track receipt creator, actual payer, consumer and repayment recipient separately.

**What “everyone” means**
Everyone means the explicit active event roster, not everyone who might have received a forwarded code. Lock the roster before allocation. Do not let a new participant silently change a reviewed split.

### Package navigation

Roadmap/research 3–4 • Requirements 5–7 • Financial rules/examples 8–13 • Payments/revisions 14–15 • UX/architecture/data/access/privacy 16–21 • Build/tests/release 22–26 • Pilot/portfolio 27–28 • Full implementation prompt 29 onward. Use the PDF bookmarks for direct navigation.

## Build in verified slices
SDLC ROADMAP / FEASIBILITY

| Phase | Outputs / exit check | Effort guide |
| --- | --- | --- |
| Discovery | Current bill-splitting examples, pain points, consent, clear hypothesis. | 6–10 h |
| Requirements | Financial rules, phase gates, permissions, acceptance IDs, P0 scope. | 10–14 h |
| Design | Mobile prototype, exact-money examples, ER/state diagrams, threat review. | 12–18 h |
| Implementation | M0–M6 working vertical slices with migrations and tests. | 60–85 h |
| Verification | Real DB and browser checks, conservation tests, files/access audit. | 20–30 h |
| Release / pilot | Persistent storage, restore/rollback, real small-group pilot. | 10–18 h + observation |
| Maintenance | Defect triage, cleanup, dependencies, measured iteration. | Ongoing |

Planning allowance: roughly 120–175 focused hours, around 8–12 weeks at 15 hours/week. Arithmetic, settlement state and private uploads make this more demanding than a simple expense list. Re-estimate after the first receipt-to-allocation slice; these are planning estimates.

### Feasibility decisions

- Manual entry is the source of truth. Optional receipt photos support checking; no recognition service is needed.
- One actual payer per receipt in v1; multiple receipts may have different payers. Multiple funders on one receipt, pooled advances and cross-currency events are deferred.
- PHP only. Do not implement payment processing, live bank verification, statutory discount eligibility or an accounting/tax advice engine.
- You own scope and release decisions. Friends voluntarily test real workflows. The coding AI implements and reports evidence, but cannot invent interviews, payments or adoption.

**Scope discipline**
A complete small workflow is the first release. Keep a P1 list for OCR, account integrations, multiple funders, arbitrary custom share weights, payment-provider webhooks and post-settlement bill corrections.

## Validate fairness and coordination
PHASE 1 / DISCOVERY & CHARTER

Hypothesis: item-level claims plus a visible review step reduce confusing or unfair equal splits, while recipient verification makes outstanding repayments clearer. Validate this with actual group habits rather than assuming every group wants precise accounting.

### Research tasks and questions

- Interview about five people, including two who often advance the whole bill. Compare one simple shared purchase and one restaurant receipt with solo items, discount or service charge.
- Ask: “What did each person actually consume?” “Who paid the merchant?” “How did you handle service charge?” “How did you know repayments arrived?”
- With consent, use an anonymized bill and recreate the expected split manually. Do not publish names, card details, loyalty numbers, QR images or private chats.
- Try a short prototype with three people: join → claim one receipt → explain their total → report/verify a partial repayment. Record confusion and effort.

### Product contract

| User | Job to be done |
| --- | --- |
| Organizer | Maintain the explicit roster, guide phases, surface blockers, preserve the ledger and close the event honestly. |
| Actual payer | Record money paid to the merchant, approve that funding, see their own consumption and verified reimbursements. |
| Consumer | Claim own items, understand discounts/charges, approve the split and repay the correct net recipient. |
| Recipient | Supply payment instructions, confirm actual receipts, reject incorrect reports without giving fake credit. |

**Discovery exit**
Write anonymized research notes, assumptions, chosen fairness policies and a proceed/simplify decision. Human research can remain pending while engineering proceeds with clearly marked assumptions. A synthetic example is not user evidence.

## Capture the expense accurately
P0 REQUIREMENTS / INPUTS

| ID | Requirement |
| --- | --- |
| FR-01 • Event | Create title (1–80 chars), optional note (0–500), and participant roster. PHP only. Limit 20 participants, 25 receipts/event, 50 lines/receipt. [AT-01] |
| FR-02 • Code/identity | Join Collecting via random code and display name; receive separate browser identity/recovery credential. Code grants no owner or payer authority. [AT-02] |
| FR-03 • Intent | Initial Will pay only / I paid an expense selection guides UI; any person can both fund and consume. No exclusive payer/debtor role. [AT-03] |
| FR-04 • Receipt | Enter merchant/label, one actual payer, line labels, positive integer quantities and exact line totals, adjustments and final payable total. Optional private image. [AT-04] |
| FR-05 • Funding | Actual payer confirms the merchant amount for each receipt; creator may differ. Funding equals payable total. Pledges and repayments never become merchant funding. [AT-03/04] |
| FR-06 • Entry gate | All roster members mark expense entry complete. Every receipt reconciles; payer approvals current. Owner locks roster and moves to Allocating. [AT-05] |

### Input and reconciliation policy

- Store and compute integer centavos; accept PHP decimal input with at most two fractional digits. Permit free lines/zero-total receipts, reject negative item prices and malformed amounts. Discounts are typed signed adjustments.
- Bound each receipt total and each item/adjustment magnitude to PHP 1,000,000. Use database bigint and BigInt arithmetic even though most values are small. Reject overflow and totals outside bounds.
- An actual line total is authoritative; unit price is an optional convenience. Quantity × unit price mismatch must be resolved or explicitly shown as the entered line total, not silently hidden.
- Cash advances into a common pot are deferred in v1. A payment to another participant is not entered as a second receipt.

## Ask what each person actually got
P0 REQUIREMENTS / ALLOCATION

| ID | Requirement |
| --- | --- |
| FR-07 • Receipt wizard | Each member visits every receipt, claims own consumed lines or selects I got nothing from this receipt. Save progress. No answer is not zero consumption. [AT-06] |
| FR-08 • Sharing modes | Shared-equal: selected consumers have weight 1. Units: each person claims whole units; total claimed units equals entered quantity. Solo is one consumer. [AT-07] |
| FR-09 • Conflict gate | Unclaimed items, under/overclaimed units, unanswered receipt acknowledgements and disputes prevent review. Correction proposals are visible; no silent edits to another person’s claim. [AT-08] |
| FR-10 • Adjustments | Allocate explicit discounts to eligible lines; allocate service proportionally to post-discount eligible spending. Exact totals and centavo rounding are mandatory. [AT-09/10] |
| FR-11 • Reconciliation | Every receipt’s shares sum to its payable total; every event net sums to zero. Server recomputes all values before review/finalization. [AT-11] |

### Rice example: two different legitimate meanings

Three rice bowls may mean three individuals each consumed one, or eight people shared the three bowls. The UI must ask for the correct mode. If Leanne ate no rice, her rice share is zero in either model. Do not charge her simply because she joined the event.

### Claim ownership and collaboration

- Participants edit their own claims. Receipt creator or owner can propose a visible line/mode correction before settlement; affected participants accept by updating their claims and reviewing again.
- Changing an item quantity, price, eligible discount scope or payer approval invalidates affected completion flags and all financial review approvals.
- A member who consumed nothing still acknowledges that receipt. This distinguishes a genuine zero share from an unanswered question.

**v1 fairness policy**
The app implements agreed rules, not an objective fairness oracle. Display the policy before approval. Custom fractional portion weights are deferred; the reference arithmetic supports them only as future-facing test examples.

## Approve first, then settle
P0 REQUIREMENTS / REVIEW & PAYMENT

| ID | Requirement |
| --- | --- |
| FR-12 • Review | Show each member allocated cost, merchant funding, signed net, proposed edges and full breakdown. All approve the same financial version. Any financial edit resets approvals. [AT-12] |
| FR-13 • Snapshot | Freeze approved receipt/claim/charge/funding totals and transfer edges under immutable snapshot ID. Distinguish this from editable UI state. [AT-13] |
| FR-14 • Instructions | Recipient selects cash and/or uploads own QR image. Show recipient identity and instruction version. No transfer execution or automatic verification. [AT-14] |
| FR-15 • Reports | Sender reports actual partial/full repayment on a frozen edge with amount, method and optional note. Pending reports reserve capacity but do not reduce verified debt. [AT-15] |
| FR-16 • Verify/correct | Only named recipient confirms/rejects a report. Before Done, recipient can append one reasoned reversal of their own mistaken verification. No history overwrites. [AT-16/17] |
| FR-17 • Completion | Owner may mark Done only when all edges fully verified, residuals zero, and no pending reports or open disputes. A zero-debt event needs no fake payment. [AT-18] |
| FR-18 • History/access | Preserve receipt funding/consumption statements and event-net payment history. Stable financial identity survives recovery/removal. Private images, safe retention/export and audit are required. [AT-19/20] |

**Use precise balance language**
Green: “Net to receive.” Red: “Net to pay.” Zero: “Settled.” Add signs and text. A positive balance is reimbursement of money already spent, not profit or income.

## Separate funding, cost, and repayment
FINANCIAL MODEL / DEFINITIONS

| Symbol / fact | Meaning |
| --- | --- |
| Fᵢ | Money participant i actually paid to merchants across event receipts. |
| Cᵢ | Participant i’s allocated item costs, discounts and charges. |
| Nᵢ = Fᵢ − Cᵢ | Initial event net: positive receives; negative pays. |
| Rᵢ = Nᵢ + outbound − inbound | Remaining net after receiver-confirmed repayments, adjusted for authorized reversals. |
| Pending report | A claim awaiting recipient verification; reserves edge capacity but changes no verified balance. |

### Non-negotiable invariants

- For every line, allocated consumption amounts sum exactly to that line amount. For every adjustment, allocated adjustments sum exactly to its signed amount.
- For every receipt, final allocated shares equal the merchant payable total and its confirmed funding. No person’s final receipt share becomes negative.
- Sum of event funding = sum of event costs; sum of initial nets = zero; sum of remaining nets = zero.
- Settlements are transfers between participants, not new expenses or new merchant funding. Never count the same money twice.
- Every confirmed payment and reversal references the frozen snapshot, edge, sender and recipient. Retrying a request cannot create duplicate financial effects.

**Why total ÷ 9 is only sometimes fair**
Equal division works when all nine agreed to equal shares of the whole bill. With solo meals, exclusions or selective items, allocate consumption first, then proportional charges. The payer receives the other people’s shares, not their own consumption cost back.

Money is integer centavos. The reference JSON uses integer literals for Python checks; production APIs serialize decimal-string centavos. In JavaScript, use BigInt/rational operations, not binary floating-point currency or implicit Number conversions for intermediate products.

## Make “shared” an explicit choice
ITEM RULES / QUANTITY CLAIMS

| Mode | Allocation basis | Example |
| --- | --- | --- |
| Shared equal | One weight per selected consumer; line total split among them. | PHP180 rice shared by eight → PHP22.50 each; Leanne excluded. |
| Units | Whole units claimed by each member; sum claims must equal receipt quantity. | Three PHP60 rice servings → three claims of one; everyone else zero. |
| Solo | Shared mode with one consumer, or all units to one person. | Leanne’s own meal is charged only to Leanne. |

### Concurrency and incomplete claims

- Reject a units save that exceeds remaining quantity with409; keep the proposed input visibly unsaved. Serialize line updates. Existing claimants must change their own saved units; owner cannot silently reassign them.
- Partial allocations are allowed: show “2 of 3 units assigned” or “no consumers selected.” Finalization rejects under/over-allocation, including invalid imported states.
- Track receipt_version on claims. A changed receipt makes affected old claims/None acknowledgements stale; show prior selections as drafts but count only freshly accepted current-version claims.
- If participants disagree, expose the exact unresolved line. They can resolve discussion in their group chat; an in-app chat is outside scope.

### Line totals versus quantities

For a units line, allocate its exact total by claimed unit counts. If the total is not evenly divisible by quantity, centavo rounding follows the same deterministic rule. If units had different actual prices, enter separate lines instead of pretending they are identical.

**Permissions**
No participant can assign an unwanted solo meal to someone else through a changed participant ID. Organizer correction powers create visible proposals/receipt revisions; they do not grant the right to forge another participant’s approval.

## Reconcile the receipt before splitting
DISCOUNTS / TAX / SERVICE CHARGE

Use manually confirmed payable amounts. Default input is tax-inclusive line totals. An already-included VAT line is informational. A separately payable tax can be an explicit additive adjustment after manual normalization; never apply both. No automatic Philippine tax-law or discount-eligibility engine is promised.

### The photographed receipt: totals only

| Visible total | PHP | Interpretation |
| --- | --- | --- |
| Gross item total | 4,425.00 | VAT-inclusive item prices. |
| Printed loyalty reduction | 592.63 | Applied on an ex-VAT base, not directly to gross. |
| Discounted food total | 3,761.25 | Already includes VAT of PHP402.99. |
| Effective gross reduction | 663.75 | 4,425.00 − 3,761.25; requires explicit normalization. |
| Service charge | 285.45 | Use actual printed amount; do not infer a rate. |
| Total due | 4,046.70 | 3,761.25 + 285.45. |

The card-payment line records payment to the merchant; it is not another discount. Receipt guest count is metadata, not the authoritative split roster. This document does not infer actual diners or item ownership from the photo and does not reproduce the photo or personal identifiers.

### Allocation order

- Allocate gross lines first. For each discount in entered order, split its exact amount across eligible lines by remaining line value, then across that line’s consumers by remaining shares. Use largest remainder at both levels; discount cannot exceed eligible base.
- Allocate actual service proportionally to each person’s eligible post-discount item spending. Show the basis and amount.
- Apply other explicit additive charges after service using eligible post-discount item spending, excluding all charges from the basis. No silent compounding. Unsupported charge-on-charge layouts require explicit manual normalization.
- Normalize unsupported ex-VAT/discount layouts using the verified net item pool and agreed eligible scope. Show the equivalent gross adjustment and reconciliation for approval; never guess eligibility.

## Joy paid; Leanne skipped the rice
WORKED EXAMPLE / SYNTHETIC

This is a synthetic nine-person dinner, separate from the photographed receipt. Shared dishes: PHP1,800 across nine. Rice: three bowls at PHP60, shared by eight; Leanne has none. Solo meals vary. Service is PHP478, proportional to PHP4,780 item spending. Joy paid all PHP5,258.

| Person | Shared | Rice | Solo | Service | Own total |
| --- | --- | --- | --- | --- | --- |
| Joy | 200.00 | 22.50 | 350.00 | 57.25 | 629.75 |
| Leanne | 200.00 | 0.00 | 250.00 | 45.00 | 495.00 |
| Ana | 200.00 | 22.50 | 300.00 | 52.25 | 574.75 |
| Ben | 200.00 | 22.50 | 400.00 | 62.25 | 684.75 |
| Cara | 200.00 | 22.50 | 200.00 | 42.25 | 464.75 |
| Dan | 200.00 | 22.50 | 300.00 | 52.25 | 574.75 |
| Eli | 200.00 | 22.50 | 250.00 | 47.25 | 519.75 |
| Faye | 200.00 | 22.50 | 350.00 | 57.25 | 629.75 |
| Gio | 200.00 | 22.50 | 400.00 | 62.25 | 684.75 |
| TOTAL | 1,800.00 | 180.00 | 2,800.00 | 478.00 | 5,258.00 |

### What the app should show

- Joy: Paid PHP5,258.00 − Own total PHP629.75 = Net to receive PHP4,628.25.
- Leanne: Paid PHP0.00 − Own total PHP495.00 = Net to pay PHP495.00. She owes no rice cost and no service attributable to rice.
- Leanne’s service is PHP478 × PHP450 / PHP4,780 = PHP45. The same rule applies to each diner, with exact centavo rounding where needed.
- The other eight people’s totals sum to Joy’s receivable. Joy does not pay herself. Her own meal remains her cost.

**Human agreement still matters**
The group confirms whether the rice was shared by eight or consumed as individual units. AteAnne can calculate an agreed policy precisely; a receipt alone cannot tell it who ate what.

## Reduce transfers without hiding the source
EVENT NETTING / MULTIPLE RECEIPTS

| Receipt | Actual payer | Allocated cost |
| --- | --- | --- |
| R1 • PHP900 | Joy paid 900 | Joy 300; Leanne 300; Marco 300. |
| R2 • PHP600 | Leanne paid 600 | Leanne 100; Marco 500. |
| R3 • PHP400 | Joy paid 400 | Joy 200; Marco 200. |
| R4 • PHP200 | Leanne paid 200 | Leanne 200. |

| Member | Merchant funding | Own costs | Initial net |
| --- | --- | --- | --- |
| Joy | 1,300.00 | 500.00 | +800.00 receive |
| Leanne | 800.00 | 600.00 | +200.00 receive |
| Marco | 0.00 | 1,000.00 | −1,000.00 pay |

### Proposed frozen transfers

Marco → Joy PHP800.00
Marco → Leanne PHP200.00

Match debtors and creditors by stable participant-ID order, sending the minimum of the current debt and credit, then advancing the exhausted side. This deterministic algorithm settles all nets; it does not promise the mathematical minimum number of transfers.

**Receipt statements are not transfer assignments**
Show receipt-level funding, consumption and the difference separately from event-net repayment edges. Because debts are consolidated, Marco’s transfer to Joy is an event settlement, not falsely labelled as payment for one particular dish. A receipt is “included in settled event” only when the frozen event is fully settled; do not invent a per-receipt repayment status.

Changing the order of screen names must not change a frozen snapshot. Use stable participant IDs and retain the exact proposed edges through partial payments and verification.

## Every centavo has a destination
EXACT MONEY / REFERENCE FIXTURES

### Largest-remainder allocation

- For amount A and nonnegative eligible weights w: calculate exact rational share A × w / sum(w).
- Floor shares to centavos. Distribute leftovers to greatest fractional remainders; ties use stable participant ID (stable line position for line-level allocation). Zero weight always receives zero.
- For a discount, allocate its positive magnitude then subtract it from eligible shares. Ensure it does not exceed the eligible base. For service, use post-discount eligible spending as weights.
- A positive adjustment with zero total eligible weight is an error requiring an explicit correction, not a silent equal split.

| Fixture | Expected result |
| --- | --- |
| PHP1.00 / three equal people | 34c, 33c, 33c using stable tie order. |
| 1 centavo / three people | 1c, 0c, 0c; sums exactly to 1c. |
| Gross 100 / 200 / 300; discount30 eligible only first two | Post-discount 90 / 180 / 300. |
| Service57 on that discounted base570 | 9 / 18 / 30; final totals 99 / 198 / 330. |
| Leanne not a rice consumer | Rice weight0; rice share0; no rice-linked service basis. |

### Provided machine-readable examples

AteAnne_Expected_Calculations.json contains the photographed totals-only reconciliation, synthetic dinner, multiple receipts, scoped discount, rounding and repayment-state expectations. AteAnne_Reference_Calculations.py generates them and checks arithmetic assertions using only the Python standard library.

The Python helper is a reference, not the production backend. Port expected results to TypeScript tests and add real-database/concurrency tests. Its rational-weight and large-integer examples test arithmetic only; they do not expand P0 UI modes or application input bounds.

## Reported sent is not received
PAYMENT STATE MACHINE

| State / action | Verified debt effect | Who can act |
| --- | --- | --- |
| Reported / pending | None. Reserve edge capacity. | Named sender reports an actual external transfer. |
| Verified | Reduce edge remaining; update both residual nets. | Named recipient confirms exact amount received. |
| Rejected / cancelled pending | No verified effect; release reservation. | Recipient rejects with reason; sender may cancel still-pending claim. |
| Disputed | No extra credit; block closing and new reports on disputed edge. | Counterparties resolve and acknowledge; organizer cannot declare money received. |
| Verification reversed | Append correction, restore edge outstanding; original remains. | Recipient only, before Done, once, with reason. |

### Partial-payment example

Marco owes Joy PHP800. Report PHP300: verified balance remains PHP800, with PHP300 pending. Joy confirms: PHP500 remains. Later confirm PHP500: that edge settles. Marco still owes Leanne PHP200 until she confirms it. A rejected claim does not count as paid.

### Safe verification rules

- Every create/verify/reject/reverse action uses an idempotency key, event/edge locks, allowed-state checks and expected versions. A double click cannot double-credit.
- A new report must fit edge outstanding minus active pending reservations. Never allow over-reporting through concurrent requests.
- A rejection requires sender acknowledgement or counterpart resolution; while disputed, show “Resolve this before paying again” to avoid accidental double payment. Preserve the rejected report.
- Reversal means “I confirmed in error,” not a bank refund. Preserve the original verification plus one reversal. Reversed reports cannot be verified again; use a new corrected report.

**Manual verification boundary**
Cash and QR transfers happen outside AteAnne. The app records participant reports and recipient confirmations. Uploading a QR or payment screenshot is not proof of a successful transfer.

Rejected-report resolution: keep rejection immutable. Sender and recipient acknowledge the same versioned resolution: either No transfer received (close dispute, debt remains), or Correct an already-sent transfer (create a linked replacement Reported record for that same money, then recipient verifies). Do not ask the sender to transfer again. Until both acknowledge, block new edge reports; only this agreed replacement may proceed. Owner cannot substitute either acknowledgement.

## Preserve the financial history
VERSIONS / CORRECTIONS / CANCELLATION

### Before settlement

- Receipt, amount, claim, eligibility, payer or roster changes create a new financial review version and invalidate all prior approvals. Track structural, receipt and per-member claim versions separately.
- Advancing to Reviewing requires complete reconciliation and allocations. Advancing to Settling requires all current-version approvals plus current funding approvals. Lock and recompute before freezing.
- After freeze, return to review only if no payment report has ever been created for that snapshot. Retain it as Superseded and generate a new one after fresh approval; do not mutate the old snapshot.

Editing transitions: Reviewing → Allocating for claims; Allocating/Reviewing → Collecting for receipt/roster edits. A changed receipt invalidates affected claims and completion flags; current financial views exclude stale versions until reaccepted. Re-enter through phase gates. Cancellation is a separate flag, not a financial phase; outstanding verification/repayment stays available and is never forgiven automatically.

### After any payment report

A reported external payment may already have moved real money, even if unverified. V1 therefore freezes financial editing once any report exists, including rejected/cancelled reports. Do not reset a paid state to reopen a bill. Full append-only post-payment expense corrections are P1; document unresolved corrections and export the history rather than silently changing balances.

### Recover access, not a different identity

Recovery rebinds access to the same stable event participant and preserves their funding, item shares, instructions, approvals, payments and audit references. Rotate credentials and revoke old access. Organizer authority does not grant permission to impersonate a creditor. This differs from Kulayan’s disposable poll responses.

| Situation | v1 behavior |
| --- | --- |
| Participant leaves/removal | Before references, remove safely. Once referenced, deactivate/redact access without removing money from totals; outstanding obligations remain. |
| Cancelled before any report | Preserve statements; label Cancelled/Unresolved if costs or debts exist. Never claim cancellation forgives money. |
| Cancelled after a report | Keep ledger and outstanding status. Continue verification/resolution where needed; not Done or Settled. |
| Done | Read-only. Mistakes discovered afterward remain a documented v1 limitation; no silent reopen or data rewrite. |

## Make the hatian understandable
PHASE 3 / UX DESIGN

| Screen | Primary content / action |
| --- | --- |
| Event entry | Create/join code; explain trust model; name; initial intent. |
| Expense list/editor | Receipts, actual payer, exact totals, image attachment, reconciliation and entry-ready status. |
| Allocation wizard | One receipt at a time; own claims; equal/units mode; none option; remaining/conflicting quantities. |
| Review dashboard | Top net receive/pay; own cost/funding; item, discount and service breakdown; current approvals and blockers. |
| Settlement page | Frozen who-pays-whom edges; recipient QR/cash instructions; Report sent; pending vs verified totals. |
| Recipient inbox | Sender, amount, method, instruction version, reported time; Confirm received / Reject; history. |
| Receipt statement | Who funded, who consumed, charges and snapshot; links to event-wide settlement history without false dish attribution. |
| Done / recovery | Read-only totals/audit; recovery key flow; limitations, delete/export policy. |

### Visual and accessibility direction

- Warm off-white with restrained violet/coral accents. Green/red may reinforce balance direction but must be accompanied by text, signs and icons. “Net to receive” is clearer than “gain.”
- Design first for 360px screens and Messenger links. Provide sticky phase progress and a top balance summary without covering content or submit buttons.
- Use labels, keyboard focus, error summaries, sensible touch targets and reduced motion. Target WCAG 2.2 AA principles with documented checks, not an unsupported audit claim.
- Always distinguish draft/review estimates from frozen settlement amounts. Keep reported, pending and recipient-confirmed totals visibly different.

**Prototype exit**
Have three people claim a receipt and explain their service charge and amount to pay. If they cannot explain it, improve the breakdown before adding decorative polish.

## A modular monolith with private files
TECHNICAL DESIGN

| Layer | Reference choice |
| --- | --- |
| App/UI | Next.js App Router, React, TypeScript, Tailwind; mobile-first forms and server-rendered protected views. |
| Domain rules | Pure TypeScript exact-money modules; BigInt/rational calculations; transparent allocation and netting. |
| Persistence | PostgreSQL + Prisma migrations; immutable snapshot and append-only payment/audit records. |
| Input / media | Zod validation; maintained raster decoder/re-encoder such as sharp. No SVG/HTML or OCR. |
| Local storage | Private upload directory outside public/, mounted persistently. Files served only through authorized handlers. |
| Production | Node-capable host + PostgreSQL + durable private volume or private object storage adapter. HTTPS and managed secrets. |
| Checks | Vitest, real PostgreSQL integration tests, Playwright isolated browser contexts; Python arithmetic reference. |

**Request flow**
Browser → session/member authorization → validated application service → exact domain calculation + PostgreSQL transaction → safe read model. Private assets pass an event/member authorization check before bytes are served.

### Module boundaries

domain/ currency, allocate, adjustments, netting, payment eligibility; server/ sessions, event policies, transactions and queries; storage/ private image interface; app/ pages and routes; tests/ fixtures/integration/E2E; docs/ requirements and evidence.

- Pin compatible current stable package versions and keep the lockfile. Document actual Node/database/package versions.
- No microservices, message queue, model API, third-party QR viewer or bank integration is needed.
- Never send raw ORM records or storage paths to the client. Serialize money as decimal-string centavos.

## Keep identities and accounting stable
DATA MODEL / LEDGER

| Entity | Key facts / constraints |
| --- | --- |
| Event / Member | Owner member ID; phase; code hash/expiry; structural and financial versions. Member ID stable across recovery; event+actor binding unique. |
| Actor / Session / Recovery | Opaque session hash/expiry; participant recovery hash/expiry; rebind member to new actor atomically, never recreate financial identity. |
| Receipt / Line | Author, actual payer, payable centavos, version; line qty/amount/mode; normalized pricing and private asset references. |
| Adjustment / FundingAck | Type, sign, eligible line scope, order/basis; payer acknowledgement tied to receipt amount/version. |
| Claim / ReceiptAck | Member+line unique; yes consumer or unit count; member version. Per-receipt None/Finished acknowledgement and invalidation. |
| ReviewApproval | Event member + exact financial version unique. Never editable by owner on another member’s behalf. |
| Snapshot / SnapshotShare | Immutable receipt/claim/charge/funding facts, per-member costs/net; policy version and audit references. |
| SettlementEdge | Snapshot + from/to members; fixed amount; verified/pending derived from immutable reports/decisions. |
| PaymentReport / Decision / Reversal | Sender/recipient/edge, amount, method/instruction version, status/version, idempotency key. Recipient decision and single reversal audited. |
| PaymentInstruction / Asset | Versioned QR or cash option owned by member; protected storage key/content metadata, not public URL. |
| Dispute / AuditEvent | Open/resolved counterparty acknowledgements; non-sensitive operation history; no secret/QR payloads in logs. |

### Relational and transaction rules

- Foreign keys enforce event scope. Lock event then receipt/edge/member records in a consistent order; re-check phase/versions after locking.
- Uniqueness: one claim/member/line, one review/member/version, one decision/report, one reversal/verified report, one idempotency key/actor/operation.
- Referenced financial members cannot cascade away. Whole-event deletion is a separate controlled purge. Snapshot/history records are never overwritten by a UI edit.
- Use bigint, bounds and no-negative checks; server enforces cross-row conservation before finalization.

## Owner does not mean “can verify anything”
API / PERMISSION MATRIX

| Operation | Authority / server gates |
| --- | --- |
| Create/join event | Actor creates owner/member; code joins only Collecting, unexpired and under capacity. |
| Create/edit receipt | Member author or visible organizer correction; correct phase/version. Named payer separately signs funding. |
| Save claims / none acknowledgement | Self only; current receipt version; allocation mode and quantity/conflict checks. |
| Advance phases / roster lock | Owner; recomputed readiness, reconciliation, active roster and expected versions. |
| Approve review | Self only; exact current financial version and no blockers. |
| Create settlement snapshot | Owner; all approvals/current payer acknowledgements; same transaction as freeze. |
| Upload payment instructions | Self recipient; validated private asset; new instruction version. |
| Report sent / cancel pending | Named edge sender; Settling; positive amount within unreserved outstanding; idempotency. |
| Verify / reject / reverse | Named recipient; allowed state; reversal only before Done, once, required reason. Owner cannot substitute. |
| Close Done | Owner; all edges/residuals zero, no pending reports/disputes; lock and recompute. |
| Recovery | Correct member secret; atomically rebind same participant and revoke prior access. No financial deletion. |
| Read assets/statements | Same-event authorized member; QR scoped to legitimate counterparties/self; no public asset paths. |

### API contract conventions

Use routes such as /api/events, /api/events/join, /api/receipts/:id, /api/claims, /api/events/:id/review, /api/snapshots/:id, /api/payments/:id/verify and /api/assets/:id, or equivalent guarded server actions. Never accept client-calculated final amounts as authority.

Use 400 for invalid input, 401 missing session, 404 unknown/unauthorized event or asset, 409 stale state/version/conflict, 410 expired code/recovery, 413 upload limit, 429 rate limit. Return generic 500 errors with a safe request ID. Financial mutations include idempotency and expected-version fields.

## A code invites; a session authorizes
IDENTITY / RECOVERY / ABUSE

### Account-free trusted-circle baseline

- Generate a random 10-character code from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (32 symbols, about50 bits). Uppercase and normalize consistently; index its HMAC-SHA256 using a private stable JOIN_CODE_HASH_KEY. Expire after seven days or roster lock; owner may rotate.
- Use separate 32-byte cryptographically random session and personal recovery secrets. Store hashes; use HttpOnly, host-only, SameSite cookies with Secure in production. Fixed session expiry30 days, recovery expiry180 days or event deletion.
- Display personal recovery key once; remove secret fragments after a same-origin exchange. Do not put raw credentials in logs, analytics, localStorage or public URLs.
- A code does not verify real-world identity. Limit20 members; display names may collide. Separate browser profiles can create duplicates; owner resolves them before roster lock.

### Recovery must preserve the ledger

A participant’s recovery key rebinds the same stable member ID to a new browser actor, rotates its key and revokes old access for that event. Lock and consume/rotate atomically; two simultaneous redemptions cannot both win. Same-actor recovery rotates without deleting data. If the target browser already controls a different member in that event, stop and explain instead of merging identities.

Owner authority stays attached to its member identity. An owner who recovers access remains the same financial person; the app must not move Joy’s credits to a new unrelated participant. There is no silent organizer impersonation/reset of another member’s credentials in v1. With neither valid session nor personal key, recovery requires future support policy; explain the limitation.

### Server controls

- Validate Origin/CSRF, membership/self/author/payer/recipient, phase and version on every write. Scope queries to the authorized event; use no-store private responses.
- Use shared-Wi-Fi-aware database rate limits by actor/event plus a generous hashed-IP backstop. Baseline: joins60/event/hour, financial saves30/member/minute, failed code exchanges20/IP/10min; tune pilot limits.
- Use strict request-size/schema bounds, plain text, safe links and secret redaction. Never log receipt bodies or QR image data.

## QR images are payment instructions
PRIVATE FILES / RETENTION

### Uploads and viewing

- Receipt images are optional; QR images support the user’s cashless instructions. Accept JPEG/PNG/WebP only, maximum8 MB input and20 megapixels. Inspect actual bytes, safely decode, re-encode and strip metadata. Reject SVG, HTML, executable files and disguised types.
- Use random storage keys, path-safe adapters and authenticated reads. Keep files outside public/. No public bucket URLs, third-party QR preview service or cross-event access.
- Show recipient display name, chosen method and instruction version beside QR. User checks the destination in their payment app. AteAnne does not decode, validate ownership or execute the QR.
- Version instructions. Existing payment reports keep the instruction version they used; QR edits do not change approved expense amounts. Failed uploads, quota errors and cleanup must be visible and safe.

### Privacy and retention baseline

Collect only names/aliases, event data, manual financial allocations, payment reports and optionally images. Do not collect banking passwords, card details, contacts or live location. Event members can view group financial statements; this is not a private salary or banking ledger.

Keep completed events for180 days by default, then delete through a documented whole-event cleanup. Active/cancelled events with unresolved obligations must not be silently called settled or auto-purged on the same schedule: show the owner an in-app retention notice, export option and explicit unresolved-event deletion decision. Daily cleanup removes expired sessions and abandoned unreferenced uploads.

Whole-event deletion requires owner confirmation and, after any payment report, current member approvals of deletion; it destroys history, not debt. Explain that exported records and backups may persist. Initial backup retention target: seven days, encrypted and access controlled. Deactivation or recovery never erases one person’s financial references.

Provide an authenticated JSON/CSV event statement export: receipt funding/consumption, frozen shares/edges and report decisions. Exclude raw credentials, QR/receipt image bytes and public asset URLs. Identify it as the app’s manual record, not a bank statement.

**Portfolio privacy**
Use synthetic demo data only. Do not distribute the provided receipt photo, personal QR codes, loyalty identifiers or payment proof. The package uses only visible receipt totals for a manually checked arithmetic example.

## Deliver working vertical slices
PHASE 4 / IMPLEMENTATION

| Milestone | Work / exit evidence |
| --- | --- |
| M0 • Foundations | Inspect repo; stable versions; DB/migrations; identity/guards; exact currency/allocation unit tests. Two actors and two events isolated. |
| M1 • Collect | Event/code, receipts, actual payer acknowledgement, pricing reconciliation and private receipt images. Real data survives refresh. |
| M2 • Allocate | Receipt wizard, equal/units claims, None, progress/conflicts, lock roster. Concurrent unit claims cannot overallocate. |
| M3 • Review | Financial versions and approvals, item/charge explanation, immutable snapshot, deterministic net edges. Reference fixtures match. |
| M4 • Settle | Versioned QR/cash, reports/reservations, recipient decisions, partial payments, audit reversal, dispute/Done gates. |
| M5 • Polish | 360px/keyboard/error states; file security; recovery preserving ledger; synthetic demo and direct permission tests. |
| M6 • Release | CI, production build/container, storage config, migration/cleanup, backup/restore/rollback, pilot and case-study docs. |

### Development discipline

- Keep the app runnable after each slice. Build migrations, authorization and meaningful tests alongside behavior. No fake primary buttons or localStorage-only receipts.
- Use independent claim/receipt versions for concurrent users and a financial version for approvals. A routine save should not produce unrelated guest conflicts, but must still invalidate old review approvals if money changes.
- Maintain a requirement-linked backlog, docs/decisions.md and docs/handoff.md. Distinguish implemented from verified.
- Prepare human-research templates and continue engineering if no pilot is available; do not fabricate observations.

**Suggested package scripts**
dev, lint, typecheck, test:unit, test:integration, test:e2e, build, start, db:migrate, db:seed, data:cleanup. Use an isolated test DB/storage directory; destructive seeds refuse production by default.

## Prove the money and permissions
PHASE 5 / VERIFICATION

| Level | Meaningful checks |
| --- | --- |
| Pure domain | Port supplied fixtures; currency parsing, exact allocation, discount scope, charge bases, rounding, netting and payment residuals. Add generated conservation checks. |
| PostgreSQL integration | Constraints, transactions, code capacity, per-member versions, approvals/snapshot freeze, concurrent claims, reservation/verification races and recovery. |
| Browser E2E | Owner + at least two isolated guests: create/join → expenses → claims → review → frozen edges → partial payment → recipient confirm → Done. |
| Security/files | Modified IDs and direct owner/recipient calls; cross-event assets; invalid MIME/size/pixels; secret redaction; session/recovery expiry. |
| UX/accessibility | 360px and desktop; keyboard labels/focus/errors, text+color balances, low-bandwidth/error states, image-upload failure and reliable copying. |
| Release | Fresh setup, lint/types/build, production-mode flow, DB+file backup restore, cleanup safety and compatible application rollback. |

### Reference checks included with this pack

Run python AteAnne_Reference_Calculations.py in a folder with the companion fixtures. It checks arithmetic examples and rewrites the expected-calculations JSON. Read its assertions; it does not prove authentication, storage safety, bank transfers or application correctness.

### Evidence rules

- Use a real PostgreSQL database for integration checks and a separate private upload directory. Mocking ORM success is insufficient.
- Test dishonest direct requests, not just hidden buttons. Verify both changed balances and unchanged balances after rejected/pending reports.
- Record exact commands, actual output, environment and artifact paths. Do not invent test results, deployment URLs or performance measurements.
- Report what cannot be checked in the current environment, and complete all independent local checks. Real receipts/payments require consenting human validation.

## Financial correctness release gates
ACCEPTANCE MATRIX / PART 1

| ID | Required evidence |
| --- | --- |
| AT-01 | Create/join persistent event; limits enforced; one simple soft-drinks/chips split works. FR-01. |
| AT-02 | Code cannot grant owner/recipient authority; closed/expired/rotated codes and two event isolation work. FR-02. |
| AT-03 | Payer may also owe; person may consume nothing but fund a receipt; pending funding not credited. FR-03/05. |
| AT-04 | Receipt equation reconciles; VAT/discount/card-line example does not double count; payer acknowledgement tracks receipt version. FR-04/05. |
| AT-05 | Roster/entry gate only advances on complete current records; no new joins after lock. FR-06. |
| AT-06 | None differs from unanswered; every member completes each receipt; progress persists. FR-07. |
| AT-07 | Solo/equal/units and Leanne rice exclusion match examples; stable centavo rounding. FR-08. |
| AT-08 | Concurrent claims never finalize too many units; unassigned/conflicting lines block review; no silent edits to other claims. FR-09. |
| AT-09 | Scoped discount applies only eligible lines; negative payable shares and zero service basis are rejected. FR-10. |
| AT-10 | Actual service split follows adjusted eligible spending; each charge/discount sums exactly. FR-10. |
| AT-11 | All receipt totals/funding/shares reconcile; event initial and residual nets sum zero; supplied fixtures match. FR-11. |

**Generated checks**
Generate many valid nonnegative amount/weight cases. Assert exact sum preservation, no allocation to zero weight, deterministic ties, no negative receipt totals and full settlement of every computed net. Do not claim generated tests prove every possible case.

## Workflow, safety, and Done
ACCEPTANCE MATRIX / PART 2

| ID | Required evidence |
| --- | --- |
| AT-12 | All approve same financial version; one edit invalidates prior reviews; owner cannot approve for another. FR-12. |
| AT-13 | Snapshot/edges immutable; reopening only before any report; old snapshot preserved; existing money never reset. FR-13. |
| AT-14 | QR/cash works; recipient/instruction version visible; private assets protected across events. FR-14. |
| AT-15 | Pending report leaves verified balance unchanged, reserves capacity; partial payments and retry idempotency work. FR-15. |
| AT-16 | Sender/owner cannot verify another recipient’s claim; concurrent/double confirmations never over-settle. FR-16. |
| AT-17 | Reversal recipient-only, reasoned, single-use and before Done; original history remains; rejected/disputed edge blocks unsafe retry. FR-16. |
| AT-18 | Done requires zero edges/residuals, no pending/disputes; zero-debt case needs no fake report. FR-17. |
| AT-19 | Recovery/deactivation preserve financial identity, credits, shares and payment audit; cross-event access denied. FR-18. |
| AT-20 | Private image format/size/scope controls, correct receipt vs net-transfer history, retention/deletion policy. FR-18. |
| AT-21 | 360px/keyboard/status direction, persistence/restart, fresh setup/build, restore/cleanup and accurate docs. All P0. |

### Engineering definition of done

- All P0 workflows use real persistence and have evidence. Required lint, types, tests and production build pass; deployment limitations are stated.
- No accepted exceptions for unauthorized financial actions, misallocated centavos, double-counted charges, lost history or false paid/completed states.
- README commands work from fresh setup; secrets and real private images are absent; production storage and recovery procedures are explicit.
- Engineering delivery and real-world pilot validation are reported separately. A polished dashboard alone is not a finished expense app.

## Persist the database and the images
PHASE 6 / DEPLOYMENT & RECOVERY

### Production prerequisites

- Node-capable host, persistent PostgreSQL, HTTPS and private durable uploads volume or private object storage. A stateless/ephemeral filesystem cannot preserve uploaded receipts/QRs.
- Separate dev/test/production DBs and file stores. Variables: DATABASE_URL, APP_ORIGIN, JOIN_CODE_HASH_KEY, PRIVATE_UPLOAD_DIR or adapter settings, NODE_ENV and cleanup-job authorization. Generate stable local secrets during setup; keep values out of source.
- Check current host/database/storage pricing and limits before provisioning; do not guarantee a free production tier. Local development needs no paid integration.
- Migrations run as a controlled release step. Apply compatible changes; seed only synthetic development/test data. Build CI gates for lint/types/unit/integration/build and E2E where supported.

### Release and smoke test

Back up first. Deploy to an authorized target, verify secure cookies/no-store responses, create a synthetic event over HTTPS, test cross-user claim/review/payment verification and private asset reads, then delete the synthetic event. Record actual URL/commit/status; if no target is configured, deliver build/container and exact instructions with “not deployed.”

### Backup, restore and rollback

- Back up PostgreSQL and private files together with a manifest linking asset keys. Initial target: daily encrypted backups, seven-day retention, up to24-hour recovery point and one working day recovery. Targets are not service guarantees.
- Restore into isolated DB+storage, run conservation and asset smoke checks, then switch configuration. Preserve payment audit and reapply approved deletion records.
- Rollback app to a schema-compatible known-good release. Do not assume reversing a migration can undo real financial history. Never recompute frozen settlements during restore.
- Document backup access, scheduled cleanup, storage quotas, error alerting and safe redacted logs. Rehearse restore before trusting it.

## Test with small real groups
PHASE 6–7 / PILOT & MAINTENANCE

### Pilot plan

- Start with one consenting group and a low-value real shared purchase, then 3–5 groups if the workflow is understandable. Do not automatically contact people or collect real banking credentials.
- Use one equal shared receipt, one dinner with solo/shared items and service, and one event with multiple payers on separate receipts. Compare against an agreed manual calculation.
- Explain code sharing, browser/recovery limitations, manual payment verification and the freeze-after-report policy before money is reported.
- Observe allocation completion, review disagreements, explanation clarity, time to verified settlement and whether contributors can find outstanding amounts.

| Measure | Definition / caution |
| --- | --- |
| Allocation completion | Members finished all receipt acknowledgements / locked roster count. |
| Review friction | Edits/review resets and unresolved lines; ask what was confusing. |
| Financial accuracy | App output equals agreed manual reference to the centavo; record policy disagreements separately. |
| Settlement progress | Verified edge amount / total proposed transfers; pending claims remain separate. |
| Repeat use | Real groups/organizers who start a second event; exclude seeds/demo. |

### Maintenance rhythm

During pilot: review access/money bugs immediately. Weekly: triage defects, verify cleanup/backup/storage quotas and review user friction. Monthly: update dependencies, check decoder security, rehearse restore after material changes and review costs. Preserve audit history through migrations.

**Honest evidence**
Small-group use provides design feedback, not proof of broad demand. Report actual sample sizes and unknowns. Never invent money saved, faster repayment, payment receipts or bank verification.

## Explain the engineering choices
RISK REGISTER / PORTFOLIO HANDOFF

| Risk | Mitigation |
| --- | --- |
| Fairness policy disagreement | Show equal/units, exclusions, discount scope and charge basis before approval; calculation is not an opinion judge. |
| Data entry / tax confusion | Mandatory reconciliation and exact totals; manual normalization; included tax/card lines never auto-added. |
| False payment reports | Recipient-only verification, visible pending, idempotency, dispute path and immutable audit. |
| Late bill correction | Reset reviews before settlement; no financial reopen after any report in v1; state limitation clearly. |
| Lost access / member removal | Stable member ID and personal recovery key; never erase ledger references. |
| Sensitive image exposure | Private authenticated storage, safe decoding, no public/demo copies or cross-event reads. |
| Scope or cost growth | P0 milestones, no bank/OCR/AI integration, explicit production storage/cost checks. |

### Required handoff artifacts

README with actual setup/scripts/versions; docs/requirements.md with FR/AT traceability; architecture with ER/state/payment diagrams; financial-rules.md and ported fixtures; decisions; actual test report; deployment/storage/backup/restore/rollback; privacy/recovery/retention; pilot guide; portfolio-case-study template; handoff status and exact next steps.

### Portfolio story

- Show the problem: equal division can overcharge someone who skipped an item. Demonstrate Joy/Leanne with clearly synthetic data.
- Explain exact-centavo allocation, proportional service, funding versus consumption, event netting and recipient-only verification. Include a real defect/feedback-driven improvement when available.
- Show tests, state/permission diagrams, a brief demo and actual deployment status. Keep personal receipts/QRs out of public screenshots.
- Describe limitations honestly: one payer per receipt, manual data/verification, trusted-circle identity, and deferred post-payment bill corrections. Keep Kulayan and the commute guide separate.

**Using the implementation prompt**
Attach this PDF and the calculation fixtures to your coding AI, then paste the complete companion starter prompt. It should implement and verify the whole engineering workflow. Research, real bank transfers and pilot observations remain human tasks; the AI must not fabricate them.

## Starter prompt
APPENDIX / FULL COPY-READY IMPLEMENTATION PROMPT

You are my senior full-stack engineer and careful financial-domain implementation partner. Build ATEANNE using the attached “AteAnne — Full SDLC & Financial Specification, v1.0” PDF. Read the whole PDF and its requirement IDs, arithmetic rules, lifecycle, permission matrix and acceptance checks. Also read the supplied expected_calculations.json and reference_calculations.py. Deliver a working persistent application, tests, and documentation. Do not stop after a plan, frontend mockup, or scaffold.

PRODUCT CONTEXT
AteAnne is a Filipino pun on “hatian,” splitting a bill. It is my standalone shared-expense portfolio project for friends in Lucena City. Kulayan, the planning tracker, and the Lucena commute guide are separate projects: do not merge their repositories, databases, navigation or deployments into this app. The app needs no AI, OCR, bank API, payment processing, QR decoding service, email delivery or paid external service to work locally.

The central distinction is WHO PAID versus WHO CONSUMED. Someone can both contribute money and owe money. “Will pay only” and “I paid an expense” are initial intentions, not exclusive roles. A reimbursement is not income, a new expense, or another merchant contribution. For v1, support one actual payer per receipt and many receipts with different payers. Defer multiple funders on one receipt and pooled advances. Receipt creator and actual payer may differ, but the named payer must approve their funding amount before settlement.

FIRST ACTIONS
Inspect the workspace, repository, existing edits and applicable AGENTS.md. Preserve unrelated work. Confirm you can read the attachments; do not claim to have read an unreadable PDF. Use the editable SDLC companion if provided. Briefly summarize the product, assumptions and exclusions, then create docs/requirements.md with the PDF IDs, docs/implementation-plan.md, and docs/decisions.md. Make reasonable routine choices and begin implementing immediately after the brief plan. Ask only about information that blocks dependent work and keep useful independent work moving. Do not ask permission at every milestone or invent research/pilot evidence. Keep progress and a handoff file current across sessions.

REFERENCE STACK
For a new repo use Next.js App Router, React, TypeScript, Tailwind, PostgreSQL, Prisma, Zod, Vitest, Playwright, and a maintained server image-decoding/re-encoding library such as sharp. Resolve compatible current stable versions, keep a lockfile, and record actual versions. Keep exact financial logic as pure TypeScript functions using BigInt/rational arithmetic internally, not floating-point money. Transport money as decimal-string centavos in JSON; use PostgreSQL bigint. Keep server authorization and read-model projections separate from UI. Use Docker Compose for local PostgreSQL and a private persistent uploads directory outside public/. Provide .env.example, migrations, synthetic fixtures, tested scripts and an equivalent non-Docker database option. Respect a justified established stack instead of rewriting it unnecessarily.

PHASES AND CORE FLOW
1. COLLECTING: organizer creates an event such as Pool Party or Dinner, receives a random shareable join code, and participants join with a display name and secure browser identity. Show intent choices, but any member can later pay and consume. Enter merchant receipts manually: items, quantities, actual line totals, one actual payer, discounts/charges, exact payable total, optional private photo. Soft drinks and chips can be shared; solo meals can belong to one person. Optional receipt images are supporting evidence, never OCR-derived truth. Each roster member marks expense entry complete; all receipts must reconcile and payers acknowledge funding. Lock the explicit roster before allocation. A code being forwarded does not tell us who joined.
2. ALLOCATING: guide each member through every receipt. They claim their own consumed items or explicitly select “I got nothing from this receipt.” Support shared-equal items among selected consumers and quantity-based items with whole-unit claims. Reject an over-quantity save as409 and show it unsaved; incomplete under-allocation is allowed during drafting but blocks review. Three rice servings may be assigned to three consumers by units, or treated as a shared line among eight people if that is what actually happened. Leanne receives zero rice allocation when she ate none. No participant may silently edit another’s claims. Unclaimed items, stale receipt-version claims, incomplete answers and disputes block review. An organizer can propose visible corrections; affected people must accept/edit their own claims and then review.
3. REVIEWING: show each person item shares, discounts, service charge, total allocated cost, merchant funding, proposed transfers, and top summary “Net to receive,” “Net to pay,” or “Settled.” Use green/red only alongside text and signs. All roster members approve the same current financial version; named payers also approve their funding. Any financial edit increments that version and invalidates all approvals. The final review uses server-recomputed values, not client totals.
4. SETTLING: freeze an immutable approved snapshot and deterministic event-wide transfer edges. Members may upload their own payment QR image or choose cash. The app displays payment instructions; it does not move money or verify a bank transaction. Sender reports an actual partial/full transfer with recipient, amount, method and optional note. “Reported sent” remains pending until the named recipient confirms receiving the amount. Recipient may reject a claim; pending/rejected reports do not reduce verified debt. Pending reports reserve capacity to prevent duplicate reporting. Confirmation is recipient-only, atomic and idempotent. Store per-transfer and per-receipt statements separately; event-wide netting does not imply that a particular transfer paid for a particular dish.
5. DONE: allow closing only when all frozen transfer edges are fully receiver-confirmed, every residual balance is zero, and there are no pending reports, open disputes or unreversed accounting inconsistencies. No automatic completion from a sender click or elapsed time. Completed events are read-only. A self-funded zero-debt event can finish after approved review, with no fake payment records.

EXACT FINANCIAL RULES
Follow the PDF and fixtures, and preserve these invariants at every finalized snapshot:
• Every item’s allocated shares sum to its exact entered amount.
• Every discount/charge allocation sums to its exact amount; no unsupported discount can create negative payable shares.
• Each receipt’s allocated total equals its merchant payable total and confirmed payer funding.
• Per-person net = merchant funding minus allocated cost. Sum of all nets is zero.
• Remaining net = initial net + receiver-confirmed outbound repayments minus receiver-confirmed inbound repayments, including approved reversal effects. Pending claims have no verified financial effect.

Allocate line items first. For each approved discount, allocate its amount to eligible lines by remaining value, then to each line’s consumers by remaining shares, using largest remainder at both levels. Next allocate service charge proportional to each person’s eligible post-discount spending. Other additive charges use that same eligible item-spending basis and do not compound on charges. Zero eligible spending means zero proportional service. If a positive charge has zero allocation basis, block finalization and ask for an explicit supported correction; never silently split equally. Apply largest-remainder allocation in integer centavos: floor exact shares, then distribute leftover centavos by greatest remainder with stable participant ID tie-breaking (line position for tied line-level allocations). Never round each person independently and lose or invent money. Do not promise mathematically minimal transfer count; use the PDF’s deterministic matching rule and freeze the resulting edges.

The supplied photographed receipt is a RECONCILIATION EXAMPLE ONLY. Visible totals: gross items PHP4,425.00; discounted VAT-inclusive food total PHP3,761.25; service PHP285.45; total due PHP4,046.70. The printed PHP592.63 discount is on an ex-VAT base; the equivalent gross reduction is PHP663.75. VAT PHP402.99 is already included in the food total, and the card-payment line is not a discount or new charge. Use the exact printed service amount, not an inferred percentage. Do not infer actual diners, food ownership or allocations from the photo. Label the separate nine-person Joy/Leanne calculation fixture as synthetic. Manual tax/discount normalization must be explicit and reconciled; no automatic statutory tax/discount eligibility engine.

VERSIONING AND CORRECTIONS
Use independent event structural version, receipt version, member claim version, financial review version, and immutable settlement snapshot ID. A routine partial claim save must not force unrelated members into constant stale errors; use per-member versions and lock/check the shared receipt/event gates correctly. Every financial edit invalidates review approvals. Entering settlement freezes that snapshot. Reopen is allowed only before any payment report has ever been created for that snapshot; preserve the old snapshot as superseded. Once any real payment is reported, financial edits are frozen in v1, even if the report is pending or later rejected. Do not reset confirmed money or erase history to correct a bill.

Before Done, a recipient may correct their own mistaken verification using a separately authorized append-only reversal with a required reason. Preserve the original report and verification, reverse that payment once, and reopen the same edge’s outstanding amount. A reversal is an accounting correction, not a bank refund. Sender-only cancellation applies only to still-pending reports and never reverses a verified receipt. Keep rejection immutable; both counterparties must acknowledge the same versioned resolution: no transfer received (debt stays), or correct an already-sent transfer via a linked replacement Reported record for the SAME money, then recipient verifies it. Do not ask for another external transfer. Block new edge reports while disputed except that mutually agreed replacement. After Done, do not silently reopen or rewrite records; document the v1 correction limitation. Reports, reversals and disputes remain auditable. Cancellation is an overlay flag that preserves the financial phase; unresolved balances are never treated as settled.

IDENTITY, AUTHORIZATION, RECOVERY AND PRIVACY
The event code only permits joining during Collecting. Generate the PDF’s random unambiguous code, index a HMAC-SHA256 protected hash under stable JOIN_CODE_HASH_KEY, expire/rotate it, rate-limit failed exchanges and capacity checks, and close joins when the roster locks. Generate necessary local secrets in setup without external service credentials. Establish separate high-entropy opaque device/session and participant-recovery credentials. Store only hashes, use HttpOnly/SameSite cookies (Secure over production HTTPS), and enforce owner/member/self/receipt-author/actual-payer/recipient permissions on the server. Never authorize by display name, member ID or event code alone. Use strict schemas, origin/CSRF protection, safe plain-text/URL rendering, request limits, redacted logs and no-store caching for private data.

Financial identity is stable. Recovery rebinds credentials to the SAME event participant and revokes old access; it never erases or reassigns that person’s item shares, merchant funding, QR history or confirmed payments. Organizer authority is checked separately and cannot impersonate a payer or recipient. A participant referenced by the ledger cannot be cascaded away on withdrawal/removal. Do not copy Kulayan’s private-ballot-erasure recovery behavior. Explain the trusted-circle/duplicate-browser limitations. No public event directory, receipt links, QR previews, bank credentials or group-contact imports.

Receipt and QR images must remain private authenticated assets outside public/. Accept only documented raster formats and size/pixel limits; inspect bytes, decode/re-encode, strip metadata, randomize storage names, and protect against cross-event reads/path traversal. Serve only to authorized event participants, with QR instructions scoped to valid counterparties where appropriate. Handle failed uploads/deletion and storage limits. QR changes do not change financial review approvals, and old payment reports retain their payment-instruction version. The real photo and personal identifiers must not be embedded in demo data or the public portfolio.

IMPLEMENTATION AND VERIFICATION
Build vertical slices: M0 foundations/identity/exact-money tests; M1 event/join/receipts/reconciliation; M2 allocation wizard/conflicts; M3 versioned review/frozen snapshot/net transfers; M4 QR/cash/payment reporting/recipient verification/partial payments/reversal/completion; M5 responsive/accessibility/security/files polish; M6 release, backup/restore, cleanup and portfolio docs. Keep the app usable after each slice. Provide exact scripts for dev, migration, seed, unit/integration/E2E tests, lint, typecheck, build and production start. Never seed/reset production by default.

Run the reference Python assertions and port the expected fixtures into real TypeScript tests. Add generated conservation tests for allocation, discounts, service and netting. Use real PostgreSQL integration tests for constraints, snapshot approval, concurrent quantity claims, double confirmation, idempotency and over-reporting reservations. Playwright must use isolated organizer/guest contexts from event creation through unequal item claims, review, QR/cash instructions, partial reports, recipient confirmation and Done. Test a payer who also owes, a person who consumed nothing on one receipt, rice exclusion, zero-cost/unknown allocation basis, unrelated event access, lost-device recovery preserving financial identity, protected images, reversed verification, no financial reopen after any report, and persistence after refresh/restart. Verify 360px layout, keyboard access, labels/focus, text balance direction and reduced motion. Record actual commands/results; never fabricate passed tests, bank verification, deployed URLs, research or adoption metrics.

DELIVERY AND FINISH LINE
Deliver the working app, migrations, synthetic seed data, financial fixtures, .env.example, README, requirements traceability, architecture/ER/lifecycle diagrams, decision log, test report, privacy/retention rules, recovery limitations, release/storage/migration/backup/restore/rollback runbooks, pilot guide and an honest portfolio case-study template. Production requires Node, persistent PostgreSQL, HTTPS and durable PRIVATE image storage; do not deploy uploads onto an ephemeral filesystem. If an authorized target and credentials are already available, deploy and smoke-test. Otherwise finish the tested local app and production build/container/configuration, state what is missing and provide exact deployment instructions. Do not provision paid resources or message people for me.

Finish by reporting what works, how to run it, verified test results, deployment status, known limitations and the remaining human pilot tasks. The engineering finish line is a persistent complete core workflow with reconciled calculations and recipient-verified settlement—not just an attractive dashboard. Begin by reading the attached PDF and fixtures, inspect the workspace, then implement.
