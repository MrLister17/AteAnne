# AteAnne Sprint S9 plan: Claim → Pay → Done, lighter storage

**Approved by the owner on 2026-11-19 with every recommended decision; implemented in v0.8.0.** Release evidence lives in `docs/test-report.md` and `CHANGELOG.md`. This plan replaces the draft `docs/clear-next-steps-plan.md` (branch `docs/clear-next-steps-plan`).
Baseline: `main` at `720e6f7` (v0.7.1, live). Draft reviewed: `docs/clear-next-steps-plan.md` on branch `docs/clear-next-steps-plan` (`7175f0f`). Proposed release: **v0.8.0**, decisions **D53–D57**. No migration, no schema change, no money-rule change.

---

## 0. Baseline: what the code does today

- **Your screenshot is the Claim tab on an equal-split receipt** (`src/ui/event/ClaimTab.tsx:112-118`). After you confirm, it shows your share twice (in the notice and again in a “(est.)” card), “2 of 2 people confirmed. Final totals can differ by one centavo.”, every line item, then “You confirmed your share · Nothing else to do on this receipt.” There’s no button to move on.
- **If that had been the last task in the group, you wouldn’t see this screen.** The save runs `advanceIfReady`, the bill freezes, and the app jumps to Home with “Everyone’s done — the bill is frozen. Time to pay.” So “2 of 2 confirmed” on Claim means the freeze is waiting on something else: the organizer’s **Everyone’s here**, someone’s “I’ve entered every receipt I paid” tick, a payer confirmation, or another receipt. The screen never says which.
- **“What’s next” is computed in four places that already disagree:** `todo.ts` `pendingFor` (guests), `OverviewTab.tsx` `MyTodo` (Home), `EventApp.tsx` `TabBar` (red dots), and `reminders.ts` (copied reminders). For example, only Home asks you to share payment details, and the tab dot ignores disputes.
- **Receipt photos:** scanning stores nothing (`ReceiptScanService`). But saving a scanned receipt then uploads the photo (`ReceiptEditor.tsx:227-234`), and the receipt sheet offers **Attach/Replace photo** (`ReceiptsTab.tsx:189-221`). The bytes are stored in PostgreSQL (`AssetBlob`, because `STORAGE_DRIVER=database` on Vercel).
- **Reimbursements already work the way you describe.** The sender reports a payment, which stays pending until the recipient taps **Received** or **Not received** (which opens a dispute). One reversal is allowed. Partial amounts are allowed up to what’s still open, with idempotency keys and carry-forward through corrections. There’s no proof-upload path. For payments, Priority 2 is wording and next actions only. The ledger stays as it is.
- **Tap feedback exists but has holes** (see S9.3). **RLS is already on.** The real database gaps are in pooling and rate limits (see S9.4).

### Where this plan departs from the draft
1. RLS doesn’t need enabling, because it’s already on. The work is a regression test, so a future table can’t ship without it, plus a read-only production check.
2. AteAnne has no public data, so nothing belongs in a shared CDN cache. Every API response is private and `no-store`, and should stay that way. The only caching idea is private browser caching of image bytes, which never change (follow-up F3, your call).
3. **Not received** becomes **It didn’t arrive**, with a hint to leave the payment open if the money is just slow. That button opens a dispute both people must resolve, so it must not read like “not yet”.
4. **Close it now** gets a confirmation. Today one tap makes the event read-only for good.
5. Found in the code, not in the draft:
   - Rate-limit counters use a second DB connection while the write transaction holds the first.
   - Join and recover create a session row before the IP limit is checked.
   - A failed manual refresh shows a success tick.
   - A server error on first load says “This phone isn’t a member”.
   - No test exercises rate limits (`RATE_LIMIT_DISABLED=1` in every suite).

---

## 1. Screens and copy, starting from “2 of 2 confirmed”

Example: **Breakfast**, split equally, ₱1,397.00, paid by **Mark** (organizer). Two people, Mark and **Ana**, so each share is ₱698.50.

