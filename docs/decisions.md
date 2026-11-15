# Decision log

| # | Date | Decision | Why / alternatives |
| --- | --- | --- | --- |
| D1 | 2026-11-15 | **Separate repository** (`AteAnne`), not inside the portfolio repo | Spec: never merge with Kulayan, the commute guide or the portfolio. |
| D2 | 2026-11-15 | **Mobile-first installable PWA**: manifest, iOS meta, safe-area insets, service worker caching only the public shell | Owner asked for "download as an app on iPhone and Android, optimised for iPhone". A native app store build is out of scope; a PWA installs from Safari/Chrome with no store review. |
| D3 | 2026-11-15 | Reference stack: Next.js 16 App Router, React 19, TS 5.9, Tailwind 4, Prisma 7 + pg adapter, PostgreSQL 16, Zod 4, sharp, Vitest 4, Playwright 1.63 | Spec reference stack. TypeScript 5.9 rather than 7.0, because Next's type tooling targets 5.x. Prisma 7.10.1 rather than the `latest` tag (an 8.0 release candidate). Playwright pinned to the browser build in the environment. |
| D4 | 2026-11-15 | **OOP layering**: immutable value objects, domain service classes, aggregate root, abstract `BaseService`, storage interface, DI container | Owner asked for OOP. Pure domain classes stay framework-free and exhaustively testable. |
| D5 | 2026-11-15 | Money = `bigint` centavos everywhere; `Fraction` for exact weights; JSON uses decimal strings | Spec: no floats; avoid JS number precision issues. |
| D6 | 2026-11-15 | **Stable participant order = join sequence (`Member.seq`)** for tie-breaking and netting | Deterministic, human-meaningful, survives renames and recovery; cuid order is not guaranteed. |
| D7 | 2026-11-15 | **Lock the event row** for every money write | One simple, consistent lock order. Group sizes (≤20) make contention negligible; prevents over-claim and over-report races. |
| D8 | 2026-11-15 | Join codes stored as HMAC + **AES-GCM ciphertext** so the owner can re-display a valid code | Hash-only would force a rotation every time the owner forgets the code. The key is derived from `JOIN_CODE_HASH_KEY`. |
| D9 | 2026-11-15 | Shared join links put the code in the **URL fragment** and clear it after reading | Fragments are not sent to servers or logs. |
| D10 | 2026-11-15 | Receipt edits are only allowed in Collecting; owner corrections are audited `receipt.organizer_correction` and make claims stale | Simplest faithful reading of "visible proposals, no silent edits": people re-confirm their own claims. A separate proposal/accept object is deferred. |
| D11 | 2026-11-15 | Claims saved per receipt with `finish` / `none` / `draft` | Distinguishes genuine zero (`none`) from unanswered, while allowing saved progress. |
| D12 | 2026-11-15 | A rejection automatically opens a dispute; it resolves only when **both** pick the same answer; "re-record" allows exactly one linked replacement report | Spec's versioned two-party resolution, without asking the sender to pay again. |
| D13 | 2026-11-15 | Receipt photos re-encoded to JPEG; QR images to **lossless PNG** | Lossy encoding can damage QR modules. Re-encoding strips EXIF/GPS. |
| D14 | 2026-11-15 | QR visible only to its owner and members who owe them on the active snapshot | "QR scoped to legitimate counterparties". |
| D15 | 2026-11-15 | Whole-event deletion is blocked once any payment is reported | The spec requires all members to approve deletion after reports; that flow is deferred, so v1 blocks it and offers export. |
| D16 | 2026-11-15 | Member removal only while Collecting and only if unreferenced | Prevents erasing ledger references. Deactivation of referenced members is deferred (gap noted in requirements). |
| D17 | 2026-11-15 | Live updates by polling every 15 s plus on focus, not websockets | Simple, works on serverless or edge hosts and in installed PWAs. |
| D18 | 2026-11-15 | Read model fetched client-side; page shells contain no private data | The service worker may cache shells safely; private JSON is always `no-store`. |
| D19 | 2026-11-15 | Accept JPEG/PNG/WebP. The file input uses `accept="image/jpeg,image/png,image/webp"` | iOS Safari then converts HEIC photos to JPEG on upload. |
| D21 | 2026-11-15 | Example names changed to generic **Mark, Juan, Paolo** (and neutral seed names); scenario text removed from the home page | Owner request. Original spec files in `docs/spec/` are kept unchanged as the source documents; only names changed in the reference fixtures (all amounts identical). |
| D22 | 2026-11-15 | **First-visit ask + 12-step tutorial**: a bottom-sheet "First time here?" on first visit (any page), and a "?" / "Tutorial" button on Home, the event header and People | Owner request. The "already asked" flag is a per-browser `localStorage` convenience (no personal data; if storage is blocked the ask may reappear). Illustrations are built from the real UI tokens so they match the app. |
| D20 | 2026-11-15 | `entryComplete` flags are not reset by receipt edits | Receipt changes already invalidate funding acks, claims and approvals through versions; resetting entry flags would add friction without protecting money. |
