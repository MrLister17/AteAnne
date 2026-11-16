# Deploy to Vercel

AteAnne runs on Vercel with **one PostgreSQL database** and nothing else: private receipt and QR images are stored in the database (`STORAGE_DRIVER=database`, the default), because Vercel functions have no persistent disk.

> Pricing and free-tier limits change. Check Vercel's and your database provider's current plans before you rely on them. Vercel's Hobby plan is for personal, non-commercial projects.

## 0. Just want to look around first? (preview mode)

You can import and deploy **before** the database exists. With no `DATABASE_URL` / `JOIN_CODE_HASH_KEY`, the build prints "PREVIEW MODE", skips migrations and still deploys. Every screen, button and the tutorial work. A banner says the database isn't connected, and anything that would save shows "AteAnne isn't connected to its database yet". Add the variables later and **Redeploy** (Deployments → ⋯ → Redeploy) to switch to the real thing.

## 1. Create the project

1. Sign in at **vercel.com** with GitHub.
2. **Add New… → Project** → import **MrLister17/AteAnne**.
3. Framework preset: **Next.js** (auto-detected). Leave the build and output settings as they are. `vercel.json` already sets the build command (`npm run vercel-build`), the **Singapore region (`sin1`)** (closest to the Philippines) and a daily cleanup cron.
4. **Don't deploy yet.** Click into the project settings first, or let the first deploy fail; it will tell you which variables are missing.

## 2. Add a PostgreSQL database

### Option A — Supabase (what the owner is using)

1. Create the Supabase project in region **Southeast Asia (Singapore)** so it's next to the Vercel `sin1` functions.
2. In Supabase click **Connect** (top of the dashboard). Copy two connection strings, replacing `[YOUR-PASSWORD]` with your database password:
   - **Transaction pooler** (port **6543**) → Vercel variable **`DATABASE_URL`**. Used by the app at runtime; it handles many short serverless connections.
   - **Session pooler** (port **5432**, same `…pooler.supabase.com` host) → Vercel variable **`DIRECT_URL`**. Used only for migrations during the build.
   - Don't use the "Direct connection" (`db.<ref>.supabase.co`) from Vercel: on Supabase's standard setup it is IPv6-only, and Vercel builds connect over IPv4.
3. **Leave AteAnne's tables alone in Supabase.** The first production deploy creates them. A migration turns on Row Level Security for every table with no policies and revokes the `anon`/`authenticated` roles, so Supabase's auto-generated Data API can't read or change anything. Supabase's Security Advisor may then note "RLS enabled, no policy". That is intended: AteAnne never uses the Data API.
4. **Event auto-deletion:** AteAnne itself deletes every event 30 days after creation (daily cron; set `EVENT_RETENTION_DAYS` to change it). **Don't add a separate Supabase job that deletes rows from `"Event"`.** The ledger tables block cascading deletes on purpose, so a plain `DELETE FROM "Event"` fails, and it would not remove the stored photos (`AssetBlob`). If you already created such a job (pg_cron or a scheduled function), disable it.

### Option B — Neon via the Vercel Marketplace

In the Vercel project open **Storage → Create Database → Neon (Postgres)**, pick a region near **Singapore**, and connect it to the project for **Production** (and Preview, if you want). This adds `DATABASE_URL` (pooled) and an unpooled URL (`DATABASE_URL_UNPOOLED`) that AteAnne uses automatically for migrations.

Any other PostgreSQL 14+ works too (Supabase, Railway, your own). Set `DATABASE_URL` to its **pooled** connection string and, if it has one, `DIRECT_URL` to the direct/unpooled string.

## 3. Add environment variables

Project → **Settings → Environment Variables** (Production; add to Preview too if you use previews):