### New Claim layout (same for everyone)
```
Breakfast                       ✓ Share confirmed
Paid by Mark · ₱1,397.00
Your share  ₱698.50
Everyone confirmed (2 of 2)
Can change if someone else joins.      ← only while joining is open

┌ Next for you ─────────────────────┐
│ <one status line>                 │
│ <one short sentence, optional>    │
│ [ one primary button ]            │
│   one secondary link, optional    │
└───────────────────────────────────┘
See items (4)        ›  lines, discounts, “Shares can differ by ₱0.01.”
Change my answer     ›  existing “I disagree” path
```
- The duplicate “(est.)” card goes.
- When not everyone has confirmed, the line reads **1 of 2 confirmed · waiting for Ana**.
- On item-by-item receipts, the item list stays open until you answer, because choosing items *is* the action. After you save, it folds into **See items** with a one-line summary: “You had: Sisig ×1, Rice”.

### The “Next for you” card in each situation

| Who | Situation | Status line | Sentence | Button · link |
|---|---|---|---|---|
| Ana | Another receipt unanswered | **Next: Lunch** | — | **[Claim from Lunch]** |
| Ana | Not done adding receipts yet | **Did you pay for anything else?** | — | **[I’m done adding receipts]** · Add a receipt |
| Ana | Mark entered a receipt Ana paid | **Did you pay ₱500 for Snacks?** | — | **[Check and confirm]** → receipt sheet button **Yes, I paid ₱500** |
| Mark (organizer) | Own tasks done, joining open | **Is everyone here?** | Nobody can join after this. | **[Everyone’s here]** · Invite more people |
| Ana | Done; waiting on organizer | **You’re done for now** | Waiting for Mark to tap Everyone’s here. | See what’s left |
| Mark | Done; waiting on Ana | **You’re done for now** | Waiting for Ana. | **[Copy reminder]** · See what’s left |
| Anyone | Done; a receipt doesn’t add up | **You’re done for now** | Waiting for Lunch to add up. | See what’s left |

- **Waiting for** names up to two people, then “and 3 more”.
- **See what’s left** opens the group list, which is today’s “Waiting on” content.
- **Task order** (first match wins):
  1. Re-check a changed receipt.
  2. Confirm a receipt you paid.
  3. Answer a receipt.
  4. Fix your receipt if it doesn’t add up.
  5. Say you’re done adding receipts.
  6. Organizer: tap Everyone’s here.
  7. Organizer, after a correction: freeze the corrected bill.
  8. Otherwise, wait.

### After the last task, the bill freezes
Everyone sees the toast **Bill frozen. Time to pay.** and lands on Home:

| Who | Status line | Sentence | Button |
|---|---|---|---|
| Ana (owes) | **Pay Mark ₱698.50** | Cash or GCash QR. | **[Pay Mark]** → Pay tab, Mark’s card |
| Mark, no payment details yet | **How should Ana pay you?** | — | **[Add cash or QR]** |
| Mark, details shared | **Waiting for Ana** | Ana will pay you ₱698.50. | — |

**Pay tab, as the sender (Ana)**
- The card is titled **Pay Mark ₱698.50** and shows how Mark wants to be paid, with a **[I sent ₱698.50]** button.
- That button opens a sheet titled **How much did you send?**:
  - the amount is prefilled and editable, for partial payments
  - Cash or QR
  - **Reference (optional)**
  - a button whose label follows the amount, e.g. **I sent ₱400**
- After sending ₱400 the card shows **Sent ₱400 · Waiting for Mark**, **₱298.50 left** and an **[I sent more]** button.
- Once Mark confirms, it shows **Mark got ₱400 · ₱298.50 left** with **[Pay Mark ₱298.50]**.

**Pay tab, as the recipient (Mark)**
- The card asks **Did ₱400 from Ana arrive?** with **[Yes, I got it]**, an **It didn’t arrive** link, and the hint *Not there yet? Leave this and check later.*
- **It didn’t arrive** opens a sheet instead of today’s `prompt()`:
  - **What happened?** (required, e.g. “Nothing came into my GCash”)
  - **[Tell Ana]**
