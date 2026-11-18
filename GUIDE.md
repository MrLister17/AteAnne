# AteAnne: the complete guide

This one page explains what the app does, where everything lives, how to run and deploy it, and **how to change things safely**. It's written for you (the owner) and for any developer or AI assistant who picks the project up later.

> **Quick links:** [What it does](#1-what-the-app-does) · [Folder map](#3-folder-map-where-things-live) · [How a request flows](#4-how-it-works-one-request-end-to-end) · [Money rules](#5-the-money-rules-dont-break-these) · [Change recipes](#7-how-to-change-common-things) · [Settings / env vars](#8-settings-environment-variables) · [Deploy](#9-deploying-vercel--supabase--groq) · [Tests](#10-tests-and-checks) · [Troubleshooting](#11-troubleshooting) · [Limits & next steps](#12-known-limits-and-ideas-for-next)

---

## 1. What the app does

**AteAnne** (*hatian*: splitting a bill) splits shared expenses by **what each person actually had**, not total ÷ people, and tracks repayments that only the receiver can confirm. It's mobile-first (iPhone first) and installs as an app from Safari (Share → Add to Home Screen) or Chrome (Install app).

**An event goes through 3 steps (since v0.7, D49–D51). Nobody waits for a button between them:**

| Step (phase) | What happens | How it moves on |
| --- | --- | --- |
| 1. Add & claim (`COLLECTING`) | People join with a code. Whoever paid adds receipts by typing or **scanning a photo**; saving your own receipt counts as "I paid" (a receipt someone typed for you waits for your "I paid"). Everyone claims what they had **as soon as a receipt exists** ("I had some", pieces with − / +, or "I got nothing from this receipt") and ticks "I've entered every receipt I paid". The organizer taps **Everyone's here** once the group is complete (joining closes for good). | **Automatically**: the bill freezes the moment the roster is closed and everyone is done. Claiming is the agreement; there is no approval round (D50). |
| 2. Pay (`SETTLING`) | Transfers are frozen (e.g. "Juan → Mark ₱495"). Payers send money outside the app and tap "I sent money". Receivers tap "Received" or "Not received". | **Automatically**: the daily job closes it a day after the last payment is confirmed (the day is the window to undo a mistaken "Received"). The organizer may tap **Close it now**. |
| 3. Done (`DONE`) | Read-only record. | — |

Events started before v0.7 may still be in `ALLOCATING`/`REVIEWING`; they show as step 1, claims still work in Allocating, and the organizer can **Freeze the bill now** or reopen receipts. The bottom tab bar shows only the tabs for the current step: Home · Receipts · Claim · People in step 1; Home · Pay · Receipts · People in step 2; Home · Money · Receipts · People when Done.

**People without a phone ("guests"):** the organizer, or an **admin** the organizer appoints, adds them in People → *Add someone without a phone*, then taps **Act for Lola** to claim her items, approve and record her payments while showing her the screen (a coral "Acting for Lola" bar stays on top; **Done** goes back). **Show amount** opens a big-text screen (English + Tagalog) with what she owes or is owed and what she had. Nobody can act for someone who has their own phone, a manager can't confirm a payment they themselves made to the guest, and the Activity list shows "Mark saved claims **for Lola**". If Lola gets a phone later, *They got a phone? Give them access* makes a key she opens with "I have a recovery key".

**Typing a receipt:** Qty × Price each fills the line total; the receipt total fills itself in (marked *Auto*) until you type the printed total, which switches to checking. Service charge and discounts can be a **percent** (service charge starts at 10%).

**Sprint S7 shortcuts:** install AteAnne on the Home Screen **before** creating/joining (Safari requires its Share menu; other supported browsers show native confirmation). In the receipt editor, choose **Split this receipt equally among everyone**; each person accepts their own share in Claim. Home → Next step → **Copy reminder** refreshes, previews a group/person message, and copies it for you to paste into Messenger. It sends nothing automatically. Home → Next step → *Something wrong with the bill?* → **Correct the bill** starts a reasoned correction before Done, carrying confirmed payments into revised balances; the organizer re-freezes it with **Freeze the corrected bill**. People → **Reissue access** lets the organizer check a lost-key member in person and privately hand over a 15-minute key; this trusted-circle power can grant that person’s access, so identity checking matters.

**The two Home screens (v0.6.1, D48)** are laid out in reading order so people know where to look:
- **Start screen** (`/`): your events first (if any) → **Start a hatian** / **Join with a code** → a lighter **I have a recovery key** row → the install card → *How it works* (open for newcomers, folded once you have events; the full walkthrough button lives inside it). Help is the **?** icon at the top.
- **Event → Home tab (v0.7):** your balance (estimates only once everyone has answered) → **Your to-do** (only what is left: confirm a receipt someone typed for you, claim each receipt, the *I’ve entered every receipt I paid* tick; "You’re done for now" when finished) → the organizer’s note → **Invite people** (organizer, while joining is open: code, Copy/Share, **Everyone’s here**) → **Next step** (what happens next, what the group is waiting on, **Copy reminder**) → **People without a phone** (organizer/admins) → the auto-delete date as fine print (a warning at the top in the last 7 days).
- Rarely needed controls are one tap away behind plainly worded rows, never removed: *Something wrong with the bill?*, *More join options* (New code), each guest’s *N to do* list, and on Claim *Don’t agree with splitting this equally?* / *Change my answer*.

**Other features:** first-visit "First time here?" prompt plus a 10-step tutorial (the **?** button); recovery key to move to a new phone (Home → **I have a recovery key**; pasting it into the join-code box also works); cash/QR payment instructions; private receipt photos; CSV/JSON export; events auto-delete **30 days after creation**; "preview mode" when no database is connected.

---

## 2. Tech stack

| Part | Tool |
| --- | --- |
| Web app / API | **Next.js 16** (App Router), **React 19**, **TypeScript 5.9** |
| Styling | **Tailwind CSS 4** with design tokens in `src/app/globals.css` (light + dark) |
| Database | **PostgreSQL** (Supabase in production) via **Prisma 7** + `@prisma/adapter-pg` |
| Validation | **Zod 4** |
| Images | **sharp** (decode, re-encode, strip metadata) |
| Receipt scanning | **Groq** (`groq-sdk`, free tier, default) or **Claude** (`@anthropic-ai/sdk`, optional) |
| Tests | **Vitest** (unit + real-database integration), **Playwright** (iPhone + 360px browser tests) |
| Hosting | **Vercel** (Singapore region `sin1`) |

---

## 3. Folder map (where things live)

```
GUIDE.md            ← this file
README.md           ← short intro + quick start
CLAUDE.md           ← rules for AI coding assistants
vercel.json         ← Vercel region, build command, daily cleanup cron
.env.example        ← every setting, documented (copy to .env)
prisma/
  schema.prisma     ← DATABASE TABLES (edit here, then make a migration)
  migrations/       ← applied in order on deploy (never edit old ones)
  seed.ts           ← sample 9-person dinner for local testing
src/
  domain/           ← PURE BUSINESS RULES (no database, no UI). The heart of the app.
    money/Money.ts, Fraction.ts           exact pesos (bigint centavos), parsing/formatting
    allocation/LargestRemainderAllocator.ts  splits an amount with no lost centavo
    receipt/ReceiptReconciler.ts          "do items − discounts + charges = total?"
    receipt/ReceiptCalculator.ts          who owes what for one receipt
    receipt/ReceiptDraftNormalizer.ts     cleans a scanned receipt (VAT-discount fix)
    event/EventLedger.ts                  totals for the whole event, nets
    event/PhaseMachine.ts                 which phase can go to which
    event/GuestPolicy.ts                  who may act for a guest (no-phone person); admins; conflict rule
    receipt/EntryMath.ts                  qty × price and percent helpers for typed receipts
    event/RetentionPolicy.ts              30-day auto-delete date
    settlement/SettlementPlanner.ts       who pays whom (transfer list)
    payments/PaymentLedger.ts             pending/confirmed/disputed payment rules
    errors.ts                             ValidationError / ConflictError / PermissionError
  server/           ← SERVER LOGIC
    config.ts                 reads & validates environment variables
    container.ts              wires everything together; picks the receipt scanner
    db.ts, PostgresOptions.ts database connection (TLS for Supabase)
    aggregate/EventAggregate.ts   loads one event; answers "is it ready for the next step?"
    services/                 one class per area; every change goes through these
      EventService.ts         create/join/phases/freeze/cancel/delete; add guest, admins, guest access key
      ReceiptService.ts       receipts, funding confirm (automatic for your own receipt), claims
      PaymentService.ts       payment instructions, reports, confirm/reject/reverse, disputes
      AssetService.ts         private photos (validate, re-encode, store, serve)
      ReceiptScanService.ts   photo → draft receipt (nothing saved)
      RecoveryService.ts      recovery keys
      QueryService.ts         the event view + CSV/JSON export
      CleanupService.ts       daily cleanup + 30-day deletion
      BaseService.ts          shared "lock event → check → change → audit" pattern
    scan/                     receipt readers
      receiptPrompt.ts        THE INSTRUCTIONS given to the AI + expected JSON shape
      receiptImage.ts         crops the reader's copy of the photo to the paper
      GroqReceiptReader.ts    Groq (default model qwen/qwen3.8-27b)
      ReceiptReader.ts        Claude reader + fake reader for tests
    readmodels/EventViewBuilder.ts  builds the JSON the phone receives
    http/route.ts             wrapper for every API route (security, errors, cookies)
    security/                 join codes, hashing, rate limits
    storage/PrivateStorage.ts photos stored in the database (or on disk)
    validation.ts             Zod schemas for every API input
  app/              ← PAGES & API ROUTES (Next.js)
    page.tsx                  start screen: your events, Start / Join, recovery row, install card, How it works
    new/ join/ recover/ offline/   entry screens
    e/[eventId]/page.tsx      the event screen (renders src/ui/event/EventApp.tsx)
    api/**/route.ts           27 API endpoints (thin: they call a service)
    layout.tsx, globals.css, manifest.ts, icon.png
  ui/               ← SCREENS & COMPONENTS (React)
    components/ui.tsx         Button, Field, Card, Sheet (pop-up), Notice, BalanceBanner…
    components/Icon.tsx       all icons (inline SVG)
    event/EventApp.tsx        header, phase bar, bottom tab bar
    event/OverviewTab.tsx     "Home" tab: to-do (+ entry tick), Next step card, Invite people, guests, deletion line
    event/ReminderPanel.tsx   "Copy reminder" button + sheet (inside the Next step card)
    event/ReceiptsTab.tsx     receipt list + Scan button
    event/ReceiptEditor.tsx   add/edit receipt form (+ "Fill in from a photo"; auto totals, % charges)
    event/PersonScreen.tsx    big-text "show this to them" screen (amount owed/owed to, items)
    event/todo.ts             what a guest is still waiting on (Home → People without a phone)
    event/ClaimTab.tsx        claiming wizard
    event/MoneyTab.tsx        review & breakdown
    event/SettlementSection.tsx  paying, confirming, disputes, QR/cash setup
    event/PeopleTab.tsx       roster, rename, recovery key, export, delete; add guests, admins
    event/ScanPanel.tsx       the "Take photo / Upload photo" block, progress, errors
    event/useReceiptScanner.ts   shared scan logic (shrink, send, cancel, time-out)
    tutorial/steps.tsx        THE 12 TUTORIAL STEPS (text + pictures)
    tutorial/TutorialProvider.tsx first-visit prompt + tutorial pop-up
    pwa/                      install prompt, service worker, preview banner
    format.ts, image.ts, api.ts  helpers (peso formatting, photo shrinking, API client)
public/
  sw.js             service worker (offline page; never caches private data)
  icons/            app icons (regenerate with `npm run icons`)
scripts/            setup, Vercel build, cleanup, backup/restore, try-scan
tests/
  unit/             pure rules + fixtures + Groq reader (no database)
  integration/      services against a real PostgreSQL test database
  e2e/              Playwright phone tests (full flow, tutorial, scan, layout)
reference/          the original Python reference math + expected numbers
docs/               detailed docs (see section 13)
```

---

## 4. How it works (one request, end to end)

Example: someone taps **Save my items** on the Claim tab.

1. **UI** `src/ui/event/ClaimTab.tsx` calls `api.put("/api/receipts/<id>/claims", …)` with amounts as **decimal-string centavos** (`"12550"` = ₱125.50).
2. **Route** `src/app/api/receipts/[receiptId]/claims/route.ts` passes it through `route()` in `src/server/http/route.ts`, which checks the site origin (CSRF), reads the session cookie, limits the body size and maps errors to HTTP codes.
3. **Service** `ReceiptService.saveClaims()` validates the input with Zod, then `BaseService.inEvent()` **locks the event row** in the database, loads the event (`EventAggregate`), and checks phase, permissions and versions.
4. **Domain rules** (`src/domain/...`) decide whether it's allowed and what the numbers are. These are pure classes, easy to test.
5. The change is saved, an **audit entry** is written, and the phone reloads the event view (`QueryService` → `EventViewBuilder`). **The server always recalculates; it never trusts totals sent by the phone.**

Receipt scan flow: phone shrinks the photo (`src/ui/image.ts`) → `POST /api/events/<id>/receipts/scan` → `ReceiptScanService` (checks + strips metadata) → `receiptImage.ts` (crop to the paper) → `GroqReceiptReader` (AI only copies what is printed) → `ReceiptDraftNormalizer` (the checking layer: exact parsing, quantity × unit price, printed subtotal, look-alike digit repair, VAT-discount conversion, warnings) → draft shown in `ReceiptEditor` → the person checks it and saves.

---

## 5. The money rules (don't break these)

- **Money is always whole centavos in `bigint`.** Never use JavaScript decimal numbers (floats) for money. Parse input with `Money.parsePesos()`, and send it as a string of centavos.
- **Splitting:** each item is split only among the people who claimed it (equally, or by pieces). Leftover centavos go to the largest remainders, with ties broken by join order (`LargestRemainderAllocator`). Totals always match exactly.
- **Order:** items first → discounts (only on the items they apply to) → service charge and other charges in proportion to each person's spending after discounts. No spending means no service charge.
- **Net = paid to stores − your share.** The transfer list is frozen when the organizer freezes the statement.
- **Payments:** "reported" means pending and changes nothing. Only the **receiver** can confirm. A rejection opens a dispute that **both** sides must resolve. A receiver can undo a confirmation **once**, with a reason, before Done.
- **Before Done, the organizer can correct a reported bill** after pending reports/disputes resolve (Home → *Something wrong with the bill?*). It needs a reason and goes back to Add & claim; the organizer then taps **Freeze the corrected bill** (a corrected bill never re-freezes by itself). Confirmed money carries forward; overpayments become return transfers. Original history stays read-only; Done stays read-only.
- Full detail: `docs/financial-rules.md`. The original spec is in `docs/spec/`.

---

## 6. Running it on your computer

```sh
docker compose up -d db        # or install PostgreSQL yourself (see README)
npm install
npm run setup                  # creates .env with secrets, sets up the database
npm run db:seed                # optional: sample dinner; prints keys for /recover
npm run dev                    # http://localhost:3000
```
To test scanning locally, put `GROQ_API_KEY=...` in `.env`. To check one photo without the app: `npx tsx scripts/try-scan.ts photo.jpg`.

---

## 7. How to change common things

Always run the checks in [section 10](#10-tests-and-checks) before pushing.

| I want to change… | Edit this |
| --- | --- |
| **Any wording on a screen** | Search the text in `src/ui/` or `src/app/` (e.g. "Scan a receipt" lives in `src/ui/event/ReceiptsTab.tsx`) |
| **Tutorial steps** (text, order, pictures) | `src/ui/tutorial/steps.tsx`: each step is one object `{ who, title, points, art }` |
| **First-visit prompt** wording | `WelcomeAsk` in `src/ui/tutorial/TutorialProvider.tsx` |
| **Button look** (shape, colours, pressed state) | The `.btn…` classes in `src/app/globals.css`; pick a style with `<Button variant="primary|secondary|tonal|ghost|danger|receive|add">` |
| **Colors / dark mode** | CSS variables at the top of `src/app/globals.css` (`--violet`, `--coral`, `--bg`, …) |
| **App name / icon / home-screen title** | `src/app/manifest.ts`, `src/app/layout.tsx`, icons via `scripts/make-icons.mjs` then `npm run icons` |
| **Auto-delete period (30 days)** | Vercel env var `EVENT_RETENTION_DAYS` (no code change) |
| **Max people / receipts / lines** | `MAX_MEMBERS`, `MAX_RECEIPTS`, `MAX_LINES` in `src/server/aggregate/EventAggregate.ts`, plus the matching Zod limits in `src/server/validation.ts` |
| **Rate limits** (e.g. 10 scans/hour) | `RATE_RULES` in `src/server/security/RateLimiter.ts` |
| **How the AI reads receipts** (what to skip, VAT rules) | `RECEIPT_SYSTEM_PROMPT` in `src/server/scan/receiptPrompt.ts`, then test with `scripts/try-scan.ts` |
| **Groq model** | Vercel env var `GROQ_VISION_MODEL` (default `qwen/qwen3.8-27b`) |
| **Use Claude instead of Groq** | Set `ANTHROPIC_API_KEY` and `RECEIPT_SCAN_PROVIDER=claude` |
| **VAT-discount auto-fix behaviour** | `ReceiptDraftNormalizer.ts` (`isVatGrossUp`, exactly 12%), then update `tests/unit/receipt-draft.test.ts` |
| **Add a field to the database** | ① edit `prisma/schema.prisma` ② `npx prisma migrate dev --name what_you_changed` ③ use it in the service ④ expose it in `EventViewBuilder.ts` ⑤ show it in the UI. Production applies the migration automatically on the next deploy. |
| **Add an API endpoint** | Create `src/app/api/.../route.ts` using `route(async (ctx) => …)` and call a service method. Put rules in a service or domain class, not the route. |
| **Add a new receipt scanner** (another AI) | Write a class implementing `ReceiptReader` (see `GroqReceiptReader.ts`), then add it to `chooseReceiptReader()` in `src/server/container.ts` |
| **Security headers / CSP** | `next.config.ts` |
| **Daily cleanup time** | `crons` in `vercel.json` (UTC; `17 19 * * *` = 03:17 Manila) |

**Golden rules:** money changes go through a `BaseService` subclass; rules live in `src/domain`; never edit an old migration; never put API keys in code.

---

## 8. Settings (environment variables)

Set these in **Vercel → Settings → Environment Variables** (Production), then **Redeploy the newest deployment**.

| Name | Needed? | What it does |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Supabase **Transaction pooler** URL (port 6543) |
| `DIRECT_URL` | Yes (Supabase) | Supabase **Session pooler** URL (port 5432), used for migrations |
| `JOIN_CODE_HASH_KEY` | **Yes** | Long random secret (`openssl rand -base64 32`). Keep it stable. |
| `CRON_SECRET` | Recommended | Random secret for the daily cleanup job (`openssl rand -hex 32`) |
| `GROQ_API_KEY` | For scanning | Turns on **Scan a receipt** (free tier). Turn on Zero Data Retention in Groq's console. Pasted quotes/spaces and near-miss names (`groq_api_key`, `GROQ_KEY`) are tolerated, but use the exact name. |
| `GROQ_VISION_MODEL` | Optional | Default `qwen/qwen3.8-27b`. Change it if Groq retires that model. |
| `ANTHROPIC_API_KEY` / `RECEIPT_SCAN_MODEL` / `RECEIPT_SCAN_PROVIDER` | Optional | Use Claude for scanning instead of Groq |
| `EVENT_RETENTION_DAYS` | Optional | Default 30 |
| `DATABASE_SSL_CA` | Optional | Provider certificate for verified TLS |
| `APP_ORIGIN` | Optional | Your public URL (defaults to the Vercel production URL) |
| `STORAGE_DRIVER` | Optional | `database` (default, needed on Vercel) or `disk` |

Without `DATABASE_URL` / `JOIN_CODE_HASH_KEY` the site runs in **preview mode**: screens work, nothing saves, and a yellow banner explains why.

---

## 9. Deploying (Vercel + Supabase + Groq)

- **Code:** GitHub `MrLister17/AteAnne`, branch **`main` only**. Pushing to `main` makes Vercel deploy automatically.
- **Build:** `npm run vercel-build` (in `vercel.json`): checks settings → `prisma generate` → **applies database migrations** (production only) → `next build`.
- **Database:** Supabase in the Singapore region. Tables are created by the deploy; don't create them by hand. Row-level security is switched on for every table, which blocks Supabase's public API; the app itself is unaffected. **Don't add Supabase jobs that delete rows**: the app deletes events itself after 30 days.
- **Check a deployment:** open `https://<your-app>/api/health` → `{"ok":true,"version":"<commit>","receiptScan":"groq"}`. `version` should match the latest commit on GitHub.
- Step-by-step with screenshots-level detail: `docs/deploy-vercel.md`.

---

## 10. Tests and checks

Run all of these before pushing to `main` (the local database must be running):

```sh
npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e
```

| Suite | What it proves |
| --- | --- |
| `test:unit` | Money math matches the reference fixtures to the centavo; 2,500 generated cases; scan normalizer; Groq reader (mocked) |
| `test:integration` | Real-database flows: full event lifecycle, permissions, concurrency, recovery, photos, 30-day purge, scanning |
| `test:e2e` | iPhone-size browser tests: create → claim → review → pay → Done, tutorial, scanning, 360px layout |
| `test:reference` | The original Python reference math still passes |

Latest results and live Groq scan results: `docs/test-report.md`. CI runs everything on every push (`.github/workflows/ci.yml`).

---

## 11. Troubleshooting

| Problem | Fix |
| --- | --- |
| No **Scan a receipt** block (the organizer sees "Photo scanning is off on this site") | Open `/api/health`. If `version` is not the latest commit on GitHub, redeploy the **newest** deployment. If `receiptScan` is `off`, read `receiptScanHint` in the same reply: it says what is missing (setting names only). Usually: `GROQ_API_KEY` not ticked for **Production**, or the site was not redeployed after adding it. |
| A button seems to do nothing | Every button dips when pressed and shows a spinner while working; messages appear at the top of the screen. If you see none of that, the phone is running an old copy: close the app fully and reopen it. |
| Scan says "model isn't available" | Groq retired the model. Set `GROQ_VISION_MODEL` to Groq's current vision model and redeploy. |
| Scan says "busy" | Groq's free tier allows about 2–3 scans per minute app-wide. Wait a minute. |
| Yellow "Preview mode" banner | `DATABASE_URL` or `JOIN_CODE_HASH_KEY` is missing in Vercel |
| Build fails at migrations | Database unreachable. Check `DIRECT_URL` is the Session pooler (not the "Direct connection") |
| "Cross-site request blocked" | Set `APP_ORIGIN` to the exact URL you use and redeploy |
| Someone lost their phone | Use **I have a recovery key** on Home. If the key is lost too, ask the organizer in person to **Reissue access** from People (private key expires in 15 minutes) |

---

## 12. Known limits and ideas for next

**Acting for a guest, technically:** the app sends the header `x-ateanne-act-as: <memberId>`. Routes for a person's own actions call `ctx.caller()` and pass it to the service; `BaseService.inEvent` checks `GuestPolicy` inside the event lock and gives the service `me` = the guest and `by` = the real person. All other routes call `ctx.actor()`, which rejects the header. To let a new route work for guests, switch it to `ctx.caller()` and make the service method take a `Caller`.

**Limits (v1):** one payer per receipt; no bill changes after Done; no deactivating a person who already has receipts or claims; deleting an event after payments is blocked (export instead); identity is "this browser" (no accounts); scanning accuracy on real crumpled receipts still needs checking; Groq free tier is about 2–3 scans/minute.

**Ideas:** receipt scanning on the phone with no AI (Tesseract.js) as a fallback; "paste receipt text" box for iPhone Live Text; push notifications ("Mark confirmed your payment"); multiple payers per receipt; editing after payments with an audit trail; iOS splash screens.

---

## 13. More documentation (`docs/`)

| File | Contents |
| --- | --- |
| `docs/decisions.md` | Every decision and why (D1–D36), including your changes to the original spec |
| `docs/requirements.md` | Each requirement from the spec → where it's implemented → which test proves it |
| `docs/architecture.md` | Class diagram, database diagram, phase and payment state machines |
| `docs/financial-rules.md` | The money rules with worked examples |
| `docs/deploy-vercel.md` | Vercel + Supabase + Groq setup, step by step |
| `docs/runbooks.md` | Backup, restore, rollback, self-hosting with Docker |
| `docs/privacy-and-recovery.md` | What data is kept, where, for how long; recovery limits |
| `docs/test-report.md` | Latest test results, including live scan results |
| `docs/handoff.md` | Current status in short |
| `docs/pilot-guide.md`, `docs/case-study-template.md` | Running a real group test; writing it up for your portfolio |
| `docs/spec/` | The original SDLC PDF, editable spec and starter prompt |
| `docs/prompts/receipt-scan-next.md` | Ready-to-paste prompt for the next session on receipt scanning |
