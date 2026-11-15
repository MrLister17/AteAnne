# Handoff

_Last updated: 2026-11-15_

## Status

- **Engineering:** the P0 workflow is complete and persistent (create → join → receipts → claims → review → freeze → cash/QR → reports → recipient confirmation → Done), with exact-centavo calculations matching every supplied fixture. Lint, types, 32 unit, 23 integration and 18 E2E tests pass; the production build passes ([test-report.md](test-report.md)).
- **Mobile/PWA:** iPhone-first UI with safe areas, bottom tab bar, 16px inputs and 44px targets; dark mode; installable via manifest + apple-touch-icon + service worker; an install helper (iOS Share → Add to Home Screen, Android install prompt).
- **Deployment:** **not deployed.** No hosting target or credentials were provided.
- **Pilot / research:** **not started** (human task; see [pilot-guide.md](pilot-guide.md)).

## Run it

See the README quick start. Demo data: `npm run db:seed` prints recovery keys for nine synthetic people; paste one into `/recover` in a separate browser profile to act as that person.

## To deploy (exact steps)

1. Choose a Node host with **persistent PostgreSQL**, **HTTPS** and a **persistent volume** (or implement a private object-storage `PrivateStorage` adapter). Check current prices.
2. Set `DATABASE_URL`, `APP_ORIGIN=https://<domain>`, `JOIN_CODE_HASH_KEY` (`openssl rand -base64 32`), `PRIVATE_UPLOAD_DIR=/data/uploads`, `CLEANUP_TOKEN` (`openssl rand -hex 32`), `NODE_ENV=production`.
3. Follow [runbooks.md → Release](runbooks.md#release). Schedule the daily cleanup and backups.
4. On your iPhone: open the HTTPS URL in Safari → Share → **Add to Home Screen**. On Android: Chrome → **Install app**.

## Known limitations / next steps

See [implementation-plan.md → Next](implementation-plan.md) and [requirements.md](requirements.md) (FR-18/AT-19 partial: no deactivation of referenced members). Also verify on real iPhone Safari before the pilot (Playwright used Chromium with iPhone emulation).

## Repository

Development history lives in this repository's git log (milestone commits). The GitHub repo the owner created for this project could not be reached from the build session at first. See the commit and push notes in the final session report.