- After that, the existing dispute card appears, retitled **Sort this out with Ana**, with the choices **No money was sent** and **Money was sent — record it again**.

**Once everyone has paid**
- Everyone sees **Everyone’s paid** and *AteAnne closes this tomorrow, so a mistake can still be undone.*
- Mark also gets **Close it now**, styled as a secondary button, with the confirm *Close this hatian? Nobody can change it after this.* Others get no button.

**Done:** **All paid and closed** · **[See summary]** (opens the Money tab).

**After a correction**
- A member whose receipt changed sees **Lunch changed** · **[Check Lunch again]**.
- The organizer sees **Bill fixed?** · **[Freeze the corrected bill]** once it’s ready, and **Waiting for Ana to check Lunch.** until then.

### Status words, used the same way everywhere
| Word | Meaning |
|---|---|
| Share confirmed | You answered this receipt |
| Paid the store | The payer confirmed the receipt amount |
| Sent | The sender says they sent it; waiting for the recipient |
| Received | The recipient confirmed it arrived; it counts toward the balance |
| Didn’t arrive | The recipient said no; both people sort it out |

---

## 2. Work items
Each item lists files or routes · the change · dependencies · a pass/fail check.

### S9.1 One next action (Priority 1)

**S9.1a Single source of “what’s next”**
- **Files:** `src/domain/event/NextAction.ts` (new, pure), `src/server/readmodels/EventViewBuilder.ts`, `tests/unit/next-action.test.ts` (new).
- **Change:** a pure class takes a plain snapshot of the event:
  - phase, cancelled, roster locked, auto-freeze vs correction
  - gate results
  - members
  - receipts with answers, funding and reconciliation
  - transfers with outstanding, pending, capacity and disputes
  - who has shared payment details

  It returns `tasksFor(memberId)` as an ordered list, plus `next`: the first task, or `waiting` with names or reasons. The view adds `view.next` and `view.groupTasks` for the viewer (or for the guest when acting for one).
- **Depends on:** nothing.
- **Pass:**
  - Unit tests cover every row in the tables above, plus partial payments, disputes, corrections, cancelled events and legacy Allocating/Reviewing events.
  - For every fixture where the bill can’t freeze, every member gets a task, or a “waiting” that names at least one person or reason.
  - Fails if any fixture returns an empty wait.

**S9.1b Replace the four copies**
- **Files:** `src/ui/event/todo.ts`, `OverviewTab.tsx` (`MyTodo`), `EventApp.tsx` (`TabBar` attention), `reminders.ts`, and the gate copy in `src/server/aggregate/EventAggregate.ts` (“Ana isn’t done adding receipts yet.”).
- **Change:** all four read `view.next` and `view.groupTasks`. The UI only maps task kinds to words.
- **Depends on:** S9.1a.
- **Pass:**
  - `reminders.test.ts`, `home.spec.ts` and `guests.spec.ts` pass with the updated copy.
  - A new check: the tab with the red dot is always the tab the Next card’s button opens.

**S9.1c “Next for you” card on Home, Claim and Pay**
- **Files:** `src/ui/event/NextCard.tsx` (new), `OverviewTab.tsx`, `ClaimTab.tsx`, `MoneyTab.tsx`, `SettlementSection.tsx`, `src/ui/tutorial/steps.tsx`.
- **Change:**
  - The card sits at the top of Home, replacing the task list (other tasks fold under **Everything left (N)**), under the receipt summary on Claim, and at the top of Pay.
  - The entry tick becomes the **I’m done adding receipts** action. Once done, Home shows a quiet line: **You said you’re done adding receipts · Undo**.
  - **Close it now** gets a confirmation.
- **Depends on:** S9.1a, S9.3a.
- **Pass** (E2E, iPhone 15 and 360px):
  - After Ana confirms Breakfast, Claim shows exactly one primary button, and it’s the one in the table.
  - The card is visible without scrolling at 360×640.
  - Its button lands on the right tab and receipt.
- **Test churn:** specs that tick the entry checkbox switch to the button (`hatian`, `home`, `guests`, `equal-receipt`, `reminders`, and integration `workflow`).

