# Runbooks

> **Vercel:** see [deploy-vercel.md](deploy-vercel.md). The steps below are for self-hosting with Docker.

## Production prerequisites

- A Node 22 host (container or VM), **persistent PostgreSQL**, **HTTPS** and a **persistent private volume** for uploads mounted at `PRIVATE_UPLOAD_DIR`. An ephemeral or serverless filesystem would lose receipt photos and QRs. Check current pricing and limits before provisioning; no free tier is assumed.
- Separate dev, test and production databases and upload directories.
- Environment: `DATABASE_URL`, `APP_ORIGIN` (exact https origin), `JOIN_CODE_HASH_KEY` (stable, ≥32 random bytes, kept secret; changing it invalidates outstanding join codes), `PRIVATE_UPLOAD_DIR`, `CLEANUP_TOKEN`, `NODE_ENV=production`. Do not set `RATE_LIMIT_DISABLED`.

## Release

1. `scripts/backup.sh` (database + uploads + manifest).
2. CI must be green: reference, lint, typecheck, unit, integration, build, E2E.
3. Build the image: `docker build -t ateanne:<git-sha> .`
4. Migrate (a controlled step, run once): `docker run --rm --env-file prod.env ateanne:<sha> npx prisma migrate deploy`
5. Start: `docker run -d --env-file prod.env -v ateanne-uploads:/data/uploads -p 3000:3000 ateanne:<sha>` behind an HTTPS reverse proxy that forwards `X-Forwarded-For`.
6. Smoke test over HTTPS: `/api/health` returns ok. Response headers show `Cache-Control: private, no-store` on `/api/*` and a `Secure; HttpOnly; SameSite=Lax` cookie. Create a SYNTHETIC event, then on a second phone join, claim, review, freeze, report, confirm and Done. Check that a receipt photo loads only for members. Then delete the synthetic event.
7. Record the URL, commit and result in `docs/handoff.md`.

Never run `npm run db:seed` against production (it refuses unless `ALLOW_PRODUCTION_SEED=1`).

## Scheduled cleanup

Daily: `curl -X POST -H "Authorization: Bearer $CLEANUP_TOKEN" https://<host>/api/maintenance/cleanup`, or `npm run data:cleanup` from a job with DB and volume access. It deletes expired sessions, stale rate buckets, abandoned uploads (24 h) and Done events older than 180 days. It never deletes active or cancelled events with money outstanding.

## Backup

`scripts/backup.sh [dir]` writes `db.dump` (pg_dump custom format), `uploads.tgz`, `asset-keys.txt`, `MANIFEST.sha256` and `manifest.json` (commit, asset count). Encrypt before moving off-host (e.g. `age -r <recipient>`). Initial targets, not guarantees: daily, 7-day retention, recovery point ≤24 h, recovery within one working day.

## Restore (rehearse before trusting)

1. Create an **empty isolated** database and directory.
2. `RESTORE_DATABASE_URL=… RESTORE_UPLOAD_DIR=… scripts/restore.sh backups/ateanne-<stamp>`. This verifies checksums, restores, extracts files, then runs `scripts/verify-restore.ts`, which checks that every snapshot's nets and funding-minus-cost sum to zero and that every asset file exists.
3. Point a staging instance at the restored data and smoke-test it. Then switch production configuration.
4. **Never recompute or rewrite frozen snapshots** during a restore. Re-apply any deletions approved after the backup was taken.

Rehearsed locally on 2026-11-15 against dev data (checksums OK, restore OK, verify OK). That data had no snapshots or images, so rehearse again with a settled synthetic event before production.

## Rollback

Roll the **application** back to the previous schema-compatible image (`ateanne:<previous-sha>`). Prefer additive migrations so the previous release still runs. Do not assume a down-migration can undo real financial history. If data is damaged, restore into an isolated DB and reconcile; do not overwrite payment history.

## Storage

Watch volume usage (photos are ≤ ~1 MB after re-encode, limited to 8 MB input and 20 MP). To move to object storage, implement `PrivateStorage` for a **private** bucket with server-side reads, and never expose public URLs.

## Incidents

Money or access bug during the pilot: freeze new events (take the app offline or set a maintenance banner), back up, investigate from `AuditEvent` and the payment tables, and tell affected groups exactly what happened. Never edit payment rows by hand to "fix" balances.
