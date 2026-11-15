#!/usr/bin/env bash
# Restore a backup into an ISOLATED database + upload dir, then verify.
# Usage: RESTORE_DATABASE_URL=... RESTORE_UPLOAD_DIR=... scripts/restore.sh backups/ateanne-<stamp>
set -euo pipefail
SRC="$1"
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL (an empty, isolated database)}"
: "${RESTORE_UPLOAD_DIR:?set RESTORE_UPLOAD_DIR (an empty directory)}"
( cd "$SRC" && sha256sum -c MANIFEST.sha256 )
pg_restore --no-owner --clean --if-exists --dbname "$RESTORE_DATABASE_URL" "$SRC/db.dump"
mkdir -p "$RESTORE_UPLOAD_DIR"
tar -C "$RESTORE_UPLOAD_DIR" --strip-components=1 -xzf "$SRC/uploads.tgz" 2>/dev/null || true
DATABASE_URL="$RESTORE_DATABASE_URL" PRIVATE_UPLOAD_DIR="$RESTORE_UPLOAD_DIR" npx tsx scripts/verify-restore.ts