**S9.1d Claim summary and “See items”**
- **Files:** `ClaimTab.tsx`.
- **Change:**
  - Add the summary block from the layout above.
  - Equal-split lines always sit under **See items (N)**.
  - Item-by-item receipts fold after you answer.
  - Remove the duplicate “(est.)” card.
- **Depends on:** S9.1c.
- **Pass:** in the screenshot state, “₱698.50” appears once and line items stay hidden until **See items** is tapped; `equal-receipt.spec.ts` is updated and green.

### S9.2 Receipt details without new photos; confirmation-only reimbursements (Priority 2)

**S9.2a Stop saving new receipt photos**
- **Files and changes:**

  | File or route | Change |
  |---|---|
  | `ReceiptEditor.tsx` | Remove the upload at lines 227-234 |
  | `ReceiptsTab.tsx` | Remove Attach/Replace photo; keep **View photo** for old receipts; add **Remove photo** using the existing `DELETE /api/receipts/:id/image` |
  | `ScanPanel.tsx` | Copy change (below) |
  | `AssetService.upload` and `POST /api/events/:id/assets` | Reject `kind=RECEIPT` with 410 `receipt_photos_off`, before the rate limit and image decoding |

- **What stays the same:**
  - The scan still fills the draft.
  - The photo preview stays in memory while you edit and is dropped on save or close.
  - QR uploads are unchanged.
  - Old photos keep their current access and are deleted with the event at 30 days.
- **New copy:**
  - Under the photo preview: **We don’t keep this photo. Only what you save is kept.**
  - In the scan panel: **We read the photo, you check the details. The photo isn’t saved.**
- **Depends on:** nothing.
- **Pass:**
  - E2E: scan and save sends **no** `POST /assets` request; the list row has no “· photo” and there’s no **View photo**.
  - Integration: a RECEIPT upload returns 410 and adds **zero** `Asset`/`AssetBlob` rows.
  - A seeded legacy photo is readable by a member of its event, returns 404 for a member of another event, and is gone after the retention purge.
- **Test churn:** `scan.spec.ts` (expects **View photo**); `security.test.ts` image tests switch to `kind=QR` or a seeded legacy photo.

**S9.2b Pay and receive wording, plus the “It didn’t arrive” sheet**
- **Files:** `SettlementSection.tsx` (`PayEdge`, `ReportSheet`, `ReportList`, `DisputeCard`, `EdgeHeader`), `ReceiptsTab.tsx` (funding button label).
- **Change:**
  - Copy from section 1.
  - The three-column “Transfer / Confirmed / Reported, pending” becomes one line (“₱400 received · ₱298.50 left”).
  - Payment history moves under **See payments (N)**.
  - **It didn’t arrive** opens a sheet instead of `prompt()`.
  - **No change** to `PaymentLedger`, `PaymentService`, the schema or the routes.
- **Depends on:** S9.1a, S9.3a.
- **Pass:**
  - A new integration test `payments-flow.test.ts` runs this sequence:
    1. Report ₱400 on a ₱698.50 transfer: it’s pending and the balance doesn’t change.
    2. Verify: ₱298.50 is open and `next` reads “Pay Mark ₱298.50”.
    3. Report ₱298.50, then reject it: a dispute opens.
    4. Both choose “record it again”; re-record and verify: the transfer is settled and the done gate is ready.
  - The same test checks two refusals:
    - A sender can never verify their own report.
    - A manager can’t verify a payment they sent to a guest they act for (D39).
  - E2E: the same partial path on two phones shows the exact strings above.
  - `corrections` tests stay green (carry-forward, return transfers).

### S9.3 Every tap answers back (Priority 3)

