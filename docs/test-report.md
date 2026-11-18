# Test report

## v0.6.1 "Simpler Home" (2026-11-18, branch `claude/bold-mayer-xb2jcw`, not merged or deployed)

UI-only change (D48): the start screen and the event Home tab were reordered and decluttered. No server, domain, route, migration or money code changed. Local Linux run: Node 22.23.5, PostgreSQL 16.15 (local cluster, isolated `ateanne_test` database), pre-installed Playwright Chromium. Synthetic data only.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | PASS (reconciliation, allocations, conservation, transfers, reports, rounding) |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed (Prisma generate + `tsc --noEmit`) |
| `npm run test:unit` | **10 files, 87 tests passed** |
| `npm run test:integration` | **8 files, 47 tests passed** on real PostgreSQL |
| `npm run build` | Passed, production build |
| `npm run test:e2e` | **51 passed** in one full run (1.1 min): the 47 existing scenarios plus 4 new ones (`home.spec.ts` × iPhone 15 and 360px) |

What the new and changed browser tests prove:
- **`home.spec.ts` (new):**
  - Organizer Home reads *Your to-do* → *Next step* → *Invite people*.
  - The "I’ve entered every receipt I paid" tick is visible without scrolling, for the organizer and for a member.
  - *New code* / *Close joining* are hidden until *More join options* is tapped.
  - The auto-delete date sits at the bottom.
  - A member sees "Waiting on" and "Mark, the organizer, moves everyone on…", with no organizer buttons or join code.
  - Start screen, first visit: the walkthrough is inside *How it works* and the recovery-key link appears exactly once, on screen.
  - Start screen, returning: *Your events* is above *Start a hatian* and *How it works* is folded but opens with one tap.
  - Every Home and start-screen check also confirms no sideways scroll and that visible buttons, links and disclosure rows are at least 44px tall.
- **`corrections.spec.ts` (updated):** *Correct the bill* is hidden until *Something wrong with the bill?* is opened, and *Back to claims* is reached through *Need to fix something? Go back a step*. The full correction flow then passes as before.
- All other specs (`hatian`, `guests`, `reminders`, `equal-receipt`, `install`, `tutorial`, `layout`, `recovery`, `scan`) passed unchanged; button labels were kept on purpose.

Before/after screenshots were taken by driving both the previous build (`515a9d7`) and this one through identical synthetic steps on a local database.

The known `pg` concurrent-query deprecation warning appeared on stderr during integration and E2E runs; nothing failed because of it. The `package.json` version bump to 0.6.1 and the doc edits were made after this run; no application code changed after it.

Not verified: real iPhone Safari, and whether real relatives find the moved controls (*Go back a step*, *Correct the bill*, *More join options*) without help. That needs a person.

---

## Authorized production release (2026-11-18)

