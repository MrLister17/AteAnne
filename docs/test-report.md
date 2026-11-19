# Test report

## Sprint S10 — mixed currencies, rate of the day bought (v0.9.0, 2026-11-19 Manila)

Branch `claude/admiring-albattani-yinlr3` from `main` `bb1993f` (v0.8.0). The owner approved every S10 decision (D58–D62). Local Linux run: Node 22.23.5, PostgreSQL 16 (local cluster, isolated `ateanne_test`), pre-installed Playwright Chromium. Synthetic data only; exchange rates come from the fake provider (`FX_RATES_FAKE=1`: PHP 65 / THB 40 per euro, so 1 THB = 1.625 PHP). Before any change, the v0.8.0 baseline passed 240 unit and 64 integration tests in this container.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS, no fixture diff |
| `npm run lint` | Passed (exit 0) |
| `npm run typecheck` | Passed |
| `npm run test:unit` | **12 files, 258 passed** (+18 in `currency.test.ts`) |
| `npm run test:integration` | **13 files, 74 passed** (+10 in `currency.test.ts`; `corrections.test.ts` export key renamed `amountPhp` → `amount`) |
| `npm run build` | Passed |
| `npm run test:e2e` | **75 passed in one full run (2.2 min)**, iPhone 15 + 360px (+4: `currency.spec.ts` in both projects) |

The table above is from the final run on the release commit; the same chain had also passed once before the last two changes (peso-only events skip rate queries; the currency list left the payload).

### Measurements (`npx tsx scripts/measure-db.ts`, local, synthetic peso event: 10 people, 10 receipts × 8 lines)

| Operation | SQL statements v0.8.0 → v0.9.0 | Max pool connections | JSON bytes v0.8.0 → v0.9.0 |
| --- | --- | --- | --- |
| Open event (step 1, member) | 17 → 17 | 3 → 3 | 113,040 → 118,229 |
| Save claims (step 1) | 57 → 57 | 3 → 3 | — |
| Open event (step 2, organizer) | 17 → 17 | 3 → 3 | 166,400 → 176,205 |
| Report a payment | 24 → 24 | 1 → 1 | — |
| Confirm a payment | 22 → 22 | 1 → 1 | — |

Peso-only events run no rate queries and no rate fetches: the statement counts are unchanged, and an integration test checks that the fake provider isn't called. The JSON grows by about 5–10 KB, from the new per-receipt fields (`currency`, `purchasedOn`, `rate`, `settlePayable`) and the per-receipt `settleShares`.

### What the new tests check

- **Unit (`currency.test.ts`):**
  - formatting and parsing for two-decimal and zero-decimal currencies; the existing `PHP 495.00` format is unchanged
  - Manila days
  - exact decimals, with float input refused
  - 8-significant-digit half-up rounding
  - the plan's numbers: THB 1,397.00 → PHP 2,270.13; shares 1,135.07 / 1,135.06; Ana pays Mark PHP 835.06
  - yen conversion
  - stale and missing rates refused
  - `ReceiptConverter`: no rate gives exactly the old result, and money is conserved over 600 generated receipts and 4 rates
  - `ForeignPayment`: THB 512.31 clears PHP 835.06; partial payments; more than the full amount refused; snap to capacity; never above capacity for tiny, normal and yen rates
- **Integration (`currency.test.ts`, real PostgreSQL):**
  - a mixed ₱/฿ event freezes with policy v3, and the facts carry currency, day, rate 1.625 and converted shares
  - a purchase date in the future is refused
  - a missing rate never guesses: the freeze blocker says "Waiting for the … THB exchange rate", and the daily job freezes the bill once the rate is back
  - peso-only events fetch no rates
  - paying in baht: wrong rate day → `rate_changed`; wrong credit → "counts as PHP 835.06"; too much → "At most THB 512.31"; replay is idempotent; the receiver sees `paid`; confirm settles it; CSV/JSON currency columns
  - a ฿ + ₱ mix settles to zero
  - accepted currencies are enforced; with no rate, other currencies are refused while paying in the settle-up currency still works
  - a replacement reuses the original rate
  - settle-up currency rules: organizer only, Add & claim only, after a correction allowed, refused once a payment was reported
  - creating an event in THB
- **E2E (`currency.spec.ts`, both phone sizes):**
  - Mark types *Breakfast* in THB bought yesterday; the list shows THB 1,397.00 and PHP 2,270.13; the receipt shows "Counts as PHP 2,270.13 · 1 THB = 1.625 PHP"
  - after the freeze, Ana's Home shows PHP 835.06; **Show totals in → ฿ THB** shows "≈ −THB 513.88" with PHP 835.06 underneath, in both the banner and the header, and the choice survives a reload
  - Pay in **Thai baht** → "Send THB 513.88" → the sheet shows "Counts as PHP 835.06" → **I sent THB 513.88**
  - Mark sees **Did THB 513.88 from Ana arrive? · Counts as PHP 835.06 · 1 THB = 1.625 PHP** → **Yes, I got it** → "PHP 835.06 received"
  - no sideways scroll
  - a peso-only event shows no currency switch