**S9.3a Shared feedback building blocks (do these first)**
- **Files:** `src/ui/components/ui.tsx`, `src/app/globals.css`, `src/ui/event/EventContext.tsx`.
- **Change:**
  - `Button` gets a `busyLabel` (“Saving…”, “Confirming…”, “Sending…”, “Closing…”, “Freezing…”). Both labels share one grid cell, so the button keeps its width.
  - `useAction` returns `{ ok, error }`. A new `ActionError` shows the message right under the button:
    - offline or a server error: **Couldn’t save. Try again.**
    - a 409 conflict: the server’s own text
    - a 429: **Too many tries. Try again in 2 minutes.**

    Success still uses a toast.
  - Toasts: success goes in a polite live region, errors in an assertive one. Today both are assertive (`ui.tsx:435`).
  - Fix the handlers that call `void act(...)` (**It didn’t arrive**, **I confirmed this by mistake**, **Delete receipt**) so their buttons show they’re busy.
  - The entry toggle becomes a button that’s disabled while saving.
- **Reduced motion:** today the global rule (`globals.css:475`) freezes the spinner and activity bar mid-frame, so only the label is left. Under `prefers-reduced-motion`:
  - busy shows the text label plus a static “…” icon
  - success is a color change plus ✓, with no pop
  - an error is a color change plus ⚠, with no shake
  - sheets and toasts appear without sliding
  - the activity bar becomes a solid 3px bar
  - the scan sweep is hidden; its text progress is already there
- **Depends on:** nothing.
- **Pass** (E2E, responses delayed 2 s):
  - The label reads “Saving…” within 100 ms and the button is disabled.
  - A double tap sends **one** request.
  - On a forced 500, the inline error appears by the button, typed values are kept, and a retry succeeds.
  - All of this also passes with `reducedMotion: "reduce"`, with no animation longer than 0.01 ms running.

**Feedback for each action**
| Action | While busy | Toast | What stays on screen |
|---|---|---|---|
| Confirm my equal share | Confirming… | Share confirmed | ✓ Share confirmed |
| Save my items / I got nothing | Saving… | Items saved / Saved: nothing from Lunch | ✓ Share confirmed + Next card |
| I’m done adding receipts | Saving… | You’re done adding receipts | Next card updates |
| Everyone’s here | Closing… | Joining closed | Next card updates |
| Save receipt | Saving… | Receipt saved | Receipt in list; “Claim your share” if due |
| Yes, I paid ₱500 | Confirming… | Marked as paid | ✓ Paid the store |
| I sent ₱400 | Sending… | Sent. Mark will confirm. | Sent ₱400 · Waiting for Mark |
| Yes, I got it | Confirming… | Got it. ₱400 from Ana. | ₱400 received |
| Tell Ana (didn’t arrive) | Sending… | Saved. Ana will see it. | Sort this out with Ana |
| Close it now | Closing… | Closed. Everything’s settled. | All paid and closed |
| Freeze the corrected bill | Freezing… | Bill frozen. Time to pay. | Pay card |

**S9.3b Loading, refreshing and retrying**
- **Files:** `EventApp.tsx` (`EventLoader`, `Header`, the polling effect).
- **First load:** a skeleton (header and two cards) with visible text **Loading your event…**. After 10 s it adds **Still loading. Check your connection.** and a **[Try again]** button.
- **Load errors are split:**

  | Cause | Screen |
  |---|---|
  | Offline | **You’re offline** + Try again |
  | Server error, 429 or timeout | **Couldn’t load this event** + Try again |
  | 403 or 404 only | Today’s “You can’t open this event here” |

- **Manual refresh:** `reload()` returns whether it worked. Refresh shows ✓ only on success; otherwise it shows the toast **Couldn’t refresh. Check your connection.**
- **Background refresh:** if one fails, a quiet line appears under the header: **Offline · showing 3:42 PM · Try again**. It clears on the next success.
- **Polling:**
  - Skip a poll if a refresh is already running.
  - Merge the `focus` and `visibilitychange` refreshes. Both fire when you return to the app, so today that sends two requests.
  - Stop the 15 s interval on Done and Cancelled events.
  - Keep the immediate refresh after a write, after a manual tap and on return.
- **Depends on:** S9.3a.
- **Pass** (E2E):
  - A delayed first load shows the skeleton text.
  - A forced 500 shows **Try again**, which then loads.
  - A forced 500 on manual refresh shows no ✓.
  - Returning to the tab sends **one** GET.
  - A Done event sends **zero** GETs in 60 s on screen.
  - When Ana reports a payment, Mark’s open Pay tab shows “Did ₱400 from Ana arrive?” within 20 s without a tap.