- Source commit: `8a24cc06cecad6031808b1a5440f7f1dacd69f34`, fast-forwarded into `main` after owner approval.
- GitHub CI: [44328507489](https://github.com/MrLister17/AteAnne/actions/runs/44328507489), **success** on all steps: reference, lint, types, unit, real PostgreSQL integration, production build, **47 E2E tests in one full run**.
- Vercel production deployment `dpl_DKFndt2NyoP1C3pmRzi73dhwRNQL`: **READY**, https://ateanne.vercel.app. Health HTTP 200: `{"ok":true,"version":"8a24cc0","receiptScan":"groq"}`; response `Cache-Control: no-store`.
- Supabase read-only verification: new column boolean/NOT NULL/default false; Prisma migration `20261118150000_equal_receipt_split` finished `2026-11-18T14:53:08.996817Z`, no rollback.
- Live synthetic API smoke: **PASS** for create/join, persisted equal policy and exact 51/50 centavo split, approval/freeze allocation-v2, reasoned correction keeping old statement, organizer replacement access preserving member identity, old browser denied and signed-out browser denied. Event deleted afterward. **No payment reports or real transfers created**; post-report/return-transfer accounting was verified by automated isolated tests.
- Smoke harness adjustments: Node client required the inherited network proxy; a signed-out browser correctly returns 401 (not the initially expected 404). Corrected harness then passed. These were test-harness issues, not production app changes.
- Post-smoke deployment runtime scan returned one known `pg` concurrent-query deprecation warning on stderr (Vercel labels stderr as error); no application exception was returned. All smoke requests had expected status codes. No claim of continuous monitoring, backup verification or real iPhone OS installation.

---

## Sprint S7 / v0.6.0 (2026-11-18, local `feature/pilot-improvements`)

Base checked: remote `main` commit `2a3a8db`. This section records the local implementation checks before the subsequently authorized release above. Local Linux runtime: Node 22.23.5, PostgreSQL 16.16 via Docker Compose, Playwright Chromium 153. Only synthetic development/test data; no production services or provider calls.

| Command | Actual result |
| --- | --- |
| `npm run test:reference` | Passed (Python reference fixtures; no fixture diff) |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed, Prisma generation + TypeScript |
| `npm run test:unit` | **10 files, 87 tests passed** |
| `npm run test:integration` | **8 files, 47 tests passed** on real PostgreSQL |
| `npm run build` | Passed, production build |
| `npm run test:e2e` | **47 distinct scenarios verified**: full run 45 passed / 2 reminder assertion failures; corrected case-sensitive expected text and reran `tests/e2e/reminders.spec.ts`: **2/2 passed** |

Full story under test: mobile install guidance → create/join → receipt policy/own acceptance → server recomputation → review/freeze → payment report/receiver confirmation → correction/fresh approvals/return transfer, alongside organizer reissue → new browser recovery → stable identity/old browser revocation, and manual reminder preview/copy. Existing lifecycle/security tests are retained. New E2E flows ran both iPhone emulation and 360px Android width.

Independent review checked conservation and authority; fixed the big-text and header corrected balances and clarified settlement captions. An initial browser run found exact tab-name selectors did not allow the existing “needs your attention” accessible suffix; these were corrected. The subsequent full run passed correction/equal/recovery/install workflows on both widths; only a reminder test’s expected text capitalization failed, then both reminder reruns passed. The expanded repeated-correction/reversal integration scenario was rerun separately and passed after the full PostgreSQL suite. No application code changed after the successful final build. Snapshots now preserve the equal-receipt policy and allocation policy version. PostgreSQL tests emitted an existing `pg` concurrent-query deprecation warning; no test failed because of it.

Not verified here: actual iOS Safari Share sheet/installation or storage transfer, real relative usability/pilot, real bank transfers, new live scanner-provider requests, production migration/deployment during the initial local implementation (subsequently verified above). Safari cannot be programmatically installed with one website-triggered confirmation; native prompts are tested with synthetic browser events, and Safari guidance is tested in Chromium emulation.

---

## Cousins pilot fixes (2026-11-18, branch `cousins-feedback`)

This session's container could not install npm packages (network policy), so **nothing was run locally**. The full chain was run by GitHub Actions (`.github/workflows/ci.yml`, real PostgreSQL 16 service, Chromium) on the branch. Results below are copied from the job logs of run 44318660752 (commit `210c230`; run 44318003068 on `2fbfdfc` was identical):

| Command | Result |
| --- | --- |
| `npm run test:reference` | passed |
| `npm run lint` | exit 0 (the first push, `a9035b4`, failed lint: a ref read during render in `EventApp.tsx`; fixed in `2fbfdfc`) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **7 files, 70 tests passed** (new: `guest-policy`, `entry-math`) |
| `npm run test:integration` | **5 files, 41 tests passed** (new: `guests.test.ts`, 11 tests) |
| `npm run build` | Compiled successfully |
| `npm run test:e2e` | **31 passed** (new: `guests.spec.ts`; `hatian.spec.ts` updated for auto totals) |

What the new tests prove:
- **Guests:** only the organizer/admins add guests or act for them; nobody can act for a person with their own phone; a non-manager can't act at all; the view while acting is the guest's (no organizer data); a guest can be a receipt's payer and a manager confirms the funding; managers claim and approve for guests through Freeze; every acting audit entry names the real person with `onBehalfOf` the guest; an admin who paid Lola is refused when confirming it for her, another manager can; the event reaches "ready for Done"; a hand-over key works (pasted with a line break), can't be redeemed on a manager's own phone, and ends guest status.
- **Auto-compute (browser):** 2 × ₱75 fills the line total and the receipt total; a default 10% service charge on ₱1,030 gives ₱103; typing ₱1,130 shows "off by PHP 3.00", ₱1,133 shows "matches".
- **Recovery (browser):** a key pasted (with a line break) into the join-code box is recognised and redeemed on a second phone; Home shows "I have a recovery key".
- **Big-text screen (browser):** shows "Your share so far" PHP 60.00 and the item at iPhone 15 width with no sideways scroll.

**After merging to `main` (commit `99fa5ec`, run 44322635354):** everything passed except one older E2E step. It reloads Juan's phone right after Mark taps **Received**, and sometimes looks before the save finishes ("−PHP 495.00" instead of "−PHP 295.00"). That is a race in the test, not the app; the same code passed on the branch three times. The test now waits for Mark's "Confirmed received" before reloading. The Vercel production deployment of `99fa5ec` reported "Deployment has completed" (GitHub commit status).

**Not verified:** a real iPhone (CI uses Chromium with iPhone emulation), the person screen in dark mode or by eye (CI screenshots aren't kept as artifacts), the Paste button (clipboard permission), and the iPhone Home Screen notice (needs a real installed app). The production deploy and migration have not been run.

---

## Earlier run (2026-11-16)

**Run:** 2026-11-16 · Linux container · Node 22 · PostgreSQL (local, isolated `ateanne_test` database) · Chromium for Playwright.
The results below are copied from the actual run log of this session.

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0, no warnings |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **5 files, 63 tests passed** |
| `npm run test:integration` | **4 files, 30 tests passed** (real PostgreSQL) |
| `npm run build` | Compiled successfully |
| `npx playwright test --trace off` | **30 passed** (iPhone 15 emulation + 360px Android width) |

`npm run test:reference` was not re-run in this session (no change to money rules).

## Scan and feedback changes (2026-11-16, second session)

Checked by browser tests on both phone sizes, with the fake reader:
- The Receipts tab and the Add-receipt form show **Take photo** (opens the back camera) and **Upload photo**; both are at least 44px tall.
- A file that is not a photo leaves a message on screen ("That didn’t work", the reason, and Retake / Upload photo) instead of a toast that vanishes.
- Tapping **Save receipt** on an unfinished form shows "Not saved yet. Fill in …" above the open sheet and moves to the first missing field. Before this session that message was drawn underneath the sheet.
- The press effect for buttons is present in the stylesheet.
- After the button restyle (D33) the full chain was run again: lint and typecheck exit 0, 54 unit, 30 integration, build, **30 browser tests passed**. Dark and light screenshots of Home, Overview, Receipts and the receipt form were looked over by hand in iPhone 15 emulation; no automated visual comparison exists.
- **Production check from the owner's phone (2026-11-16):** `/api/health` on the live site returned version `a0e494b` (the latest at that time) and `receiptScan: off` with the hint that `GROQ_API_KEY` is not set in the production environment, and no similarly named setting was found. So the cause is the Vercel setting, not the code.

**Not verified:** the production site. This session could not reach the Vercel site or the Vercel API (blocked by the session's network settings), so the diagnosis came from the owner opening `/api/health` on their phone (see above). No live Groq call and no real phone photo was scanned in this session. The Cancel button, the 55-second time-out and the camera/HEIC behaviour on a real iPhone have no automated test.

## First real receipt (2026-11-16, third session)

The owner scanned a real restaurant receipt on the live site (7 items, 15% loyalty discount on the VAT-exclusive price, service charge, card payment; long receipt on a dark folder). Printed total PHP 4,046.70.

| Version | Result on that photo |
| --- | --- |
| Live site before this change | Items came to PHP 3,305.00 instead of 4,425.00; **off by PHP 1,048.88**, discount not converted |
| Same pipeline re-run here (`try-scan`, before changes) | Two item amounts wrong (680 → 580, 460 → 450), quantity 3 read as 1, no unit prices, store name wrong |
| After cropping to the paper + new instructions (raw reading) | All items, quantities and unit prices right except 460 read as 450; in two of three runs the service charge 285.45 was read as 265.45 |
| After the checking layer (2 consecutive live runs, ~2.0 s each) | **Every amount matches the printed receipt**: 7 items = 4,425.00, service 285.45, discount 592.63 → 663.75, **reconciled at PHP 4,046.70**. The banner lists the three corrections it made. Store name read as "GOHA" (printed "GOMA"). |

Caveats: this is **one** receipt, and the test image was the owner's screenshot of the photo (lower resolution than the camera original). The corrections rely on the receipt printing unit prices and a subtotal; receipts without them fall back to a plain "items don't add up" warning. More real receipts are still needed. The full chain was run after these changes: lint and typecheck exit 0, **63 unit** (9 new), **30 integration**, build, **30 browser tests** passed.

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
