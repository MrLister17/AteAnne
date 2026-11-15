# Privacy, retention and recovery

## What AteAnne collects

Display names (aliases are fine), event data, manually entered receipts and allocations, payment reports and decisions, optional receipt photos and payment QR images. **It never collects** bank or e-wallet passwords, card numbers, contacts, location or phone numbers. Event members can see the group's financial statement; it is a shared hatian, not a private bank ledger.

## Where data lives

- PostgreSQL: all records. Money is stored as integer centavos. Credentials are stored only as SHA-256 hashes.
- Private images: in the database table `AssetBlob` by default (or `PRIVATE_UPLOAD_DIR` outside `public/` with `STORAGE_DRIVER=disk`), random keys, re-encoded with metadata stripped. They are served only through `/api/assets/:id` after a membership check. QR images go only to their owner and to people who owe them.
- Logs never contain request bodies, cookies, recovery keys, join codes or image bytes. Unexpected errors log a request ID, error name and message only.
- The service worker caches only public shell files (icons, offline page, hashed JS/CSS). It never caches API responses or images.

## Retention

| Data | Default |
| --- | --- |
| Done events | Purged with photos 180 days after completion (`npm run data:cleanup`) |
| Active or cancelled events with money outstanding | **Never auto-purged.** The owner exports or explicitly deletes. Cancelling never forgives debts |
| Expired or revoked sessions | Deleted daily |
| Uploads never attached to a receipt or instruction | Deleted after 24 h |
| Backups | Target: daily, encrypted, 7-day retention (see runbooks) |

Whole-event deletion needs the owner to type the title. v1 blocks deletion once any payment was reported; export instead. Deleting records destroys history, not real-world debt. Exported files and backups may persist outside the app.

## Export

People → CSV or JSON. The export contains receipt funding and consumption, frozen shares and edges, and report decisions. It excludes keys, images and storage paths. It is labelled as AteAnne's manual record, not a bank statement.

## Identity and recovery limits (trusted circle)

- No accounts. A browser holds a 30-day session cookie, and one browser profile is one person per event.
- A join code can be forwarded, so whoever has it can join while Collecting. The organizer checks names and removes duplicates before locking the roster. Names can repeat.
- Each person gets a **personal recovery key**, shown once. Redeeming it on a new device moves the *same* member (same ID, receipts, claims, instructions and payments) to that device, rotates the key and signs the old device out of that event. Two simultaneous redemptions cannot both succeed.
- If a browser already controls a different member of that event, recovery is refused; identities are never merged.
- **Limitation:** with neither the old device nor the recovery key, access cannot be restored in v1. The organizer cannot reset or impersonate another person.
- The organizer guides phases but can never claim items, approve the split, confirm payments or resolve disputes for someone else.

## Portfolio privacy

Use synthetic data only (`npm run db:seed`). Never publish real receipts, QR codes, loyalty numbers, names or payment screenshots.
