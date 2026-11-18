# AteAnne — version history and handoff

This file records every release of AteAnne, what changed and why, and where work stopped. It is written so a person or another AI can pick the project up cold.

**Read in this order:** this file → [`CLAUDE.md`](CLAUDE.md) (rules for coding agents) → [`GUIDE.md`](GUIDE.md) (map of the app and how to change it) → [`docs/decisions.md`](docs/decisions.md) (why things are the way they are, D1–D47) → [`docs/test-report.md`](docs/test-report.md) (what was really run).

Dates are Asia/Manila. Versions 0.1.0–0.4.0 were given numbers afterwards from the git history; the code only started carrying a version number (`package.json`) at 0.5.0.

---

## Where we left off (2026-11-18)

- **v0.6.1 "Simpler Home"** is on branch `claude/bold-mayer-xb2jcw`: UI only, full check chain green locally (51 browser tests). **Not merged to `main` and not deployed.** Next: the owner reviews the before/after screenshots, then decides whether to merge and deploy. After that, watch a relative use the new Home without help.
- Remote `main` now includes **v0.6.0**, code commit `8a24cc0`, fast-forwarded after green CI with the owner’s approval.
- **v0.6.0 is live:** https://ateanne.vercel.app. Production deployment `dpl_DKFndt2NyoP1C3pmRzi73dhwRNQL` reached READY; `/api/health` returned `ok: true`, version `8a24cc0`, scanner `groq`.
- Sprint S7 covers the owner’s five requested improvements. See [`docs/implementation-plan.md`](docs/implementation-plan.md) for acceptance criteria and [`docs/test-report.md`](docs/test-report.md) for actual verification.
- New migration `20261118150000_equal_receipt_split` adds `Receipt.equalSplit` with default false, preserving existing receipt behavior. Applied and independently verified in production on 2026-11-18 at 14:53:08 UTC (boolean, NOT NULL, default false).
- Next human checks: real iPhone Safari installation before joining, organizer recovery hand-over with a relative, and correction explanations with a real group. Automated mobile tests use Chromium emulation, not iOS Safari.
- Still deferred: more real scanned receipt photos, the pilot study, referenced-member deactivation (FR-18/AT-19), multi-funder receipts, push notifications, and changes after Done.

---

## v0.6.1: Simpler Home (2026-11-18) · branch `claude/bold-mayer-xb2jcw`, not merged or deployed

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