### S9.4 Database checks (Priority 4)

**What’s in place, from the code**
| Area | Finding |
|---|---|
| RLS | The migration `20261115230235_lock_down_data_api` turns on RLS with no policies on every table that existed then, including `AssetBlob`. It also revokes `anon` and `authenticated` and their default privileges. Later migrations only added columns, so coverage holds. The app connects as the table owner (no FORCE) and uses no Supabase keys or Data API. Cross-event isolation is tested (`security.test.ts:18`). **Gap:** nothing stops a future table shipping without RLS, and no test checks for it. |
| Indexes | Every lookup on the hot path is indexed **except `ReceiptAck` by `receiptId`** (only `(memberId, receiptId)` exists). That lookup runs on every event load. Several foreign-key columns have no index (`Receipt.authorMemberId/payerMemberId`, `SnapshotShare.memberId`, `SettlementEdge.from/to`, `PaymentReport.recipientMemberId`, `Asset.ownerMemberId`). Those only slow down the purge. The nightly cleanup filters (`Event.createdAt`, `RateLimitBucket.windowStart`, `Asset.createdAt`) are unindexed. Tables stay small because events are purged at 30 days, so **measure before adding any index**. |
| Pooling | The app uses `DATABASE_URL` at runtime (per the docs, Supabase’s transaction pooler on :6543). Migrations use `DIRECT_URL` (the session pooler on :5432) through `prisma.config.ts`. There’s one Prisma client per process, a `pg` pool of `max: 3` with a 15 s connect timeout, and transactions get a 20 s timeout and 10 s max wait. **Gap:** `limiter.hit()` runs *inside* `inEvent` on `this.db`. So every receipt save, claim save and payment report holds two connections at once, and keeps the event row locked during the extra round-trip (`ReceiptService.ts:59,80,184`, `PaymentService.ts:89`). When Vercel runs two writes on the same instance, they need four connections from a pool of three. Production also logs the `pg` concurrent-query deprecation warning. |
| Query volume | Every poll (each open phone, every 15 s) loads the whole event, plus payment details, the last 40 activity rows and every old statement’s `facts`. Every write that can finish step 1 loads the whole event twice (`inEvent`, then `advanceIfReady`). Returning to the app fires two reloads. QR images are read again from `AssetBlob` every time the card remounts (`no-store`). |
| Caching | Every API response is `private, no-store` (`route.ts:41`), the service worker never caches `/api/*`, and hashed static assets are cached. There is no public data. This is correct, so don’t add shared caching. |
| Rate limits | **Covered:** create event (by IP, before the session is created); join (failed codes per IP, joins per event); recover (by IP); receipt create/update, claims and payment reports (30 per minute per member); uploads (before decoding); scans (per member and per event, before decoding and the provider call). **Gaps:** join and recover call `actorOrCreate()` *before* the IP check, so a blocked client still creates an `Actor` and a `Session` row per request. 429 responses have no `Retry-After`. Several writes have no limit: verify, reject, cancel, reverse, dispute choice, funding confirmation, delete receipt, entry tick, phase/lock/code, guests/admin/keys, remove member, payment details, cancel or delete event, export. GETs are unlimited. Limits have **no test coverage**, and orphan `Actor` rows are never cleaned up. |

**S9.4a Baseline first, before any S9 change**
- **Files:** `scripts/measure-db.ts` (new, dev-only, test database), `docs/runbooks.md`, `docs/test-report.md`.
- **Change:**
  - The script seeds a realistic event (10 people, 10 receipts × 8 lines, frozen, 9 transfers with reports).
  - It records SQL statements, rows, wall time and JSON bytes for: opening the event, saving claims, reporting a payment and confirming a payment.
  - A Playwright run counts GETs per open phone over 2 minutes on screen, plus one return to the app.
  - You run the read-only production SQL below in the Supabase SQL editor, and I record your numbers as given.
