#!/usr/bin/env bash
# Back up PostgreSQL AND private images together, with a manifest linking them.
# Usage: scripts/backup.sh [output-dir]   (reads DATABASE_URL, PRIVATE_UPLOAD_DIR from env/.env)
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
OUT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT/ateanne-$STAMP"
mkdir -p "$DEST"
umask 077
pg_dump --format=custom --no-owner --file "$DEST/db.dump" "$DATABASE_URL"
tar -C "$(dirname "$PRIVATE_UPLOAD_DIR")" -czf "$DEST/uploads.tgz" "$(basename "$PRIVATE_UPLOAD_DIR")"
psql "$DATABASE_URL" -At -c 'SELECT "storageKey" FROM "Asset" ORDER BY 1' > "$DEST/asset-keys.txt"
( cd "$DEST" && sha256sum db.dump uploads.tgz asset-keys.txt > MANIFEST.sha256 )
echo "{\"createdAt\":\"$STAMP\",\"gitCommit\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\",\"assets\":$(wc -l < "$DEST/asset-keys.txt")}" > "$DEST/manifest.json"
echo "Backup written to $DEST (encrypt before moving off-host, e.g. age/gpg)."
