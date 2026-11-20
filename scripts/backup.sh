#!/usr/bin/env bash
# Back up PostgreSQL AND private images together, with a manifest linking them.
# Usage: scripts/backup.sh [output-dir]   (reads DATABASE_URL, PRIVATE_UPLOAD_DIR from env/.env)
# A DATABASE_URL given on the command line always wins over .env, so
# `DATABASE_URL=<production session pooler> scripts/backup.sh` never dumps the local dev database.
set -euo pipefail
GIVEN_DATABASE_URL="${DATABASE_URL:-}"
[ -f .env ] && set -a && . ./.env && set +a
if [ -n "$GIVEN_DATABASE_URL" ]; then DATABASE_URL="$GIVEN_DATABASE_URL"; fi
: "${DATABASE_URL:?set DATABASE_URL (the database to back up)}"
echo "Backing up host: $(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^/:?]+).*#\2#')"
OUT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT/ateanne-$STAMP"
mkdir -p "$DEST"
umask 077
pg_dump --format=custom --no-owner --file "$DEST/db.dump" "$DATABASE_URL"
if [ "${STORAGE_DRIVER:-database}" = "disk" ] && [ -d "$PRIVATE_UPLOAD_DIR" ]; then
  tar -C "$(dirname "$PRIVATE_UPLOAD_DIR")" -czf "$DEST/uploads.tgz" "$(basename "$PRIVATE_UPLOAD_DIR")"
else
  # database storage: image bytes are inside db.dump (AssetBlob table)
  tar -czf "$DEST/uploads.tgz" --files-from /dev/null
fi
psql "$DATABASE_URL" -At -c 'SELECT "storageKey" FROM "Asset" ORDER BY 1' > "$DEST/asset-keys.txt"
( cd "$DEST" && sha256sum db.dump uploads.tgz asset-keys.txt > MANIFEST.sha256 )
echo "{\"createdAt\":\"$STAMP\",\"gitCommit\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\",\"assets\":$(wc -l < "$DEST/asset-keys.txt")}" > "$DEST/manifest.json"
echo "Backup written to $DEST (encrypt before moving off-host, e.g. age/gpg)."