- **Depends on:** nothing. **Do first.**
- **Pass:** the test report has a “before” table for every item, with nothing estimated.

```sql
-- Storage by image type (receipt photos vs payment QR)
select a.kind, count(*) files, pg_size_pretty(sum(octet_length(b.bytes))) stored
from "Asset" a left join "AssetBlob" b on b.key = a."storageKey" group by a.kind;
-- Biggest tables
select relname, pg_size_pretty(pg_total_relation_size(relid)) size, n_live_tup rows
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 10;
-- Sequential vs index scans (is ReceiptAck scanned in full?)
select relname, seq_scan, seq_tup_read, idx_scan from pg_stat_user_tables
order by seq_tup_read desc limit 10;
-- Busiest statements (if pg_stat_statements is enabled)
select calls, round(total_exec_time) total_ms, round(mean_exec_time::numeric, 2) mean_ms, left(query, 100)
from pg_stat_statements order by calls desc limit 15;
-- Connections (run during a 3-phone test)
select usename, application_name, state, count(*) from pg_stat_activity
where datname = current_database() group by 1, 2, 3;
-- RLS and Data API grants
select c.relname, c.relrowsecurity,
  has_table_privilege('anon', c.oid, 'select') anon_read,
  has_table_privilege('authenticated', c.oid, 'select') auth_read
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
```
Also check in Vercel, looking at names and hosts only, never values:
- `DATABASE_URL` points at `…pooler.supabase.com:6543`.
- How many times `/api/events/[eventId]` was invoked.
- Any “timeout exceeded when trying to connect” or P2024 errors in the logs.

**S9.4b RLS regression test**
- **Files:** `tests/integration/database-security.test.ts` (new).
- **Change:** assert `relrowsecurity = true` for every table in the schema. If `anon` or `authenticated` roles exist, assert they have no table or sequence privileges.
- **Depends on:** nothing.
- **Pass:**
  - The test is green on CI.
  - A scratch migration that adds a table without RLS makes it fail (checked locally, not committed).
  - In production, the SQL above shows `relrowsecurity = t` and `false/false` for every table.

**S9.4c Rate-limit check outside the transaction**
- **Files:** `ReceiptService.ts` (create, update, saveClaims), `PaymentService.ts` (report), `RateLimiter.ts`.
- **Change:** call `limiter.hit(financialSavesPerMember, \`${eventId}:${actorId}\`)` *before* `inEvent`, so no lock is held and only one connection is used at a time. The limit is keyed to the real person, per event (decision 4).
- **Depends on:** the S9.4a baseline being recorded.
- **Pass:**
  - A new integration test runs with limits **on** and a 1-connection pool. Create receipt, save claims and report payment all succeed; today they stall until the connect timeout and fail.
  - The 31st save within a minute returns 429.
  - The rest of the integration suite is unchanged.

**S9.4d No session before the IP check; add Retry-After**
- **Files:** `src/app/api/events/join/route.ts`, `src/app/api/recover/route.ts`, `EventService.join`, `RecoveryService.redeem`, `RateLimiter.ts`, `src/server/http/HttpError.ts`.
- **Change:**
  - Check `failedCodePerIp` / `recoveryPerIp` before `actorOrCreate()`.
  - Where it’s simple, create the actor and session only after the code or key matches.
  - `RateLimitedError` carries the seconds left, sent as a `Retry-After` header with the message **Too many tries. Try again in N minutes.**
- **Depends on:** nothing.
- **Pass:**
  - With limits on, 21 bad codes from one IP get a 429 with `Retry-After`, and requests from the 21st on add **no** `Actor` or `Session` rows.
  - A correct code from a new browser still joins.
  - The E2E join and recover specs stay green.

---

## 3. Smallest useful release (v0.8.0) vs follow-up

**Ship in v0.8.0, in this order:**
1. S9.4a: record the baseline before touching code.
2. S9.3a: shared feedback building blocks.
3. S9.1a–d: next action and Claim summary.
4. S9.2a: stop new photos; S9.2b: pay and receive wording.
5. S9.3b: loading, refresh and retry, with polling fixes.
6. S9.4b: RLS test; S9.4c: rate-limit check outside the transaction; S9.4d: join/recover ordering.
7. Re-run S9.4a for the “after” numbers, run the full test chain, update the docs, then ask you before merging or deploying.

