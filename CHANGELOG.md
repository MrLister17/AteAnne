# AteAnne — version history and handoff

This file records every release of AteAnne, what changed and why, and where work stopped. It is written so a person or another AI can pick the project up cold.

**Read in this order:** this file → [`CLAUDE.md`](CLAUDE.md) (rules for coding agents) → [`GUIDE.md`](GUIDE.md) (map of the app and how to change it) → [`docs/decisions.md`](docs/decisions.md) (why things are the way they are, D1–D63) → [`docs/test-report.md`](docs/test-report.md) (what was really run).

Dates are Asia/Manila. Versions 0.1.0–0.4.0 were given numbers afterwards from the git history; the code only started carrying a version number (`package.json`) at 0.5.0.

---

## Unreleased

- Reduced text density on event screens. Balance amounts, statuses and primary actions stay visible. Supporting breakdowns, guidance and history are available through disclosures.
- Added the [running event payments and credit specification](docs/running-event-payments.md), including confirmation, settlement carry-forward and currency handling.

## Where we left off (2026-11-19 Manila)

- **v0.9.0 (Sprint S10, D58–D62): mixed currencies, merged to `main` and live.**
  - `main` was fast-forwarded `bb1993f → b040a74` at the owner's request.
  - Branch CI run [44482869560](https://github.com/MrLister17/AteAnne/actions/runs/44482869560) passed, and so did CI on `main` ([44483504305](https://github.com/MrLister17/AteAnne/actions/runs/44483504305)).
  - Production `/api/health` returned `version` `b040a74` and `fx.ok: true`: the live ECB rate (18 Nov publication) was fetched, and the migration ran.
  - The synthetic production smoke test passed with real rates (THB 1,397.00 at 1.8739802 = PHP 2,617.95) and was then deleted. Details are in `docs/test-report.md`.
- Still to do by a person:
  - Try a real mixed-currency trip on an iPhone: a baht receipt, **Show totals in**, **Pay in** baht.
  - Run the read-only production SQL in `docs/runbooks.md` (needed before follow-ups F1/F7).
- Follow-up backlog (not started):
  - From S9: F1 `ReceiptAck.receiptId`/FK indexes, F2 ETag polling + lazy Activity, F3 private QR caching, F4 coarse write limit/Firewall, F5 orphan actor cleanup, F6 remaining prompts, F7 pool size, F8 return-transfer wording.
  - From S10: a second rate source for VND/TWD/AED/SAR; viewing totals in currencies other than the event's and pesos.
  - Earlier deferrals stand: referenced-member deactivation and multi-funder receipts.

---

## v0.9.0: Receipts in any currency (2026-11-19 Manila) · merged to `main` and deployed

Sprint **S10**, decisions **D58–D62**, plan [`docs/sprint-s10-plan.md`](docs/sprint-s10-plan.md).

The owner asked to see a THB bill in pesos and to pay in a chosen currency at the day's rate. They answered the plan's questions as follows:
- **D58:** currencies can be mixed in one event.
- **D59:** use Claude's suggestion.
- **D60:** use the daily rate.
- **D61:** use the rate of the day the receipt was bought.
- **D62:** ECB rates.

### Added: receipts in any currency (D58, D61)

- **Currency and purchase date on every receipt.** Each receipt has **Currency** and **Bought on**. A scan fills both in when they're printed. The Philippine 12% VAT-discount repair now runs only on peso receipts, and yen/won/rupiah amounts are kept in whole units.
- **Settle-up currency per event.** It is picked on Start a hatian (*Settle up in*, default ₱). Every share, balance and transfer is in it.
- **Conversion at the purchase day's rate.** A receipt in another currency is converted at the ECB rate of the day it was bought. Example: *Breakfast · THB 1,397.00 · counts as PHP 2,270.13 · 1 THB = 1.625 PHP (ECB, 18 Nov)*.
  - Its shares are calculated in its own currency.
  - Its total is converted once (rounded half-up).
  - That total is split with the largest-remainder rule, so the receipt still adds up to the centavo.
- **Rates are fixed at the freeze** and recorded in the frozen statement (policy `ateanne-allocation-v3`, used only when a receipt is converted).
- **A missing rate makes the bill wait; it never guesses.** The daily job freezes the bill once the rate arrives.

### Added: show totals in another currency (D60)

- **Show totals in** on Home and Pay/Money. It shows a person's totals in another currency of the event, or in pesos, at today's rate: "≈ −THB 513.88", with the exact PHP 835.06 underneath and the rate and date shown.
- It changes only that phone's view and is remembered per event. The header balance follows it.

### Added: pay in another currency (D58, D61)

- **Pay in.** On Pay, the payer can choose another currency the receiver accepts. Receivers tick these under payment details → *I accept*; by default that's the settle-up currency plus every receipt currency.
- **Rate locked on the day sent.** The rate is the one for the day the money is sent and is stored with the payment. Example: "At today's rate: 1 THB = 1.625 PHP · Send THB 513.88" → "Counts as PHP 835.06".
- **Server checks.** The server recomputes the credit and answers 409 if the rate changed.
- **Receivers confirm what arrived:** "Did THB 513.88 from Ana arrive?".
- **Unchanged:** partial payments, disputes, reversals and corrections. An agreed replacement reuses the original rate.

### Changed

- **Changing currencies (D59).** The organizer can change the settle-up currency (People → Event settings) only during Add & claim and only before any payment is reported. A receipt's currency and date are ordinary receipt fields; after the freeze they change only through Correct the bill. Changes only relabel: typed numbers are never converted. Both are audited.
- **Export.** CSV columns are now `amount, currency, settle_amount, rate, rate_date`. JSON `amountPhp` and similar keys became `amount` plus `currency`, with receipt `conversion` and payment `paid` details.
- **`/api/health` shows `fx`:** the rate source, today, and the latest cached day.

### Data and server

- **Migration `20261119120000_currencies` (additive):**
  - `Event.currency`
  - `Receipt.currency/purchasedOn`
  - `PaymentInstruction.acceptedCurrencies`
  - `PaymentReport.paidCurrency/paidMinor/rate/rateDate/rateSource`, with an all-or-none check constraint
  - a new `ExchangeRate` cache table with RLS on
- **Existing rows:** they read as pesos, bought the day they were entered, paid in the settle-up currency.
- **Rate fetching:** rates come from Frankfurter (ECB) and are fetched only by `RateService`, outside event locks (D57). New settings: `FX_RATES_URL` (optional) and `FX_RATES_FAKE` (tests only).

### Tests

Local results: reference PASS, lint, typecheck, **258 unit**, **74 integration**, build, **75 browser** tests, all passed. New: unit `currency.test.ts`, integration `currency.test.ts`, E2E `currency.spec.ts` at iPhone 15 and 360px. Details are in `docs/test-report.md`.

### Release

- **CI:** branch run 44482869560 and `main` run 44483504305 both passed on `b040a74`.
- **Merge:** `main` was fast-forwarded `bb1993f → b040a74`.
- **Production health:** `{"ok":true,"version":"b040a74",…,"fx":{"source":"ecb","today":"2026-11-19","latest":{"day":"2026-11-19","effectiveDate":"2026-11-18"},"ok":true}}`.
- **Production smoke test** (synthetic, then deleted):
  - real ECB rate 1 THB = 1.8739802 PHP, with Breakfast THB 1,397.00 converting to PHP 2,617.95
  - frozen with policy v3, transfer PHP 1,008.97
  - "Show totals in THB" shows ≈ −THB 538.41
  - "Pay in Thai baht" shows Send THB 538.41
  - no sideways scroll
  - no payment reports were created
- **Not verified:** the Vercel deployment ID and a real iPhone.

### Rollback

Redeploy v0.8.0 (`bb1993f`) only while no non-peso receipt or event exists. The migration is additive, but once one exists, v0.8.0 would show its amounts as pesos without converting them. From then on, use forward fixes only.

---

## v0.8.0: Claim → Pay → Done, lighter storage (2026-11-19 Manila) · merged to `main` and deployed

Sprint **S9**, decisions **D53–D57**, plan [`docs/sprint-s9-plan.md`](docs/sprint-s9-plan.md) (owner approved every recommended decision). Starting point: the owner's screenshot of Claim saying "2 of 2 confirmed" with nothing telling anyone what to do next.

### Added: one next action (D53)

- `src/domain/event/NextAction.ts` (pure) works out every person's ordered tasks and their next step. The event view sends `next` (yours) and `group` (everyone's). Home, Claim and Pay show one **Next for you** card: one status line, at most one sentence, one primary button, at most one secondary link.
- After "2 of 2 confirmed": the organizer sees **Is everyone here?** · *Nobody can join after this.* · **[Everyone's here]** · Invite more people. Someone with a task sees e.g. **Did you pay for anything else?** · **[I'm done adding receipts]** · Add a receipt, or **Next: Lunch** · **[Claim from Lunch]**. Someone done sees **You're done for now** · *Waiting for Mark to tap Everyone's here.* · See what's left.
- Claim folds an answered receipt into a summary (**✓ Share confirmed**, **Your share**, *Everyone confirmed (2 of 2)*) with the lines behind **See items**. After a save it jumps to the next receipt you still owe an answer, if any.
- Home: the Next card replaces the to-do list (others under **Everything left (N)**; *You said you're done adding receipts · Undo*). The group card is now **The group**. **Close it now** asks first.
- The tab dot, guest list, "See what's left" and **Copy reminder** read the same task list (the four separate copies are gone).

### Changed: no new receipt photos; payment wording (D54, D55)

- Scanning still drafts a receipt, but the photo is never uploaded or kept: *We don't keep this photo. Only what you save is kept.* "Attach/Replace photo" is gone; `POST /api/events/:id/assets` answers 410 `receipt_photos_off` for receipt photos before any rate-limit hit or decoding. Older photos keep their access rules, can be removed (**Remove photo**) and are deleted with their event at 30 days.
- Pay: **Pay Mark ₱698.50** → **I sent ₱698.50** (amount editable) → **Sent ₱400 · Waiting for Mark**, *₱298.50 left*. Recipient: **Did ₱400 from Ana arrive?** → **Yes, I got it** / **It didn't arrive** (*Not there yet? Leave this and check later.*). "It didn't arrive" opens a reason sheet instead of a browser prompt. One status line per transfer; history behind **See payments (N)**. Ledger, partial payments, disputes, reversals and corrections are unchanged.

### Changed: every tap answers back (D56)

- `Button busyLabel` ("Saving…", "Confirming…", "Sending…"), errors beside the button (`ActionError`), polite success toasts and assertive error toasts; actions that showed no busy state now do.
- First load shows a skeleton with *Loading your event…* and **Try again** after 10 s. Load errors distinguish offline, server trouble and no access. A failed manual refresh no longer shows ✓, and a failed background refresh shows *Offline · showing 3:42 PM · Try again*.
- Polling: one request when you come back (it was two), skipped while a refresh is running, stopped on Done and cancelled events.
- Reduce Motion: static "…" instead of a frozen spinner, solid activity bar, presses change colour instead of shrinking.

### Fixed: database and rate limits (D57)

- Receipt saves, claims and payment reports counted their rate limit on a second pool connection while holding the event lock. On a one-connection pool v0.7.1 failed with "timeout exceeded when trying to connect"; the count now runs before the transaction, keyed by real person per event.
- Wrong join codes and recovery keys no longer create `Actor`/`Session` rows. 429 responses say how long to wait (`retryAfterSeconds`, `Retry-After`, "Too many tries. Try again in N minutes.").
- New `integration/database-security.test.ts` fails CI if any table lacks Row Level Security or the Data API roles gain privileges.
- `scripts/measure-db.ts` measures SQL statements, pool connections and JSON size on the test database; the runbook has the read-only production SQL.

### Tests

- Unit: `next-action.test.ts` (20 cases plus a 128-case "never an empty wait" matrix), `reminders.test.ts` rebuilt on the shared task list.
- Integration: `payments-flow.test.ts`, `rate-limits.test.ts`, `database-security.test.ts`; image tests rewritten for no new receipt photos (QR pipeline, legacy photo read/remove/purge).
- E2E: new `next-step.spec.ts` (the "2 of 2 confirmed" walkthrough through partial payment and "It didn't arrive") and `feedback.spec.ts` (busy labels, double tap, inline error and retry, Reduce Motion, first load, refresh failure, polling); `hatian`, `home`, `equal-receipt`, `guests`, `reminders`, `corrections`, `scan` updated. Both new specs also run at 360px.
- Results: local reference/lint/types, **240 unit**, **64 integration**, build, **71 browser** all passed; GitHub CI run 44452776502 passed on `1557289`; production health and smoke passed. Details in `docs/test-report.md`.
- **Rollback:** redeploy v0.7.1 (`720e6f7`). No migration and no money-rule change; data written by v0.8.0 is readable by v0.7.1.

---

## v0.7.1: People without information overload (2026-11-19 Manila) · merged to main and deployed

Sprint **S8**, decision **D52**. The owner’s phone screenshots showed expanded management controls repeated for every person, alongside profile, exports, event administration, help and the full activity log.

- People now opens as a compact roster. Tap a name for their amount and available guest, admin, access and removal options. Initial intent is kept in details rather than repeated as a badge.
- **Add someone without a phone** stays beside the roster; its explanation and form open when tapped.
- Labeled rows group **Your profile & access**, **Download event record**, **Event settings**, **Help & privacy** and **Activity**, with short descriptions so unfamiliar users know where to look.
- Exports explain **Spreadsheet (CSV)** and **Full record (JSON)**. Cancellation and deletion are inside Event settings; deletion is hidden if a payment exists in any current or prior statement.
- One sheet provides Back/Close navigation. Keyboard focus returns to the opener, and nested destinations announce their heading. Closing a pending key request prevents its response from reopening a secret panel.
- No database migrations or changes to financial calculations or server permissions. New browser checks cover organizer/admin/member paths, guest/recovery regressions, long names, focus, delayed responses, and mobile light/dark layouts.
- Full local checks and GitHub CI passed (92 unit,49 integration,61 browser). Production READY, live health and browser smoke verified; see `docs/test-report.md`. Real iPhone Safari remains a human check.

---

## v0.7.0: Fewer waits (2026-11-18) · merged to `main` (owner instruction)

The owner tested start to finish and found it confusing. They wrote: "you can't progress until the end without each other", "hide things that we don't need yet", and "there should be clear communication of what needs to be done now". Decisions **D49–D51**. The owner chose the options: fewer rounds with auto-advance, no approval round, and tabs per step.

### Changed: 3 steps, and the app moves on by itself (D49)

- **Before:** the group waited for everyone 4 times, and the organizer pressed a button after each wait:
  - entry ticks, then **Lock roster**
  - claims, then **Start review**
  - approvals, then **Freeze**
  - payments, then **Mark as Done**
- **Now there are 2 waits:** everyone done claiming, and everyone paid. Nobody presses a button to move on.
  1. **Add & claim.**
     - You can claim from a receipt as soon as it exists.
     - Saving a receipt you paid counts as "I paid". A receipt someone typed for you still waits for your confirmation.
     - You tick "I've entered every receipt I paid".
     - The organizer taps **Everyone's here** once the group is complete. This closes joining for good.
     - When the roster is closed and everyone is done, **the bill freezes by itself** (`AutoAdvance`, `BaseService.advanceIfReady`, `freezeGate`).
  2. **Pay.** Same as before: payers report, receivers confirm.
     - A fully paid event **closes by itself a day after the last payment activity** (daily cleanup job).
     - The organizer can tap **Close it now**.
  3. **Done.**
- **Changed from the plan:** the plan said "Done automatically" the instant the last payment was confirmed. Done is read-only, so that would make a mistaken "Received" on the last payment impossible to undo. The one-day close keeps that safety, and nobody waits: everyone sees "You're all set" / "Everyone is paid ✓" at once.
- **Corrections** now go back to Add & claim (reason required, as before). The organizer then taps **Freeze the corrected bill**: a corrected bill never re-freezes by itself. Earlier statements and confirmed money are kept, and overpayments become return transfers.
- **No database migration.** Events started before v0.7 that are in Allocating or Reviewing show as step 1. Claims still work for them, and the organizer can **Freeze the bill now** or reopen receipts.

### Changed: no approval round (D50)

- Claiming is the agreement. "I agree with this split" is gone from the screens. The approval route stays for compatibility, but no step requires it.
- This supersedes FR-12/AT-12. **Trade-off:** nobody sees the final numbers before they freeze. The safety nets are:
  - your own per-receipt claim
  - the line-by-line breakdown in Pay
  - a reasoned correction before Done

### Changed: show only what's needed now (D51)

- **Bottom tabs per step:**
  - Add & claim: Home · Receipts · Claim · People
  - Pay: Home · **Pay** · Receipts · People
  - Done: Home · Money · Receipts · People
  - An old link to a hidden tab opens Home.
- **Header:** "Step 1 of 3 · Add & claim" / "Step 2 of 3 · Pay" / "Step 3 of 3 · Done". A short message appears when the step changes under you, for example "Everyone's done — the bill is frozen. Time to pay."
- **Home:**
  - *Your to-do* lists only what is left. Finished items disappear, and "You're done for now" says what happens next.
  - The organizer's *Invite people* card holds **Everyone's here**.
  - *Next step* explains the automatic freeze and close, with a calm "Waiting on" list.
- **Estimates** appear only once everyone has answered every receipt. Before this, the first person to claim a shared dish briefly showed "you owe all of it".
- **Claim tab** (from the owner's screenshot): after confirming an equal share, it now says **"You confirmed your share"** instead of still offering "Confirm my equal share". "I disagree" moved behind a plainly worded row.
- Tutorial: 12 → 10 steps. "How it works" on the start screen: 4 → 3 steps. The receipt editor tells a payer that saving confirms they paid. Activity shows automatic moves as "AteAnne".

### Tests

- **Unit:** `AutoAdvance` (freeze rules, never after a correction, close only after a day), `stepOf`, the new transitions, reminders without approvals.
- **Integration**, real PostgreSQL:
  - `workflow`, `corrections`, `guests`, `equal-receipt`, `security`, `recovery-reissue`, `retention` and `scan` rewritten for the new flow, with identical money results.
  - New `auto-advance.test.ts`: a receipt edit holds the freeze, a cancelled event never freezes, and the day-later close (a reversal restarts the clock) through the real cleanup job.
- **E2E:**
  - `hatian`, `guests`, `equal-receipt`, `corrections` and `home` rewritten for 3 steps.
  - Checks that Claim is hidden in Pay, no approval button exists, the equal-share confirmed state shows, tabs match the step, and no estimate appears before everyone has answered.

### Verification

Full local chain, run on commit `50cec76`: reference fixtures PASS, lint, typecheck, **92 unit**, **49 PostgreSQL integration**, production build, **51 browser tests** (iPhone 15 and 360px) — all passed with no failures. See [`docs/test-report.md`](docs/test-report.md). Not verified: real iPhone Safari, the live deployment (this container cannot reach it), and real groups using the new flow.


---

## v0.6.1: Simpler Home (2026-11-18) · merged to `main` (owner approved)

The owner said Home was information overload, so people couldn't tell where to focus. Decision **D48**. UI only: no rule, route, migration or money change, and every control is kept with its label unchanged.

### Changed: event Home tab (`src/ui/event/OverviewTab.tsx`)

- **Reading order: you → the group → organizer tools → fine print.** The organizer’s Collecting screen went from 7 stacked boxes to 4 cards plus a footer line.
- **Your to-do** now holds the **“I’ve entered every receipt I paid”** tick. It used to sit at the very bottom, under the organizer's controls. The old to-do row that only opened Receipts is gone.
- **Next step**: one card for everyone.
  - It shows what the group is waiting on, from the server's gates, in a calm grey list: the first 3, then *Show all*.
  - The organizer gets the button that moves the group on.
  - **Copy reminder** lives here. Its explanation moved into the reminder sheet.
  - Members see "Mark, the organizer, moves everyone on when it's ready" instead of a generic paragraph.
- **One tap away, behind plainly worded rows:**
  - *Need to fix something? Go back a step* (Back to receipts / Back to claims)
  - *Something wrong with the bill?* (Correct the bill, with its explanation and blockers)
  - *More join options* (New code / Close joining)
  - each guest's *N to do* list
- **Invite people** (organizer, Collecting): join code, Copy, Share, people count, and "Someone without a phone? Add them in People".
- **Auto-delete date** is a one-line footer with *Export a copy*. The warning box at the top only appears in the last 7 days.
- The acting-for notice is shortened to one sentence; the coral bar already explains it.

### Changed: start screen (`src/app/page.tsx`)

- **Returning people see their events first**, above *Start a hatian* / *Join with a code*.
- **I have a recovery key** is a lighter row right under the two big buttons. It now appears once; before, it appeared 3 times (button, notice, footer link).
- **How it works** holds the full-walkthrough button (*Watch the full walkthrough · 1 min*). It is open for newcomers and folded once you have events. The big tutorial card is gone from this screen; the **?** icon stays.
- **Install card** is shorter (one line instead of two paragraphs). Its button is secondary on the start screen so it no longer competes with *Start a hatian*. The /new and /join install pause (D43) is unchanged.

### Added

- `Disclosure` (labelled `<details>` row, ≥44px) and a `limit` / `quiet` option on `Blockers` in `src/ui/components/ui.tsx`; an `inline` variant of `TutorialButton`; `ReminderButton` replaces `ReminderPanel`'s card.
- `tests/e2e/home.spec.ts`, run at iPhone 15 and 360px: section order, the entry tick without scrolling, rare controls one tap away, member view, start screen for newcomers vs returning, no sideways scroll, ≥44px targets.

### Verification

Reference, lint, typecheck, 87 unit, 47 PostgreSQL integration, production build and **51 browser tests** all passed locally. See [`docs/test-report.md`](docs/test-report.md). Real iPhone Safari and real-relative usability are not verified.

---

## v0.6.0: Relatives’ next five improvements (2026-11-18) · merged to `main` and deployed

Decisions **D43–D47**, Sprint **S7**. Owner requested all five items from the v0.5.0 backlog.

### Added

- **Home Screen first.** Before creating/joining on mobile, show an install action. Supporting browsers open their native confirmation; Safari explains Share → Add to Home Screen → reopen. Safari cannot open its install confirmation from a website. Shared join links offer copying the code before installing; an explicit browser fallback explains saving the recovery key.
- **Organizer-assisted lost-key recovery.** People → Reissue access → check identity in person → private 15-minute key. Only the organizer can do this for active phone members. Redemption preserves member ID, roles and financial records, rotates the key and removes old browser access atomically. Reissuing invalidates the old key immediately, not the old browser until redemption. Admins only retain guest hand-over.
- **Split this receipt equally among everyone.** Explicit receipt policy, all lines shared, one-tap acceptance by each member. Nobody’s claims are silently assigned. Review blocks until everyone agrees; exact receipt-wide rounding gives totals at most one centavo apart. Existing item claims remain the default.
- **Copy reminder.** Home → preview everyone’s or one person’s outstanding tasks → Copy message → paste into Messenger. Refreshes first, includes an event-access link, never keys/codes. Pending payments ask the recipient to check arrival rather than prompt a duplicate transfer. Nothing is sent automatically.
- **Corrections after reported payments.** Before Done, organizer provides a reason after resolving pending reports/disputes. Keep the roster locked, supersede the original statement, collect fresh approvals, and freeze remaining transfers from corrected net plus confirmed payments. Overpayments generate return transfers. Old statements and payment history remain visible/exportable and cannot be rewritten. Reverse mistaken confirmations before beginning correction; Done stays read-only.

### Production release (owner authorized)

- Code commit `8a24cc0`; GitHub Actions run [44328507489](https://github.com/MrLister17/AteAnne/actions/runs/44328507489) passed the full chain, including all 47 browser tests in one run.
- Production deployment: [Vercel build](https://vercel.com/yvan17/ateanne/DKFndt2NyoP1C3pmRzi73dhwRNQL), READY on the existing Singapore project. Public URL: https://ateanne.vercel.app.
- Migration `20261118150000_equal_receipt_split` completed; independently checked using read-only Supabase queries. Existing receipts default to item claims.
- Live synthetic smoke passed create/join, equal receipt persistence with 51/50 centavo shares, approval/freeze, reasoned correction preserving the original statement, replacement recovery with stable identity/revoked old access, and unrelated-browser denial. Synthetic event deleted; no payment reports or real transfers created. Post-report accounting remains covered by integration/E2E tests, not simulated production payments.
- Post-smoke runtime scan returned the known `pg` concurrent-query deprecation warning on stderr; no application exception was returned. Real iPhone OS installation and human usability remain unverified.
- **Rollback:** after correction statements exist, v0.5 accounting is not compatible; use a compatible forward fix, preserving all money/history.

### Verification and handoff

- New unit coverage: equal receipt rounding/conservation, correction carry-forward, phase-specific reminders including duplicate-transfer prevention.
- New PostgreSQL integration coverage: recovery authority/expiry/concurrent redemption, equal-split consent, post-report correction/return transfer/history.
- New browser specs: installation, organizer recovery, equal receipt acceptance, copy reminders and corrected settlement.
- Requirements, financial rules, guide, privacy, decisions, sprint plan, test report and handoff updated. Actual test results are recorded separately; no real bank transaction, pilot evidence or deployment is claimed.

---

## v0.5.0: Cousins pilot fixes (2026-11-18) · merged to `main`

The owner tested with cousins. They reported three problems and asked what else to improve. Decisions **D37–D42**.

### Added: people without a phone ("guests") and admins

- **Guests.** A guest is a member with `managed = true` and no browser (`actorId` is null). The organizer or an admin adds them in People → *Add someone without a phone*. This works only while Collecting, like joining.
  - Guests start with "entry complete" ticked.
  - Payer confirmation still gates any receipt a guest paid.
- **Admins.** `Member.isAdmin` is appointed by the organizer (People → *Make admin*). Admins can:
  - add guests
  - act for guests
  - remove guests nobody has referenced yet
  - hand guests their own access

  They get no other organizer powers: phases, cancel, delete and join codes stay with the organizer.
- **Act-for mode.** Home → *People without a phone* → **Act for Lola**, or People → *Act for them*.
  - The app sends the header `x-ateanne-act-as: <memberId>`. The event view is built **as the guest**, so every normal screen works for them unchanged: claims, funding confirmation, entry toggle, approval, receipts, photos, payment reports and decisions, disputes, and cash/QR details.
  - A coral "Acting for Lola" bar stays on top, with **Show** and **Done**.
  - Acting survives a page refresh (`sessionStorage`) and ends when you leave the event.
- **Big-text "Show amount" screen** (`src/ui/event/PersonScreen.tsx`).
  - Shows the person's headline amount: "Pay Mark ₱495", "Juan pays you ₱200", "Your share so far". Every line has Tagalog underneath.
  - Lists what they had, from the frozen statement if there is one, otherwise from the live split.
  - Also available for yourself (People → *Show my amount in big text*).
- **Hand-over to their own phone.** *They got a phone? Give them access* creates a one-time key.
  - The guest redeems it like a recovery key, and `managed` becomes false.
  - A manager's own phone can't redeem it, because identities are never merged.
- **Guest to-do list** (`src/ui/event/todo.ts`): Home shows what each guest is still waiting on.
- **Activity log** shows "Mark saved claims **for Lola**". The view's audit entries now carry `onBehalfOf`.

### Safety rules (server)

- `src/domain/event/GuestPolicy.ts` (pure) decides:
  - who may manage guests (the organizer, or an active admin with their own phone)
  - who may act for whom (only for guests)
  - who may appoint admins (only the organizer, and never a guest)
- **Conflict-of-interest rule (D39).** While acting for a guest, a manager can't confirm a payment they themselves sent to that guest, and can't answer a dispute where they are the other side. Another manager has to do it.
- `BaseService.inEvent(caller, …)` resolves `me` (the guest) and `by` (the real person) inside the event lock.
  - Audit entries written while acting record `by` as the actor and `detail.onBehalfOf` as the guest.
  - Services take a `Caller` (`string | { actorId, asMemberId? }`).
- Routes **opt in.** Participant routes call `ctx.caller()`. Every other route calls `ctx.actor()`, which **rejects** the act-as header (HTTP 400 `acting_not_supported`). Organizer-only routes therefore can never run "as" someone.
- `AssetService.read` lets a manager see the QR of someone a guest owes.
- New routes:
  - `POST /api/events/:id/guests`
  - `POST /api/events/:id/members/:memberId/admin`
  - `POST /api/events/:id/members/:memberId/access-key`
- Migration `20261118140000_guests_and_admins`:
  - adds `managed` and `isAdmin`
  - adds check constraints `member_managed_has_no_actor` and `member_guest_not_admin`

### Changed: typed receipts add themselves up (D41)

- Each item is laid out as **Qty × Price each = Line total**, and the line total follows qty × price.
  - Typing a different (printed) total takes over.
  - A one-tap "Use ₱…" button puts the calculated total back.
- **The receipt total fills itself in** (marked *Auto*) until you type the printed total. After that, the bar goes back to checking for typos ("off by …" or "✓ matches").
- **Percent service charge and discounts.**
  - Choose *Peso amount* or *Percent %*.
  - The base is the items the adjustment applies to.
  - Service charge defaults to 10%.
  - Rounding is half-up to the centavo, done in `src/domain/receipt/EntryMath.ts`.
- Scanned drafts keep the printed total, so a misread line still shows as a mismatch.
- The server still recomputes and reconciles everything on save.

### Fixed: recovery key had nowhere obvious to go (D42)

- **Likely causes:**
  - The join-code box cut pasted text to 14 characters, so a pasted key (about 46 characters) always failed.
  - On iPhone, a Home Screen app keeps a sign-in separate from Safari.
- Home has a third main button, **I have a recovery key**. The event "can't open" screen uses the same wording.
- The join-code box recognises a pasted key (`src/ui/recovery.ts`), switches to "Get back into my event" and redeems it.
- The server strips spaces, line breaks and zero-width characters from keys, and restores a missing `AA-` (`recoverSchema`).
- The recover page has:
  - a **Paste my key** button
  - a check that warns when only part of a key was pasted
  - a Home Screen notice
- The tutorial now says where to use the key.

### Tests and docs

- New tests:
  - `tests/unit/guest-policy.test.ts`
  - `tests/unit/entry-math.test.ts`
  - `tests/integration/guests.test.ts` (11 tests): a whole event with two guests, including the conflict rule and the hand-over
  - `tests/e2e/guests.spec.ts`: act for a guest, the big-text screen, a key pasted in the join box
- `tests/e2e/hatian.spec.ts` was updated for auto totals and the 10% default.
- Docs updated: `GUIDE.md`, `docs/decisions.md` (D37–D42), `docs/handoff.md`, `docs/test-report.md`, and this file.

### Commits

| Commit | What |
| --- | --- |
| `a9035b4` | Guests, auto-computed receipts, easier recovery key (CI: lint failed) |
| `2fbfdfc` | Lint fix (no ref read during render in `EventApp`); guide and handoff docs (CI: all green) |
| `210c230` | Leaving the event ends acting mode (CI: all green) |
| `80ca6ce` | Test report with CI results |
| `6b7d2c1`, `680e417` | `CHANGELOG.md`, version bumped to 0.5.0 (CI: all green) |
| `99fa5ec` | Fast-forwarded into `main` with the owner's approval; this changelog marked released. Vercel: "Deployment has completed". CI: one older E2E step failed on a timing race |
| *(next)* | E2E: wait for "Confirmed received" before reloading the payer's phone (fixes that race) |

---

## v0.4.0: Scan UX, buttons, scan accuracy (2026-11-16) · `4262594`

- `a0e494b`: Scan block always shows **Take photo** and **Upload photo**, with progress, Cancel, and errors that stay on screen.
  - The organizer sees "Photo scanning is off · Why?" when no reader is configured. `/api/health` explains why, using setting names only.
  - Optional settings are forgiving: blank or quoted values and mistyped Groq key names work.
  - Every tap gives feedback, and toasts are drawn in the top layer. (D30–D32)
- `1309538`: One button system in `globals.css`, with clear shapes, pressed colours, and tonal and dashed "add" buttons. (D33)
- `4262594`: Scan accuracy. (D34–D36)
  - The reader's copy of the photo is cropped to the paper.
  - The reader only copies; a separate checking layer (`ReceiptDraftNormalizer`) checks qty × unit price and the printed subtotal, and repairs a single look-alike digit.
  - The VAT-discount conversion is exact.
  - Groq gets one retry on a 5xx error.
  - The owner's real receipt reconciles after this.

## v0.3.0: Receipt scanning (2026-11-16)

- `5c1a1c4`: Optional photo → **draft** receipt with Claude vision. Nothing is saved automatically; the person checks the draft in the normal editor. (D27)
- `6dbc5a5`, `c02e74f`, `164851a`: **Groq** (free tier) becomes the default reader behind the same `ReceiptReader` port. It was verified live; uses JSON mode and `qwen/qwen3.8-27b` with no SDK retries. (D28, D29)
- `f30d21e`: "Fill in from a photo" inside the Add-receipt form; `/api/health` shows the version and scan status.
- `9579079`: `GUIDE.md`, a complete map of the app.
- `74eaaaa`: `docs/prompts/receipt-scan-next.md`, a prompt for the next scanning session.

## v0.2.0: Deployable (2026-11-15/16)

- `6c02ded`, `d5361a9`, `6f22ef7`: Vercel-ready. (D23)
  - Images are stored in PostgreSQL (`AssetBlob`).
  - Phones shrink photos before upload.
  - `vercel.json` sets the `sin1` region and a daily cron.
- `f00eabf`, `d394361`: Merged the GitHub repo's initial commit into the history.
- `27ac123`: Every event auto-deletes **30 days after creation**. RLS is enabled with no policies, and Supabase's `anon`/`authenticated` roles are revoked. (D24, D25)
- `7dc35ea`: Verified Supabase TLS on Vercel.
- `c48aae1`, `fdb310e`: **Preview mode.** The UI deploys and runs without a database, and the APIs answer 503 `not_configured`. (D26)

## v0.1.0: P0 workflow (2026-11-15)

- `edc9f79` (M0): Exact-money domain layer.
  - `Money` uses bigint centavos.
  - `LargestRemainderAllocator`, `ReceiptCalculator`, `EventLedger`, `SettlementPlanner`, `PaymentLedger`, `PhaseMachine`.
  - Tests against the Python reference fixtures.
- `04a52f3` (M1–M4): Prisma schema, sessions, services that lock the event row for every money write, API routes, integration tests on real PostgreSQL.
- `b7f580e` (M5–M6): iPhone-first PWA UI, Playwright E2E tests (iPhone 15 and 360px), ops tooling and docs.
- `3fdcaa3`: First-visit tutorial ask and a 12-step walkthrough; generic example names (Mark, Juan, Paolo). (D21, D22)
- The workflow: create → join with a code → receipts → claims → review/approve → freeze → cash/QR payments confirmed by the receiver → Done.

---

## How to add the next entry

1. Bump `version` in `package.json` (minor for features, patch for fixes).
2. Add a section at the top of the version list, using the same shape: Added / Changed / Fixed, why (cite the decision number), new tests, and commits.
3. Update **Where we left off**.
4. Add the decision rows to `docs/decisions.md`.
5. Record the real test results in `docs/test-report.md`.
