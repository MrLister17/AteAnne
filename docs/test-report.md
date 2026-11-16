# Test report

**Run:** 2026-11-15 · Linux container · Node 22.23.4 · PostgreSQL 16.15 (local, isolated `ateanne_test` database) · Chromium for Playwright 1.63.0.
All commands were run from a clean working tree. The output below is copied from the actual run log.

| Command | Result |
| --- | --- |
| `npm run test:reference` | `PASS: reconciliation, allocations, conservation, net transfers, partial/rejected/verified reports, and centavo rounding.` The regenerated JSON was byte-identical to the supplied fixture |
| `npm run lint` | exit 0, no warnings |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **5 files, 49 tests passed** |
| `npm run test:integration` | **4 files, 30 tests passed** (real PostgreSQL) |
| `npm run build` | Compiled successfully; 35 routes |
| `npx playwright test --trace off` | **28 passed** (iPhone 15 emulation + 360px Android width) |

## Vercel deployment simulation

A fresh `git clone` with no `.env`: `npm ci` (no env vars) passed. `npm run vercel-build` with no variables exits with a clear "Missing environment variables" message. With only `DATABASE_URL`, `JOIN_CODE_HASH_KEY`, `CRON_SECRET`, `VERCEL_ENV=production` and `VERCEL_PROJECT_PRODUCTION_URL`, it applied all 3 migrations to an empty database and built successfully. `next start` on that build, with database image storage, passed these checks: health ok; create event; private `no-store` response; `Secure` session cookie; QR upload stored in `AssetBlob`; member reads image 200 and stranger 401; cleanup cron 401 without the secret and 200 with `CRON_SECRET`; forged cross-site POST 403. This simulation caught and fixed a `.gitignore` rule that had excluded `src/server/storage/` from git. No real Vercel deployment has been made.

## Live Groq receipt scans (2026-11-16)

Run with `npx tsx scripts/try-scan.ts <image>` against Groq's API with the owner's key (proxy-injected; the value was never visible to the build session). The test images were three **synthetic** receipts rendered with a slight tilt and blur.

- `GET /models` showed that `qwen/qwen3.6-27b` (the earlier default, from a third-party doc) is **not** offered; `qwen/qwen3.8-27b` is, and it accepts images. The default was changed to it.
- Groq `json_schema` mode with an image returned well-formed JSON with **garbage values** (`"line_total": "}, {"`). `json_object` mode returned correct values, so the reader uses JSON mode.
- Free-tier limit observed: **7,000 input tokens/minute** for this model (one 429 hit while probing). One scan ≈ 2,000–2,500 input tokens, so about 2–3 scans per minute app-wide. SDK retries were turned off so a 429 shows "busy" immediately instead of hanging.

| Receipt | Time | Result |
| --- | --- | --- |
| Restaurant: 4 items (qty/unit prices), 10% service, VATable/VAT lines, cash and change | 1.5 s | All items and quantities correct; service captured; VAT, cash and change ignored; **reconciled** at PHP 940.50 |
| Senior citizen: Less VAT exemption + 20% SC discount, SC ID and name printed, GCash line | 1.7 s | VAT exemption and SC discount captured as discounts; **name/ID not copied**; **reconciled** at PHP 714.29 |
| Loyalty 15% on the VAT-exclusive price (same totals as the pictured-receipt fixture), service, VISA line | 3.1 s | 6 items incl. "6 @ 45.00" and "4 @ 200.00"; printed 592.63 normalized to **663.75** with a warning; **reconciled** at PHP 4,046.70 (matches the fixture) |

## What the suites cover