- **Unchanged:** every v0.8.0 browser test passes unchanged, so peso events look and behave as before.

Screenshots (local, ignored folder): `test-results/screens/s10-editor-*.png`, `s10-home-baht-*.png`, `s10-pay-in-baht-*.png`, `s10-receive-baht-*.png`.

### Not verified locally

- **The live ECB fetch.** This container's proxy refuses `api.frankfurter.dev` (403 on CONNECT). Production `/api/health` now fetches today's rate and reports `fx`; see the release notes below.
- **A real iPhone and real relatives.**

## Sprint S9 — Claim → Pay → Done, lighter storage (v0.8.0, 2026-11-19 Manila)

Branch `claude/stoic-mendel-qflc6n` from `main` `720e6f7` (v0.7.1). Owner approved the S9 plan with every recommended decision (D53–D57). Local Linux run: Node 22.23.5, PostgreSQL 16.15 (local cluster, isolated `ateanne_test`), pre-installed Playwright Chromium. Synthetic data only. Before any change, the v0.7.1 baseline also passed lint, typecheck, 92 unit and 49 integration tests in this container.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS, no fixture diff |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run test:unit` | **11 files, 240 passed** (92 before; +148 in `next-action.test.ts`, of which 128 are the "never an empty wait" matrix; `reminders.test.ts` rebuilt) |
| `npm run test:integration` | **12 files, 64 passed** (new: `payments-flow`, `rate-limits`, `database-security`; image tests rewritten) |
| `npm run build` | Passed |
| `npm run test:e2e` | **71 passed in one full run (2.1 min)**, iPhone 15 + 360px (new: `next-step.spec.ts`, `feedback.spec.ts`, both projects) |

**Regression proof for D57:** with `ReceiptService`, `PaymentService`, `RateLimiter` and `HttpError` temporarily restored to v0.7.1, the new one-connection test failed with `Error: timeout exceeded when trying to connect`; with the S9 code it passes.

### S9.4a measurements (local, synthetic; production not yet measured)

`npx tsx scripts/measure-db.ts`: 10 people, 10 receipts × 8 lines, 9 transfers, 9 payment reports. Times are one local run each and vary by a few ms between runs; statement and connection counts are exact.

| Operation | SQL statements before → after | Max pool connections at once before → after | JSON bytes before → after |
| --- | --- | --- | --- |
| Open event (step 1, member) | 17 → 17 | 3 → 3 | 112,190 → 113,040 (+`next`/`group`) |
| Save claims (step 1)¹ | 57 → 57 | 3 → 3 | — |
| Open event (step 2, organizer) | 17 → 17 | 3 → 3 | 164,542 → 166,400 |
| Report a payment | 24 → 24 | **2 → 1** | — |
| Confirm a payment | 22 → 22 | 1 → 1 | — |

¹ The measured step also opens the event first (to read versions); Prisma loads its relations in parallel, which is where the 3 connections come from. The write itself no longer takes a second connection.

Polling from one open phone (`next start` build, 120 s visible, then one "return to the app"): **before 8 GETs + 2 on return; after 8 GETs + 1 on return.** On a Done event the new `feedback.spec.ts` sees **0** GETs in 60 s. Event payload size and query count per poll are unchanged: lighter polling (ETag/304, lazy Activity) is follow-up F2, pending production numbers.

Production read-only SQL (storage by image type, table sizes, scans, busiest statements, connections, RLS/grants) is in `runbooks.md`; **not run yet** (needs the owner's Supabase access).

### What the new tests check

- `next-step.spec.ts`: after "2 of 2 confirmed", Ana sees **Did you pay for anything else?** with exactly one primary button in view at 360×640, the share once, lines behind **See items**; then **You're done for now · Waiting for Mark to tap Everyone's here.**; Mark sees **Is everyone here?**; Everyone's here freezes the bill (**Bill frozen. Time to pay.**); **How should Ana pay you?** → details; **Pay Mark PHP 698.50** with the dot on Pay; a ₱400 partial (**Sent PHP 400.00 · Waiting for Mark**, **PHP 298.50 left**); Mark's card updates by itself to **Did PHP 400.00 from Ana arrive?**; **Yes, I got it**; **Mark got PHP 400.00 so far.**; **It didn't arrive** asks why in a sheet and leads to **Sort this out with Ana**.
- `feedback.spec.ts`: "Saving…" while a save is held, one request for a double tap, **Couldn't save. Try again.** beside the button with picks kept, retry succeeds; Reduce Motion shows a static "…" and no running animations; first-load skeleton text, **Try again** after 10 s and after a 500 (not "isn't a member"); failed manual refresh shows **Couldn't refresh** and the stale line; one GET on return; none once Done.
- Integration: confirmation-only payments with exact centavos (partial, dispute, record again, done gate); receipt photo upload → 410 with zero new `Asset`/`AssetBlob` rows; legacy photo readable by members, 404 for others, removable, purged at 30 days; RLS on every table; limits ON: one-connection pool works, 31st save → 429 "Try again in 1 minute", 21 wrong codes → 429 and **no** new `Actor`/`Session` rows, wrong recovery key creates nothing, `Retry-After` header.

Screenshots (local, ignored folder): `test-results/screens/s9-*.png`, `30-home-organizer.png`, `31-home-member.png`.

### Release

- GitHub CI run [44452776502](https://github.com/MrLister17/AteAnne/actions/runs/44452776502) on `1557289`: every step passed (reference, lint, typecheck, unit, integration, build, Playwright install, E2E).
- `main` fast-forwarded `720e6f7 → 1557289` with the owner's approval. Production `GET /api/health` at 03:48:24 UTC: `{"ok":true,"version":"1557289","receiptScan":"groq"}`, `Cache-Control: no-store`.
- Production smoke (Playwright, iPhone 15 emulation, organizer light + member dark, synthetic event **"S9 smoke (synthetic)"**):
  - receipt photo upload → **410 `receipt_photos_off`**
  - Ana's Claim: `Your share PHP 698.50`, `Everyone confirmed (2 of 2)`, Next card **Did you pay for anything else?**
  - after **I'm done adding receipts**: **You're done for now · Waiting for Mark to tap Everyone's here.**
  - Mark: **Is everyone here? · Nobody can join after this. · Everyone's here · Invite more people**; tapping it froze the bill (Step 2 of 3 · Pay); Mark's card **How should Ana pay you?**
  - Ana's Home: **Pay Mark PHP 698.50 · Ask Mark how to pay. · Pay Mark**
  - horizontal overflow 0 px; event API `Cache-Control: private, no-store, max-age=0`
  - synthetic event deleted (DELETE 200, then GET 404). No payment reports, transfers or scanner calls were made.
- Not verified: the Vercel deployment ID (this session's Vercel API credential was rejected as invalid; the release is identified by the health version), a real iPhone (press feel, Safari, Reduce Motion), relatives' usability, and production database numbers (SQL in `runbooks.md`, not yet run).

---

## Sprint S8 — People progressive disclosure (v0.7.1, 2026-11-19 Manila)

Branch: `feature/people-screen`, integrating latest `main` commit `42da456` (v0.7.0). User requested less information overload with visible, familiar destinations. The People change itself affects only UI/shared sheet behavior, tests, version and documentation; upstream v0.7.0 workflow changes are preserved; no schema or financial service changes.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS, no fixture diff |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run test:unit` | **10 files,92 passed** |
| `npm run test:integration` | **9 files,49 passed**, PostgreSQL16 |
| `npm run build` | Passed |
| `npm run test:e2e` | **61 passed in one full run (2.3min)** |

