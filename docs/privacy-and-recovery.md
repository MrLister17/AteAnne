# Privacy, retention and recovery

## What AteAnne collects

Display names (aliases are fine), event data, manually entered receipts and allocations, payment reports and decisions, and optional payment QR images. Since v0.8.0 (D54) new receipt photos are not stored; photos saved before then stay private to the event until it is deleted, and can be removed sooner. **It never collects** bank or e-wallet passwords, card numbers, contacts, location or phone numbers. Event members can see the group's financial statement; it is a shared hatian, not a private bank ledger.

## Where data lives

- PostgreSQL: all records. Money is stored as integer centavos. Credentials are stored only as SHA-256 hashes.
- Private images: in the database table `AssetBlob` by default (or `PRIVATE_UPLOAD_DIR` outside `public/` with `STORAGE_DRIVER=disk`), random keys, re-encoded with metadata stripped. They are served only through `/api/assets/:id` after a membership check. QR images go only to their owner and to people who owe them.
- **Receipt scanning (optional):** when someone taps "Scan a receipt", that photo (re-encoded, with metadata removed) is sent to the configured reader to draft the receipt: **Groq** (default when `GROQ_API_KEY` is set; turn on Zero Data Retention in Groq's console) or Anthropic's Claude API. It is not stored: the photo stays on the phone while you check the draft and is dropped when you save or close. Only the details you save are kept. Don't scan receipts that show information you don't want processed by a third party.
- Logs never contain request bodies, cookies, recovery keys, join codes or image bytes. Unexpected errors log a request ID, error name and message only.
- The service worker caches only public shell files (icons, offline page, hashed JS/CSS). It never caches API responses or images.

### Exchange rates (v0.9)

To convert receipts and payments in other currencies, the server asks Frankfurter (`api.frankfurter.dev`, ECB reference rates) for a day's published rates. The request contains only a date: no event, person, amount or device data. The answer is cached in the `ExchangeRate` table, which holds no event data and is shared by all events. Phones never contact the rate service directly (the content security policy still allows only the app's own origin).

## Retention

| Data | Default |
| --- | --- |
| **Every event, finished or not** | Deleted with all photos **30 days after it was created** (`EVENT_RETENTION_DAYS`, daily cleanup). Each event shows its deletion date and warns in the last 7 days. Deleting the record does not cancel real-world debts; export a copy first if you need one |
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
- **Lost key and device:** ask the organizer in person. Only the organizer may issue replacement access for an active phone member, after checking their identity. The replacement expires after 15 minutes and can be redeemed once. Issuing it immediately invalidates the previous recovery key; the previous phone keeps access until redemption. The same member ID, admin role and all financial records are preserved. The organizer cannot use their own already-enrolled browser to merge identities. This is a trusted-circle recovery power: an organizer who hands the key to the wrong person could give them your access. Keep the key private, never in the group chat.
- The organizer guides phases and can issue replacement access, but cannot directly claim items, confirm payments or resolve disputes for phone members. Organizer/admin act-for access is limited to people explicitly added without a phone.

## Portfolio privacy

Use synthetic data only (`npm run db:seed`). Never publish real receipts, QR codes, loyalty numbers, names or payment screenshots.
