# Deploy to Vercel

AteAnne runs on Vercel with **one PostgreSQL database** and nothing else: private receipt and QR images are stored in the database (`STORAGE_DRIVER=database`, the default), because Vercel functions have no persistent disk.

> Pricing and free-tier limits change. Check Vercel's and your database provider's current plans before you rely on them. Vercel's Hobby plan is for personal, non-commercial projects.

## 1. Create the project

1. Sign in at **vercel.com** with GitHub.
2. **Add New… → Project** → import **MrLister17/AteAnne**.
3. Framework preset: **Next.js** (auto-detected). Leave the build and output settings as they are. `vercel.json` already sets the build command (`npm run vercel-build`), the **Singapore region (`sin1`)** (closest to the Philippines) and a daily cleanup cron.
4. **Don't deploy yet.** Click into the project settings first, or let the first deploy fail; it will tell you which variables are missing.

## 2. Add a PostgreSQL database

Easiest: in the Vercel project open **Storage → Create Database → Neon (Postgres)**, pick a region near **Singapore**, and connect it to the project for **Production** (and Preview, if you want). This adds `DATABASE_URL` (pooled) and an unpooled URL (`DATABASE_URL_UNPOOLED`) that AteAnne uses automatically for migrations.

Any other PostgreSQL 14+ works too (Supabase, Railway, your own). Set `DATABASE_URL` to its **pooled** connection string and, if it has one, `DIRECT_URL` to the direct/unpooled string.

## 3. Add environment variables

Project → **Settings → Environment Variables** (Production; add to Preview too if you use previews):

| Name | Value |
| --- | --- |
| `JOIN_CODE_HASH_KEY` | a long random secret: run `openssl rand -base64 32` and paste it. **Keep it stable**; changing it invalidates open join codes. |
| `CRON_SECRET` | another random secret, `openssl rand -hex 32`. Vercel Cron sends it to the cleanup job. |
| `APP_ORIGIN` | optional. Your public URL, e.g. `https://ateanne.vercel.app` or your custom domain. Defaults to the project's production URL. |
| `DATABASE_URL` | set automatically by the Neon integration, or paste your own |

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
- **Cleanup:** runs daily at 03:17 Manila time (`vercel.json` → crons). It removes expired sessions and abandoned uploads, and purges Done events after 180 days.
- **Backups:** your database provider's backups/point-in-time restore cover everything, images included. For your own copy: `DATABASE_URL=<direct url> scripts/backup.sh`.
- **Custom domain:** Project → Settings → Domains. Then set `APP_ORIGIN` to it and redeploy.
- **Logs:** Project → Logs. Errors show a request ID only; no personal data or secrets are logged.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build fails: "Missing environment variables" | Add `DATABASE_URL` / `JOIN_CODE_HASH_KEY` (step 3) and redeploy |
| Build fails at `prisma migrate deploy` | The database isn't reachable. Check the URL, and that `DATABASE_URL_UNPOOLED` or `DIRECT_URL` is a direct connection |
| "Cross-site request blocked" | Set `APP_ORIGIN` to the exact URL you open (including `https://`) and redeploy |
| Photo upload says "too large" | Use a smaller photo or a screenshot (the limit after shrinking is about 4 MB) |