| Name | Value |
| --- | --- |
| `JOIN_CODE_HASH_KEY` | a long random secret: run `openssl rand -base64 32` and paste it. **Keep it stable**; changing it invalidates open join codes. |
| `CRON_SECRET` | another random secret, `openssl rand -hex 32`. Vercel Cron sends it to the cleanup job. |
| `GROQ_API_KEY` | optional, **free tier available**. Turns on **Scan a receipt** using a Groq-hosted vision model. Create it at console.groq.com → API Keys. In Groq's console also turn on **Zero Data Retention** (Settings → Data Controls). |
| `GROQ_VISION_MODEL` | optional, default `qwen/qwen3.6-27b` (a *preview* model at the time of writing). If scans start failing with "model isn't available", set this to Groq's current vision model ID and redeploy. |
| `ANTHROPIC_API_KEY` | optional. Turns on **Scan a receipt** (photo → draft receipt via Claude). Get a key at console.anthropic.com and set a monthly spend limit there. Without it, the Scan button is hidden and receipts are typed in. |
| `RECEIPT_SCAN_MODEL` | optional, default `claude-opus-5-5`. |
| `EVENT_RETENTION_DAYS` | optional, default `30`. Every event, finished or not, is deleted this many days after it was created. |
| `APP_ORIGIN` | optional. Your public URL, e.g. `https://ateanne.vercel.app` or your custom domain. Defaults to the project's production URL. |
| `DATABASE_URL` | Supabase **transaction pooler** URL (or set automatically by the Neon integration) |
| `DIRECT_URL` | Supabase **session pooler** URL (Neon: not needed; `DATABASE_URL_UNPOOLED` is used automatically) |
| `DATABASE_SSL_CA` | Supabase server root CA certificate in PEM format, downloaded from its Connect panel. Required if Node reports a self-signed certificate chain. Certificate verification stays enabled. |

No secrets go in the repository. `.env` is ignored by git.

## 4. Deploy

Click **Deploy** (or push to `main`). For **production** deployments the build:

1. checks the required variables,
2. runs `prisma generate`,
3. runs `prisma migrate deploy` (creates/updates the tables),
4. builds Next.js.

Preview deployments skip migrations so they never touch production data. To migrate a preview that has its own database branch, set `MIGRATE_ON_BUILD=1` for Preview.

## 5. Check it works

- Open `https://<your-domain>/api/health` → `{"ok":true}`.
- On your **iPhone**: open the site in **Safari** → Share → **Add to Home Screen**. On **Android**: Chrome → **Install app**.
- Do a quick synthetic run with a friend's phone: create an event, join with the code, add a receipt, claim, approve, freeze, report a payment and confirm it. Then delete the test event (People → Delete event).

## Notes

- **Uploads:** phones shrink photos before upload (Vercel's request limit is 4.5 MB). The server re-encodes them and strips metadata. They are stored privately and served only to members of that event.
- **Cleanup:** runs daily at 03:17 Manila time (`vercel.json` → crons). It removes expired sessions and abandoned uploads, and **deletes every event 30 days after it was created, finished or not** (`EVENT_RETENTION_DAYS`). The app shows each event's deletion date on its Home tab and warns in the last 7 days.
- **Backups:** database exports include these database-backed images. Supabase Free does not include the paid-plan automatic backup access; keep your own exports with `DATABASE_URL=<session pooler url> scripts/backup.sh`. Store them privately.
- **Custom domain:** Project → Settings → Domains. Then set `APP_ORIGIN` to it and redeploy.
- **Logs:** Project → Logs. Errors show a request ID only; no personal data or secrets are logged.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build fails: "Missing environment variables" | Add `DATABASE_URL` / `JOIN_CODE_HASH_KEY` (step 3) and redeploy |
| Build fails at `prisma migrate deploy` | The database isn't reachable. Check the URL, and that `DATABASE_URL_UNPOOLED` or `DIRECT_URL` is a direct connection |
| "Cross-site request blocked" | Set `APP_ORIGIN` to the exact URL you open (including `https://`) and redeploy |
| Photo upload says "too large" | Use a smaller photo or a screenshot (the limit after shrinking is about 4 MB) |
| Health check fails with a self-signed certificate chain | Set `DATABASE_SSL_CA` to Supabase's root CA PEM and redeploy. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable certificate validation. |
