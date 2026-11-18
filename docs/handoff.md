# Handoff

_Last updated: 2026-11-18_

## Status

- **Engineering:** the P0 workflow is complete and persistent (create → join → receipts → claims → review → freeze → cash/QR → reports → recipient confirmation → Done), with exact-centavo calculations matching every supplied fixture. Lint, types, 32 unit, 23 integration and 22 E2E tests pass; the production build passes ([test-report.md](test-report.md)).
- **Retention:** every event auto-deletes 30 days after creation (owner decision); the date is shown in-app.
- **Database:** owner is setting up Supabase. See [deploy-vercel.md → Supabase](deploy-vercel.md). Don't add a DB-side delete job; the app handles it.
- **Receipt scanning:** photo → draft via **Groq** (free tier; set `GROQ_API_KEY`) or Claude (`ANTHROPIC_API_KEY`). Groq verified live on three synthetic receipts (all reconciled; see test-report.md). Still check real phone photos after deploying. Scanning is now on in production. One real receipt has been tested and reconciles after the crop + checking-layer work (decisions D34–D36, test-report.md); more real receipts are needed. The scan block now has Take photo / Upload photo, progress with Cancel and on-screen errors (decisions D30–D32).
- **Cousins pilot feedback (2026-11-18):** three fixes are on branch `cousins-feedback` (decisions D37–D42): people **without a phone** can be added and managed by the organizer or an **admin** (act-for mode, big-text "Show amount" screen, hand-over key if they get a phone); **typed receipts add themselves up** (qty × price, automatic total, percent service charge/discount); the **recovery key** now has an obvious place on Home and works when pasted into the join-code box. The local session couldn't install packages, so lint/types/tests were run by GitHub Actions on the branch; see [test-report.md](test-report.md). New migration `20261118140000_guests_and_admins` (adds two columns with defaults; safe on existing data) runs on the next production deploy.
- **Onboarding:** first-visit ask plus a 12-step tutorial ("?" button on Home, the event header and People).
- **Mobile/PWA:** iPhone-first UI with safe areas, bottom tab bar, 16px inputs and 44px targets; dark mode; installable via manifest + apple-touch-icon + service worker; an install helper (iOS Share → Add to Home Screen, Android install prompt).
- **Deployment:** pushed to GitHub `MrLister17/AteAnne`; **ready for Vercel** ([deploy-vercel.md](deploy-vercel.md)). Not deployed yet; that needs your Vercel account and a database.
- **Pilot / research:** **not started** (human task; see [pilot-guide.md](pilot-guide.md)).

## Run it

See the README quick start. Demo data: `npm run db:seed` prints recovery keys for nine synthetic people; paste one into `/recover` in a separate browser profile to act as that person.

## To deploy (exact steps)

1. Choose a Node host with **persistent PostgreSQL**, **HTTPS** and a **persistent volume** (or implement a private object-storage `PrivateStorage` adapter). Check current prices.
2. Set `DATABASE_URL`, `APP_ORIGIN=https://<domain>`, `JOIN_CODE_HASH_KEY` (`openssl rand -base64 32`), `PRIVATE_UPLOAD_DIR=/data/uploads`, `CLEANUP_TOKEN` (`openssl rand -hex 32`), `NODE_ENV=production`.
3. Follow [runbooks.md → Release](runbooks.md#release). Schedule the daily cleanup and backups.
4. On your iPhone: open the HTTPS URL in Safari → Share → **Add to Home Screen**. On Android: Chrome → **Install app**.

## Known limitations / next steps

- Try the guest flow with a real relative before relying on it: does the big-text screen read well on your phone, and is "Act for …" / "Done" obvious enough?
- iPhone Home Screen apps keep a separate sign-in from Safari. Tell people to **add AteAnne to the Home Screen first, then join** from the app, or they'll need their recovery key once.

See [implementation-plan.md → Next](implementation-plan.md) and [requirements.md](requirements.md) (FR-18/AT-19 partial: no deactivation of referenced members). Also verify on real iPhone Safari before the pilot (Playwright used Chromium with iPhone emulation).

## Repository

Development history lives in this repository's git log (milestone commits). The GitHub repo the owner created for this project could not be reached from the build session at first. See the commit and push notes in the final session report.