**Unit (`tests/unit`)**: every value in `reference/AteAnne_Expected_Calculations.json`: rounding (incl. the beyond-`MAX_SAFE_INTEGER` case), rejection messages, pictured-receipt reconciliation, nine-person dinner (each person's shared/rice/solo/service/owed/net and the transfers), scoped discount, multiple receipts and netting, and the full report → reject → verify → reverse timeline. **2,000 generated allocation cases** check exact sums, zero-weight-gets-zero, determinism and no negatives. **500 generated receipts** with scoped discounts and service check reconciliation, nets summing to zero, and full settlement by the planned edges. Plus `Money` parsing/formatting/bounds, payment-ledger rules and phase transitions.

**Integration (`tests/integration`, real PostgreSQL)**:
- Workflow: the Mark / Juan / Paolo multi-receipt event through every phase. Creator ≠ payer; payer-only funding ack; guest cannot edit others' receipts; organizer correction is audited and makes the funding ack stale; stale receipt version returns 409; entry gate; roster lock blocks late joins; None vs unanswered; reference nets/edges; same-version approvals; reopen before any report (superseded snapshot); pending reservation; idempotent replay; over-report rejected; no reopen after a report; sender and owner cannot verify; reject → dispute blocks reports; non-counterparty cannot resolve; two-sided resolution; **parallel double-verify credits once**; reversal recipient-only and once; Done blocked while pending; reversal blocked after Done; history retained.
- Security: cross-event read/write denied; foreign member ID as payer rejected; code grants no owner authority; rotated code dies and lower-case codes are normalized; join code not stored in plain text; 20-person cap; **4 concurrent claims on 3 rice units → exactly one 409, 3 units saved**; claims are always the caller's own; stale claim version returns 409; zero-basis service flagged; recovery keeps member ID and payer role, old key single-use, no identity merge; image re-encode strips an embedded EXIF marker, SVG and 9 MB uploads rejected, cross-event image read denied, random storage key; QR visible only to the owner.

**E2E (`tests/e2e`, production build, isolated contexts)**:
- `hatian.spec.ts`: organizer and two guests on separate emulated iPhones. Create, share code by link, join, enter receipts (shared/by-piece/service, payer ≠ creator), payer confirmations, entry complete, lock, claims (Juan skips rice and gets nothing from drinks; Paolo blocked from over-claiming), review shows +706.00 / −495.00 / −211.00 and Juan's service basis text, everyone approves, freeze, organizer uploads a synthetic QR plus a cash note, Juan reports PHP 200 cash (balance unchanged while pending), Mark confirms (balance becomes −295.00), remaining payments incl. QR, Done disabled while pending, confirms, Done, reload shows settled. No horizontal scroll. Second test: a stranger's browser gets the "can't open" screen, the API returns 401 with no-store, and a forged cross-origin POST returns 403.
- `tutorial.spec.ts` (both projects): first visit shows the "First time here?" ask; "Show me how" opens the walkthrough; every one of the 12 steps renders with no horizontal scroll; the last step offers "Start a hatian"/"Got it"; the ask does not reappear after reload; the Tutorial button reopens it; Back and Escape work; "Maybe later" dismisses it for good.
- `layout.spec.ts` (both projects): no horizontal scroll, every input labelled, every visible button/link ≥44px tall at 360px on all entry pages; visible keyboard focus; reduced motion honoured; manifest (standalone, maskable icon), apple-touch-icon, viewport-fit=cover, service worker served.

## Not verified here (honest gaps)

- **Receipt scanning on real phone photos.** Live Groq scans were run only on three *synthetic* receipt images (see below), not on real photos of crumpled or faded receipts. Check a few real receipts after deploying. The Claude reader has not had a live call.

- Real iPhone Safari and Android Chrome devices (only Chromium emulation of iPhone viewport/UA/touch). WebKit-specific rendering and actual *Add to Home Screen* behaviour still need a manual check on a phone.
- Production HTTPS deployment, `Secure` cookies over TLS, and a deployed smoke test (**not deployed**).
- Session/recovery/join-code expiry by time travel (the code paths are reviewed but not clock-tested).
- Zero-debt event closing via the UI (the gate logic is covered; no dedicated E2E).
- Restore rehearsal used dev data without snapshots or images.
- Screen-reader walkthrough (labels and roles are tested automatically; no VoiceOver/TalkBack session).
- Any real-world payments, research or pilot outcomes: none have happened.
