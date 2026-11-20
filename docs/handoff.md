# Handoff

_Last updated: 2026-11-20 Manila (v0.10.0)_

## Current state (v0.10.0)

- **v0.10.0 (D64): running event payments and credit.** It is built on v0.9.1 (compact event screens, D63, PR #1).
  - Anyone can record cash already handed over, during Add & claim or Pay. The recipient confirms it.
  - Confirmed cash counts everywhere through `EventAggregate.confirmedTransfers()`.
  - Paying ahead shows as Credit.
  - During Pay, a confirmation re-plans the statement in the same transaction.
  - The migration `20261120120000_running_event_payments` is additive. It was released without a backup at the owner's request.
- **Preserve:**
  - Apply transfers to raw nets only.
  - Allow one cash question at a time during Pay.
  - Re-planning keeps the receipt facts, shares and locked rates.
  - Never fetch FX inside a lock.

## Current state

- **v0.9.0 (Sprint S10, D58–D62): mixed currencies.** The owner approved every decision and asked for merge and deploy. What it does:
  - Each receipt has its own currency and purchase date.
  - Each event has one settle-up currency (default ₱).
  - A foreign receipt converts at the ECB rate of the day it was bought, fixed at the freeze.
  - **Show totals in** gives a per-person "≈" view at today's rate.
  - **Pay in** lets someone send another currency the receiver accepts, at the rate of the day it's sent, locked into the payment.
  - Migration `20261119120000_currencies` is additive.
  - Rates come from Frankfurter/ECB, fetched only outside event locks. `/api/health` reports `fx`.
  - Local full chain passed (258 unit / 74 integration / 75 browser).
  - Live on `main` `b040a74`. Branch CI 44482869560 passed.
  - Production health: `fx.ok: true`, with a real ECB rate fetched.
  - The synthetic production smoke test passed and its event was deleted.
- **Preserve S10:**
  - The money engine still sees integers only. Conversion is once per receipt, then a largest-remainder split.
  - Only `PaymentReport.amountCentavos` (the settle-up credit) enters the ledger.
  - Never fetch rates inside `inEvent`.
  - The settle-up currency can't change after any payment report.
- **Remote `main` / production: v0.8.0**, code commit `1557289` (fast-forward from `720e6f7`). CI run 44452776502 passed; https://ateanne.vercel.app health `ok:true`, version `1557289`, scanner `groq`; production smoke passed and its synthetic event was deleted. The owner approved the S9 plan with every recommended decision and asked for this merge and deploy.
- **Preserve S9:** one next step per person from `src/domain/event/NextAction.ts` via `view.next`/`view.group`, shown in the **Next for you** card on Home, Claim and Pay; the tab dot, guest list, "See what's left" and reminders read the same list. New receipt photos are never stored (410 `receipt_photos_off`); older ones stay viewable/removable until their event is purged. Payment wording is Sent / Received / Didn't arrive. Rate-limit counters run before event transactions; join/recover create identities only after their checks pass; 429s carry Retry-After.
- **Preserve v0.7.1 / v0.7.0 / v0.6.1:** compact People roster and focused sheets (D52); Add & claim → Pay → Done, automatic first freeze, manual corrected freeze, next-day close (D49–D51); focused Home reading order (D48).
- No migration in S9. Production schema is unchanged since `20261118150000_equal_receipt_split`.
- Schema: S10 added migration `20261119120000_currencies` (after `20261118150000_equal_receipt_split`).

**Verification:** local 240 unit / 64 integration / 71 browser plus reference, lint, types and build; GitHub CI 44452776502; production health and smoke. Before/after measurements are in `test-report.md`. Production SQL numbers (storage by image type, scans, connections, RLS/grants) have **not** been collected yet; the queries are in `runbooks.md`.

## What changed

0. S9 (v0.8.0): **Next for you** card everywhere (one action), Claim summary + **See items**, no new receipt photos, Sent / Received / Didn't arrive payment wording with a reason sheet, busy/error/retry feedback that also works with Reduce Motion, one refresh on return and none once Done, rate limits outside transactions, no identities for wrong join/recover attempts, RLS regression test.

1. Mobile create/join still starts with Home Screen installation guidance and an explicit browser fallback. Safari requires Share → Add to Home Screen. Recovery is never blocked by installation.
2. Organizer replacement access is still a private 15-minute single-use key after checking identity in person. It preserves the member, roles and financial records; redemption revokes the old browser’s event access.
3. Whole-receipt equal sharing still requires each person’s own acceptance, with exact conservation and final shares within one centavo. In v0.7.0, claiming is the agreement; there is no separate approval round.
4. Home → Next step → Copy reminder previews and copies current person/group tasks for manual Messenger pasting. It never sends automatically or prompts a duplicate pending transfer.
5. Before Done, Home → Next step → *Something wrong with the bill?* → **Correct the bill** preserves statements and confirmed money. Resolve pending reports/disputes first, correct receipts/claims in Add & claim, then the organizer manually freezes the corrected bill. Overpayments become return transfers. Done remains read-only.
6. S8 People: tap a roster name for their permitted actions. **Add someone without a phone** opens its form; **Your profile & access**, **Download event record**, **Event settings**, **Help & privacy** and **Activity** open focused sheets. Back returns to the parent; Close returns to the roster. The labels and hints stay visible for discoverability.

## Run and verify

Use README setup, an isolated PostgreSQL test database and Node 22. Commands: reference, lint, typecheck, unit, integration, build, E2E. Never reset production. This session’s Node 22 executable lives under `/home/agent/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin`; local `.env` uses synthetic development secrets and is ignored. PostgreSQL runs via Docker Compose. Browser tests run against a production build on port 3100 and an isolated test database.

**Rollback:** once correction statements exist, v0.5 is not accounting-compatible even though the migration is additive. Use a compatible forward fix; never reset money/history to roll back.

## Remaining human checks

- v0.9.0:
  - Try a real Bangkok-style trip on an iPhone: a ฿ receipt typed or scanned (check the scanned currency and date), **Show totals in ฿**, **Pay in** baht, and the receiver confirming the baht.
  - Check that `/api/health` shows `fx.ok: true` on production on a few different days.

- v0.8.0: hand a phone to someone new at the "2 of 2 confirmed" screen and ask what they'd do next, without coaching. Try **I'm done adding receipts**, **Everyone's here**, a partial **I sent**, **Yes, I got it** and **It didn't arrive** on a real iPhone, including with Reduce Motion on. Run the read-only production SQL in `runbooks.md` and record the numbers before any index or pool change (follow-up F1/F7).

- v0.7.0: run one real hatian with relatives. Do people claim right away without waiting, does the organizer find **Everyone’s here**, and is the automatic freeze understood ("Everyone’s done — time to pay")? The daily close relies on the existing Vercel cron (03:17 Manila); check that a fully paid test event closes the next day.
- v0.7.0 trade-off to watch (D50): with no approval round, mistakes are caught by each person’s own claims and by *Something wrong with the bill?*. If groups freeze wrong bills often, revisit.
- v0.6.1 Home / v0.7.1 People: watch a relative who has never used AteAnne find their current task, join code, person details, own recovery key, downloads, help and correction path without guidance.
- Real iPhone Safari installation and reopening, including joining from a Messenger link. Chromium emulation does not test the OS Share sheet or actual Safari storage behavior.
- Try the access hand-over and big-text screen with a relative; verify identity in person and send keys privately.
- Confirm a corrected split’s carry-forward/return-transfer explanation with a real group before relying on it.
- More real receipt photos and the pilot guide. No real bank transfers, scanner-provider calls or adoption evidence were created. Production health, migration and synthetic API smoke were checked; actual iOS installation still needs a person.

Still deferred: referenced-member deactivation (FR-18/AT-19), multi-funder receipts, automatic push reminders, post-Done changes and whole-event deletion after payment reports. Every event still expires after 30 days; export beforehand.
