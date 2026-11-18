# AteAnne — version history and handoff

This file records every release of AteAnne, what changed and why, and where work stopped. It is written so a person or another AI can pick the project up cold.

**Read in this order:** this file → [`CLAUDE.md`](CLAUDE.md) (rules for coding agents) → [`GUIDE.md`](GUIDE.md) (map of the app and how to change it) → [`docs/decisions.md`](docs/decisions.md) (why things are the way they are, D1–D42) → [`docs/test-report.md`](docs/test-report.md) (what was really run).

Dates are Asia/Manila. Versions 0.1.0–0.4.0 were given numbers afterwards from the git history; the code only started carrying a version number (`package.json`) at 0.5.0.

---

## Where we left off (2026-11-18)

**State of the code**

- `main` (commit `4262594`) = **v0.4.0**, live on Vercel + Supabase, with receipt scanning on.
- Branch **`cousins-feedback`** = **v0.5.0**. It is **not merged** and the owner hasn't approved it yet. GitHub Actions CI passes on it: lint, typecheck, 70 unit tests, 41 integration tests, build and 31 E2E tests (run 44318660752).
- Merging `cousins-feedback` into `main` deploys to production and applies migration `20261118140000_guests_and_admins`. The migration only adds two columns with defaults (`Member.managed`, `Member.isAdmin`) and two check constraints. Existing data isn't affected.
- Compare: https://github.com/MrLister17/AteAnne/compare/main...cousins-feedback

**Open next steps (owner's choice)**

1. Merge `cousins-feedback` → `main` after the owner says yes. Then check `/api/health` on the live site shows the new commit.
2. Test the guest flow with a real relative on a real iPhone. CI only uses Chromium with iPhone emulation, and the big-text screen hasn't been looked at by eye or in dark mode.
3. Suggested improvements, in priority order. None of these is started.
   - **Home Screen first, then join.** Nudge people to add AteAnne to the Home Screen right after they join in Safari. On iPhone the Home Screen app keeps a separate sign-in, so joining in Safari forces a recovery-key trip later.
   - **Organizer-assisted recovery.** Let the organizer re-issue access for someone who lost their key while that person is present. Today, no key means no way back in. The hand-over key from v0.5.0 (`EventService.guestAccessKey`) already does most of the work, but the security trade-off needs a decision first.
   - **Equal-split shortcut.** "Split this receipt equally among everyone", so people don't claim shared platters item by item.
   - **Reminders.** A "Copy reminder" message to paste into Messenger. The app only refreshes while it's open.
   - **Corrections after a payment is reported.** Today the bill is frozen after the first report (v1 rule).
4. Still open from before: try more real receipt photos with the scanner; the pilot study ([`docs/pilot-guide.md`](docs/pilot-guide.md)); and FR-18/AT-19, deactivating a member who is already on receipts ([`docs/requirements.md`](docs/requirements.md)).

**Working-environment notes for the next AI**

- A session may be unable to `npm install` (blocked network). In that case, push a branch and use GitHub Actions as the test runner. The CI job runs the full `CLAUDE.md` chain against real PostgreSQL.
- Job logs and annotations of this public repo can be read without a token:
  - `https://api.github.com/repos/MrLister17/AteAnne/actions/runs?branch=<branch>`
  - `…/actions/runs/<id>/jobs`
  - `…/actions/jobs/<jobId>/logs`
- Record real results in `docs/test-report.md`. Never invent results, deployments or pilot data.
- Commit or push only when the owner asks. Branch first; don't push straight to `main`.

---

## v0.5.0: Cousins pilot fixes (2026-11-18) · branch `cousins-feedback`, unreleased

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
| *(this commit)* | `CHANGELOG.md`, version bumped to 0.5.0 |

---

## v0.4.0: Scan UX, buttons, scan accuracy (2026-11-16) · `main` @ `4262594`, live

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