New browser checks exercise the compact default roster, person/profile/settings/download/help/activity paths, role gates, Back/Close/Escape and focus restoration,44px targets, long names, late recovery responses, and light/dark screenshots on iPhone emulation and360px. Existing guest/recovery/equal-split and Home workflow tests pass with the newer3-step flow. No real phone or human usability study is claimed.

Initial pre-merge testing found a long unbroken name could overflow notices; both normal and quiet notices now wrap words. Older exact “No phone” selectors were updated for the compact status line; the new touch-size check allows0.01px for browser subpixel representation of a44px target. The corrected full combined run passed all61 cases. Before integration the earlier candidate’s87/47/57 results were superseded by this92/49/61 verification; upstream v0.7.0 was preserved.

GitHub source CI [44420961707](https://github.com/MrLister17/AteAnne/actions/runs/44420961707) passed on `7b1d8a5de36c5bc0cb38c10933ac22ab7bd065e1`. Main merge `b7d317f6ea66e3a9cd8e8c6df01020f49df9ceab` has exactly the same tested tree. No schema/server/domain changes were introduced by People relative to `42da456`.

**Production:** `dpl_BiDM3F9WgMac7WdX3uDextQiu7SE` READY at https://ateanne.vercel.app. Health HTTP200: `{"ok":true,"version":"b7d317f","receiptScan":"groq"}`, `Cache-Control:no-store`. Live Playwright smoke passed compact default (no exposed key/cancel/guest controls), person/profile detail and downloads/settings/help/activity sheets, with no horizontal overflow in a dark phone viewport. Screenshot: `/workspace/scratch/people-production-dark.png`. Synthetic event deleted; no payment reports, transfers or scanner calls created. Runtime scan returned the known pg concurrent-query deprecation warning on stderr; no application exception was returned.

Local review screenshots are under `test-results/screens/people-*.png` (copied outside the ignored test folder to `/workspace/scratch/people-previews/`). Real iPhone OS behavior, real relatives’ usability and next-day production cron close are unverified.

---


## v0.7.0 "Fewer waits" (2026-11-18, commit `50cec76`, merged into `main` on owner instruction)

Rules and UI changed (D49–D51): Add & claim in one step, payer's own receipt auto-confirms funding, "Everyone's here", automatic freeze with no approval round, corrections back to Add & claim with a manual re-freeze, paid events closed by the daily job a day after their last payment activity, tabs per step. No migration. Local Linux run: Node 22.23.5, PostgreSQL 16.15 (isolated `ateanne_test`), pre-installed Playwright Chromium. Synthetic data only.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS (no fixture diff) |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed |
| `npm run test:unit` | **10 files, 92 tests passed** |
| `npm run test:integration` | **9 files, 49 tests passed** on real PostgreSQL |
| `npm run build` | Passed, production build |
| `npm run test:e2e` | **51 passed** in one full run (59.3 s), 0 failed, 0 flaky |

What the new or rewritten tests prove:

**Unit**
- `AutoAdvance` freezes only when the roster is closed, everyone is done and the event isn't cancelled.
- It never re-freezes after a correction.
- It closes a paid event only 24 h after the last payment activity.
- `stepOf` maps the old phases into 3 steps.
- The new transitions are guarded.
- Reminders never ask anyone to approve.

**Integration**
- `workflow`:
  - The reference event (Mark +800, Juan +200, Paolo −1,000) gives **identical nets and transfers** with claims made while receipts are still being collected.
  - The payer's own receipt is auto-confirmed; one entered by someone else is not.
  - Only the organizer can lock.
  - The bill freezes on the last entry tick, with the app (null actor) recorded as the actor.
  - A correction waits for a manual re-freeze.
  - Full settlement is followed by the event closing a day later.
- `corrections`: a lock with everyone done freezes at once. Statements, payments, return transfers and the export are preserved across two correction rounds.
- `guests`: the last guest claim (made by a manager) freezes the bill; the audit has no `onBehalfOf`.
- `equal-receipt`: shares stay 33.34/33.33/33.33 after the freeze.
- New `auto-advance`:
  - A receipt edit makes claims stale and holds the freeze.
  - A cancelled event never freezes.
  - A reversal restarts the close clock.
  - `cleanup.run` reports `closedEvents: 1`.

**E2E**
- `hatian`, three phones, same amounts as before (+706 / −495 / −211):
  - claims happen before "Everyone's here"
  - the bill freezes on that tap
  - Pay has no Claim tab and no approval button
  - "Close it now" appears only when everyone is paid
- `corrections`: back to "Step 1 of 3 · Add & claim", then "Freeze the corrected bill", with payment history shown in Pay.
- `equal-receipt`: "You confirmed your share" replaces the Confirm button.
- `home`:
  - section order
  - only step-1 tabs
  - no estimate before everyone has answered
  - ≥44 px targets and no sideways scroll at both widths

The known `pg` concurrent-query deprecation warning appeared on stderr during integration and E2E; nothing failed because of it.

Not verified: real iPhone Safari; the live Vercel deployment and the production daily cron closing a real event (this container cannot reach the site); real groups using the new flow.

---

## v0.6.1 "Simpler Home" (2026-11-18, branch `claude/bold-mayer-xb2jcw`, fast-forwarded into `main` with owner approval)

UI-only change (D48): the start screen and the event Home tab were reordered and decluttered. No server, domain, route, migration or money code changed. Local Linux run: Node 22.23.5, PostgreSQL 16.15 (local cluster, isolated `ateanne_test` database), pre-installed Playwright Chromium. Synthetic data only.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS (reconciliation, allocations, conservation, transfers, reports, rounding) |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed (Prisma generate + `tsc --noEmit`) |
| `npm run test:unit` | **10 files, 87 tests passed** |
| `npm run test:integration` | **8 files, 47 tests passed** on real PostgreSQL |
| `npm run build` | Passed, production build |
| `npm run test:e2e` | **51 passed** in one full run (1.1 min): the 47 existing scenarios plus 4 new ones (`home.spec.ts` × iPhone 15 and 360px) |

What the new and changed browser tests prove:
- **`home.spec.ts` (new):**
  - Organizer Home reads *Your to-do* → *Next step* → *Invite people*.
  - The "I’ve entered every receipt I paid" tick is visible without scrolling, for the organizer and for a member.
  - *New code* / *Close joining* are hidden until *More join options* is tapped.
  - The auto-delete date sits at the bottom.
  - A member sees "Waiting on" and "Mark, the organizer, moves everyone on…", with no organizer buttons or join code.
  - Start screen, first visit: the walkthrough is inside *How it works* and the recovery-key link appears exactly once, on screen.
  - Start screen, returning: *Your events* is above *Start a hatian* and *How it works* is folded but opens with one tap.
  - Every Home and start-screen check also confirms no sideways scroll and that visible buttons, links and disclosure rows are at least 44px tall.
- **`corrections.spec.ts` (updated):** *Correct the bill* is hidden until *Something wrong with the bill?* is opened, and *Back to claims* is reached through *Need to fix something? Go back a step*. The full correction flow then passes as before.
- All other specs (`hatian`, `guests`, `reminders`, `equal-receipt`, `install`, `tutorial`, `layout`, `recovery`, `scan`) passed unchanged; button labels were kept on purpose.

Before/after screenshots were taken by driving both the previous build (`515a9d7`) and this one through identical synthetic steps on a local database.

The known `pg` concurrent-query deprecation warning appeared on stderr during integration and E2E runs; nothing failed because of it. The `package.json` version bump to 0.6.1 and the doc edits were made after this run; no application code changed after it.

Not verified: real iPhone Safari, and whether real relatives find the moved controls (*Go back a step*, *Correct the bill*, *More join options*) without help. That needs a person.

---

## Authorized production release (2026-11-18)

- Source commit: `8a24cc06cecad6031808b1a5440f7f1dacd69f34`, fast-forwarded into `main` after owner approval.
- GitHub CI: [44328507489](https://github.com/MrLister17/AteAnne/actions/runs/44328507489), **success** on all steps: reference, lint, types, unit, real PostgreSQL integration, production build, **47 E2E tests in one full run**.
- Vercel production deployment `dpl_DKFndt2NyoP1C3pmRzi73dhwRNQL`: **READY**, https://ateanne.vercel.app. Health HTTP 200: `{"ok":true,"version":"8a24cc0","receiptScan":"groq"}`; response `Cache-Control: no-store`.
- Supabase read-only verification: new column boolean/NOT NULL/default false; Prisma migration `20261118150000_equal_receipt_split` finished `2026-11-18T14:53:08.996817Z`, no rollback.
- Live synthetic API smoke: **PASS** for create/join, persisted equal policy and exact 51/50 centavo split, approval/freeze allocation-v2, reasoned correction keeping old statement, organizer replacement access preserving member identity, old browser denied and signed-out browser denied. Event deleted afterward. **No payment reports or real transfers created**; post-report/return-transfer accounting was verified by automated isolated tests.
- Smoke harness adjustments: Node client required the inherited network proxy; a signed-out browser correctly returns 401 (not the initially expected 404). Corrected harness then passed. These were test-harness issues, not production app changes.
- Post-smoke deployment runtime scan returned one known `pg` concurrent-query deprecation warning on stderr (Vercel labels stderr as error); no application exception was returned. All smoke requests had expected status codes. No claim of continuous monitoring, backup verification or real iPhone OS installation.

---

## Sprint S7 / v0.6.0 (2026-11-18, local `feature/pilot-improvements`)

Base checked: remote `main` commit `2a3a8db`. This section records the local implementation checks before the subsequently authorized release above. Local Linux runtime: Node 22.23.5, PostgreSQL 16.16 via Docker Compose, Playwright Chromium 153. Only synthetic development/test data; no production services or provider calls.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | Passed (Python reference fixtures; no fixture diff) |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed, Prisma generation + TypeScript |
| `npm run test:unit` | **10 files, 87 tests passed** |
| `npm run test:integration` | **8 files, 47 tests passed** on real PostgreSQL |
| `npm run build` | Passed, production build |
| `npm run test:e2e` | **47 distinct scenarios verified**: full run 45 passed / 2 reminder assertion failures; corrected case-sensitive expected text and reran `tests/e2e/reminders.spec.ts`: **2/2 passed** |

Full story under test: mobile install guidance → create/join → receipt policy/own acceptance → server recomputation → review/freeze → payment report/receiver confirmation → correction/fresh approvals/return transfer, alongside organizer reissue → new browser recovery → stable identity/old browser revocation, and manual reminder preview/copy. Existing lifecycle/security tests are retained. New E2E flows ran both iPhone emulation and 360px Android width.

Independent review checked conservation and authority; fixed the big-text and header corrected balances and clarified settlement captions. An initial browser run found exact tab-name selectors did not allow the existing “needs your attention” accessible suffix; these were corrected. The subsequent full run passed correction/equal/recovery/install workflows on both widths; only a reminder test’s expected text capitalization failed, then both reminder reruns passed. The expanded repeated-correction/reversal integration scenario was rerun separately and passed after the full PostgreSQL suite. No application code changed after the successful final build. Snapshots now preserve the equal-receipt policy and allocation policy version. PostgreSQL tests emitted an existing `pg` concurrent-query deprecation warning; no test failed because of it.

Not verified here: actual iOS Safari Share sheet/installation or storage transfer, real relative usability/pilot, real bank transfers, new live scanner-provider requests, production migration/deployment during the initial local implementation (subsequently verified above). Safari cannot be programmatically installed with one website-triggered confirmation; native prompts are tested with synthetic browser events, and Safari guidance is tested in Chromium emulation.

---

## Cousins pilot fixes (2026-11-18, branch `cousins-feedback`)

This session's container could not install npm packages (network policy), so **nothing was run locally**. The full chain was run by GitHub Actions (`.github/workflows/ci.yml`, real PostgreSQL 16 service, Chromium) on the branch. Results below are copied from the job logs of run 44318660752 (commit `210c230`; run 44318003068 on `2fbfdfc` was identical):

| Command | Result |
| --- | --- |
| `npm run test:reference` | passed |
| `npm run lint` | exit 0 (the first push, `a9035b4`, failed lint: a ref read during render in `EventApp.tsx`; fixed in `2fbfdfc`) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **7 files, 70 tests passed** (new: `guest-policy`, `entry-math`) |
| `npm run test:integration` | **5 files, 41 tests passed** (new: `guests.test.ts`, 11 tests) |
| `npm run build` | Compiled successfully |
| `npm run test:e2e` | **31 passed** (new: `guests.spec.ts`; `hatian.spec.ts` updated for auto totals) |

What the new tests prove:
- **Guests:** only the organizer/admins add guests or act for them; nobody can act for a person with their own phone; a non-manager can't act at all; the view while acting is the guest's (no organizer data); a guest can be a receipt's payer and a manager confirms the funding; managers claim and approve for guests through Freeze; every acting audit entry names the real person with `onBehalfOf` the guest; an admin who paid Lola is refused when confirming it for her, another manager can; the event reaches "ready for Done"; a hand-over key works (pasted with a line break), can't be redeemed on a manager's own phone, and ends guest status.
- **Auto-compute (browser):** 2 × ₱75 fills the line total and the receipt total; a default 10% service charge on ₱1,030 gives ₱103; typing ₱1,130 shows "off by PHP 3.00", ₱1,133 shows "matches".
- **Recovery (browser):** a key pasted (with a line break) into the join-code box is recognised and redeemed on a second phone; Home shows "I have a recovery key".
- **Big-text screen (browser):** shows "Your share so far" PHP 60.00 and the item at iPhone 15 width with no sideways scroll.

**After merging to `main` (commit `99fa5ec`, run 44322635354):** everything passed except one older E2E step. It reloads Juan's phone right after Mark taps **Received**, and sometimes looks before the save finishes ("−PHP 495.00" instead of "−PHP 295.00"). That is a race in the test, not the app; the same code passed on the branch three times. The test now waits for Mark's "Confirmed received" before reloading. The Vercel production deployment of `99fa5ec` reported "Deployment has completed" (GitHub commit status).

**Not verified:** a real iPhone (CI uses Chromium with iPhone emulation), the person screen in dark mode or by eye (CI screenshots aren't kept as artifacts), the Paste button (clipboard permission), and the iPhone Home Screen notice (needs a real installed app). The production deploy and migration have not been run.

---

## Earlier run (2026-11-16)

**Run:** 2026-11-16 · Linux container · Node 22 · PostgreSQL (local, isolated `ateanne_test` database) · Chromium for Playwright.
The results below are copied from the actual run log of this session.

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0, no warnings |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **5 files, 63 tests passed** |
| `npm run test:integration` | **4 files, 30 tests passed** (real PostgreSQL) |
| `npm run build` | Compiled successfully |
| `npx playwright test --trace off` | **30 passed** (iPhone 15 emulation + 360px Android width) |

`npm run test:reference` was not re-run in this session (no change to money rules).

## Scan and feedback changes (2026-11-16, second session)

Checked by browser tests on both phone sizes, with the fake reader:
- The Receipts tab and the Add-receipt form show **Take photo** (opens the back camera) and **Upload photo**; both are at least 44px tall.
- A file that is not a photo leaves a message on screen ("That didn’t work", the reason, and Retake / Upload photo) instead of a toast that vanishes.
- Tapping **Save receipt** on an unfinished form shows "Not saved yet. Fill in …" above the open sheet and moves to the first missing field. Before this session that message was drawn underneath the sheet.
- The press effect for buttons is present in the stylesheet.
- After the button restyle (D33) the full chain was run again: lint and typecheck exit 0, 54 unit, 30 integration, build, **30 browser tests passed**. Dark and light screenshots of Home, Overview, Receipts and the receipt form were looked over by hand in iPhone 15 emulation; no automated visual comparison exists.
- **Production check from the owner's phone (2026-11-16):** `/api/health` on the live site returned version `a0e494b` (the latest at that time) and `receiptScan: off` with the hint that `GROQ_API_KEY` is not set in the production environment, and no similarly named setting was found. So the cause is the Vercel setting, not the code.

**Not verified:** the production site. This session could not reach the Vercel site or the Vercel API (blocked by the session's network settings), so the diagnosis came from the owner opening `/api/health` on their phone (see above). No live Groq call and no real phone photo was scanned in this session. The Cancel button, the 55-second time-out and the camera/HEIC behaviour on a real iPhone have no automated test.

## First real receipt (2026-11-16, third session)

The owner scanned a real restaurant receipt on the live site (7 items, 15% loyalty discount on the VAT-exclusive price, service charge, card payment; long receipt on a dark folder). Printed total PHP 4,046.70.

| Version | Result on that photo |
| --- | --- |
| Live site before this change | Items came to PHP 3,305.00 instead of 4,425.00; **off by PHP 1,048.88**, discount not converted |
| Same pipeline re-run here (`try-scan`, before changes) | Two item amounts wrong (680 → 580, 460 → 450), quantity 3 read as 1, no unit prices, store name wrong |
| After cropping to the paper + new instructions (raw reading) | All items, quantities and unit prices right except 460 read as 450; in two of three runs the service charge 285.45 was read as 265.45 |
| After the checking layer (2 consecutive live runs, ~2.0 s each) | **Every amount matches the printed receipt**: 7 items = 4,425.00, service 285.45, discount 592.63 → 663.75, **reconciled at PHP 4,046.70**. The banner lists the three corrections it made. Store name read as "GOHA" (printed "GOMA"). |

Caveats: this is **one** receipt, and the test image was the owner's screenshot of the photo (lower resolution than the camera original). The corrections rely on the receipt printing unit prices and a subtotal; receipts without them fall back to a plain "items don't add up" warning. More real receipts are still needed. The full chain was run after these changes: lint and typecheck exit 0, **63 unit** (9 new), **30 integration**, build, **30 browser tests** passed.

## Vercel deployment simulation

A fresh `git clone` with no `.env`: `npm ci` (no env vars) passed. `npm run vercel-build` with no variables exits with a clear "Missing environment variables" message. With only `DATABASE_URL`, `JOIN_CODE_HASH_KEY`, `CRON_SECRET`, `VERCEL_ENV=production` and `VERCEL_PROJECT_PRODUCTION_URL`, it applied all 3 migrations to an empty database and built successfully. `next start` on that build, with database image storage, passed these checks: health ok; create event; private `no-store` response; `Secure` session cookie; QR upload stored in `AssetBlob`; member reads image 200 and stranger 401; cleanup cron 401 without the secret and 200 with `CRON_SECRET`; forged cross-site POST 403. This simulation caught and fixed a `.gitignore` rule that had excluded `src/server/storage/` from git. No real Vercel deployment has been made.

## Live Groq receipt scans (2026-11-16)

Run with `npx tsx scripts/try-scan.ts <image>` against Groq's API with the owner's key (proxy-injected; the value was never visible to the build session). The test images were three **synthetic** receipts rendered with a slight tilt and blur.

- `GET /models` showed that `qwen/qwen3.6-27b` (the earlier default, from a third-party doc) is **not** offered; `qwen/qwen3.8-27b` is, and it accepts images. The default was changed to it.
- Groq `json_schema` mode with an image returned well-formed JSON with **garbage values** (`"line_total": "}, {"`). `json_object` mode returned correct values, so the reader uses JSON mode.
- Free-tier limit observed: **7,000 input tokens/minute** for this model (one 429 hit while probing). One scan ≈ 2,000–2,500 input tokens, so about 2–3 scans per minute app-wide. SDK retries were turned off so a 429 shows "busy" immediately instead of hanging.

| Receipt | Time | Result |
| --- | --- | --- |
| Restaurant: 4 items (qty/unit prices), 10% service, VATable/VAT lines, cash and change | 1.5 s | All items and quantities correct; service captured; VAT, cash and change ignored; **reconciled** at PHP 940.50 |
| Senior citizen: Less VAT exemption + 20% SC discount, SC ID and name printed, GCash line | 1.7 s | VAT exemption and SC discount captured as discounts; **name/ID not copied**; **reconciled** at PHP 714.29 |
| Loyalty 15% on the VAT-exclusive price (same totals as the pictured-receipt fixture), service, VISA line | 3.1 s | 6 items incl. "6 @ 45.00" and "4 @ 200.00"; printed 592.63 normalized to **663.75** with a warning; **reconciled** at PHP 4,046.70 (matches the fixture) |

## What the suites cover

**Unit (`tests/unit`)**: every value in `reference/AteAnne_Expected_Calculations.json`: rounding (incl. the beyond-`MAX_SAFE_INTEGER` case), rejection messages, pictured-receipt reconciliation, nine-person dinner (each person's shared/rice/solo/service/owed/net and the transfers), scoped discount, multiple receipts and netting, and the full report → reject → verify → reverse timeline. **2,000 generated allocation cases** check exact sums, zero-weight-gets-zero, determinism and no negatives. **500 generated receipts** with scoped discounts and service check reconciliation, nets summing to zero, and full settlement by the planned edges. Plus `Money` parsing/formatting/bounds, payment-ledger rules and phase transitions.

**Integration (`tests/integration`, real PostgreSQL)**:
- Workflow: the Mark / Juan / Paolo multi-receipt event through every phase. Creator ≠ payer; payer-only funding ack; guest cannot edit others' receipts; organizer correction is audited and makes the funding ack stale; stale receipt version returns 409; entry gate; roster lock blocks late joins; None vs unanswered; reference nets/edges; same-version approvals; reopen before any report (superseded snapshot); pending reservation; idempotent replay; over-report rejected; no reopen after a report; sender and owner cannot verify; reject → dispute blocks reports; non-counterparty cannot resolve; two-sided resolution; **parallel double-verify credits once**; reversal recipient-only and once; Done blocked while pending; reversal blocked after Done; history retained.
- Security: cross-event read/write denied; foreign member ID as payer rejected; code grants no owner authority; rotated code dies and lower-case codes are normalized; join code not stored in plain text; 20-person cap; **4 concurrent claims on 3 rice units → exactly one 409, 3 units saved**; claims are always the caller's own; stale claim version returns 409; zero-basis service flagged; recovery keeps member ID and payer role, old key single-use, no identity merge; image re-encode strips an embedded EXIF marker, SVG and 9 MB uploads rejected, cross-event image read denied, random storage key; QR visible only to the owner.

**E2E (`tests/e2e`, production build, isolated contexts)**:
- `hatian.spec.ts`: organizer and two guests on separate emulated iPhones. Create, share code by link, join, enter receipts (shared/by-piece/service, payer ≠ creator), payer confirmations, entry complete, lock, claims (Juan skips rice and gets nothing from drinks; Paolo blocked from over-claiming), review shows +706.00 / −495.00 / −211.00 and Juan's service basis text, everyone approves, freeze, organizer uploads a synthetic QR plus a cash note, Juan reports PHP 200 cash (balance unchanged while pending), Mark confirms (balance becomes −295.00), remaining payments incl. QR, Done disabled while pending, confirms, Done, reload shows settled. No horizontal scroll. Second test: a stranger's browser gets the "can't open" screen, the API returns 401 with no-store, and a forged cross-origin POST returns 403.
- `tutorial.spec.ts` (both projects): first visit shows the "First time here?" ask; "Show me how" opens the walkthrough; every one of the 12 steps renders with no horizontal scroll; the last step offers "Start a hatian"/"Got it"; the ask does not reappear after reload; the Tutorial button reopens it; Back and Escape work; "Maybe later" dismisses it for good.
- `layout.spec.ts` (both projects): no horizontal scroll, every input labelled, every visible button/link ≥44px tall at 360px on all entry pages; visible keyboard focus; reduced motion honoured; manifest (standalone, maskable icon), apple-touch-icon, viewport-fit=cover, service worker served.

## Not verified here (honest gaps)

- **Receipt scanning on real phone photos.** Live Groq scans were run only on three *synthetic* receipt images (see below), not on real photos of crumpled or faded receipts. Check a few real receipts after deploying. The Claude reader has not had a live call.

- Real iPhone Safari and Android Chrome devices (only Chromium emulation of iPhone viewport/UA/touch). WebKit-specific rendering and actual *Add to Home Screen* behaviour still need a manual check on a phone.
- Production HTTPS deployment, `Secure` cookies over TLS, and a deployed smoke test (**not deployed**).
- Session/recovery/join-code expiry by time travel (the code paths are reviewed but not clock-tested).
- Zero-debt event closing via the UI (the gate logic is covered; no dedicated E2E).
- Restore rehearsal used dev data without snapshots or images.
- Screen-reader walkthrough (labels and roles are tested automatically; no VoiceOver/TalkBack session).
- Any real-world payments, research or pilot outcomes: none have happened.