Rollback is a plain redeploy of v0.7.1. Old receipt photos stay readable either way.

**Follow-up, after the v0.8.0 numbers are in**
| ID | Item | Do it if… |
|---|---|---|
| F1 | Add `@@index([receiptId])` on `ReceiptAck`, plus foreign-key indexes for the purge | production shows full scans of `ReceiptAck`, or `EXPLAIN (ANALYZE, BUFFERS)` on staging data shows it in the event load, or the nightly purge gets slower |
| F2 | Lighter polling: `ETag`/304 on `GET /api/events/:id`, keyed to the event’s latest activity row and the viewer; load Activity and old statements only when opened | the event load dominates the baseline. Needs a test that every write that changes the view also writes an activity row |
| F3 | `Cache-Control: private, max-age=600` on `/api/assets/:id` (the bytes for an id never change) | QR image requests per Pay visit are high (decision 5) |
| F4 | A coarse per-person write limit on the uncovered routes; a Vercel Firewall rule for GET floods, if the plan includes one | 429s or abuse show up in logs, or the baseline shows a busy route with no limit |
| F5 | Cleanup deletes `Actor` rows with no members and no live sessions | the orphan count isn’t trivial |
| F6 | Replace the remaining `prompt()`s (correction reason, reversal reason) with sheets | — (UX polish) |
| F7 | Tune the `pg` pool `max` | connection peaks and timeouts have been measured with S9.4c in place |
| F8 | Wording for transfers that return an overpayment (“Give back ₱100 to Ana”) | relatives find “Pay Ana” confusing for these |

---

## 4. Decisions for you
1. **Where “what’s next” is worked out.** *I recommend:* a pure domain class run on the server and sent as `view.next`. Then Home, Claim, Pay, the red dots, reminders and guest lists can’t disagree. The alternative is client-only: fewer moving parts, but the logic stays outside `src/domain`.
2. **Old receipt photos.** *I recommend:* keep each one until its event’s normal 30-day deletion, and add **Remove photo**. No bulk delete, since that can’t be undone.
3. **The “Not received” label.** *I recommend:* **It didn’t arrive**, plus the hint “Not there yet? Leave this and check later.” The draft keeps “Not received”.
4. **Who the save limit counts.** *I recommend:* the real person, per event, instead of today’s per-member count. An organizer acting for guests would share one 30-per-minute budget, which is still far above normal use.
5. **Private browser caching of QR images (F3).** *I recommend:* yes, `private, max-age=600`, once the baseline is in. The trade-off: a phone that loses access could keep showing a QR it already loaded for up to 10 minutes.
6. **Home task list.** *I recommend:* one Next card, with the rest folded under **Everything left (N)**. The alternative is keeping the full list visible under the card.
7. **Version and records.** *I recommend:*
   - v0.8.0, with five new decisions:
     - D53: one next action
     - D54: no new receipt photos
     - D55: payment wording
     - D56: feedback states and reduced motion
     - D57: rate-limit placement and creating sessions only after the check
   - Save this plan as `docs/sprint-s9-plan.md` on `claude/stoic-mendel-qflc6n`, replacing the draft.

## 5. Release checks
- **Test chain:** `npm run test:reference && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e`, on iPhone 15 and 360px, in light and dark mode, plus a reduced-motion pass. Real results go in `docs/test-report.md`.
- **Docs to update:** `CHANGELOG.md`, `docs/decisions.md`, `docs/handoff.md`, `docs/implementation-plan.md` (S9), `docs/requirements.md` (S9-xx), `GUIDE.md`, `docs/privacy-and-recovery.md` (photos), and `package.json` (0.8.0).
- **Checks only a person can do:**
  - Feel the presses and loading states on a real iPhone.
  - Watch someone new to AteAnne say what to do next from the “2 of 2 confirmed” screen, without coaching.
  - Run the production SQL above.

