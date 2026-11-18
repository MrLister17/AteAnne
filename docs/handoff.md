# Handoff

_Last updated: 2026-11-19 Manila_

## Current state

- **Remote `main` / production: v0.7.1**, code merge `b7d317f`, based on v0.7.0 commit `42da456`. https://ateanne.vercel.app is live; deployment `dpl_BiDM3F9WgMac7WdX3uDextQiu7SE` READY, health `ok:true`, version `b7d317f`, scanner `groq`.
- **Sprint S8 / D52 complete:** People has a compact roster and focused sheets for each person, add-guest, profile/access, downloads, event settings, help/privacy and activity. Shared Sheet restores focus and supports Back without stacking modals. No new migration or changes to v0.7.0 server/domain logic.
- **Preserve v0.7.0 (D49–D51):** Add & claim → Pay → Done; claims work while receipts are collected; saving the payer’s own receipt confirms funding; **Everyone’s here** closes joining. The first bill freezes automatically when everyone is done, with no approval round. After a correction the organizer uses **Freeze the corrected bill**. A paid event closes a day after its last payment activity through the existing daily cleanup, or the organizer may **Close it now**. Tabs remain specific to the current step.
- **Preserve v0.6.1 Simpler Home (D48):** the start screen and event Home retain their focused reading order, current to-do, Next step and plainly labeled disclosures. Its original merge and green GitHub CI run `44370348564` are historical release evidence.
- Migration `20261118150000_equal_receipt_split` was applied by the v0.6.0 production build and verified in Supabase at 14:53:08 UTC on 2026-11-18: boolean, NOT NULL, default false. S8 requires no new migration.

**Verification:** local reference, lint, typecheck, **92 unit**, **49 PostgreSQL integration**, build and **61 browser tests** passed. Full GitHub CI passed on source `7b1d8a5` (run44420961707); merge `b7d317f` has the same tree. Production browser smoke verified hidden-by-default actions and every People group, with a dark phone viewport; synthetic event deleted. Test details and screenshots are recorded in `test-report.md`. No real iPhone or human usability study is claimed.

## What changed

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

- v0.7.0: run one real hatian with relatives. Do people claim right away without waiting, does the organizer find **Everyone’s here**, and is the automatic freeze understood ("Everyone’s done — time to pay")? The daily close relies on the existing Vercel cron (03:17 Manila); check that a fully paid test event closes the next day.
- v0.7.0 trade-off to watch (D50): with no approval round, mistakes are caught by each person’s own claims and by *Something wrong with the bill?*. If groups freeze wrong bills often, revisit.
- v0.6.1 Home / v0.7.1 People: watch a relative who has never used AteAnne find their current task, join code, person details, own recovery key, downloads, help and correction path without guidance.
- Real iPhone Safari installation and reopening, including joining from a Messenger link. Chromium emulation does not test the OS Share sheet or actual Safari storage behavior.
- Try the access hand-over and big-text screen with a relative; verify identity in person and send keys privately.
- Confirm a corrected split’s carry-forward/return-transfer explanation with a real group before relying on it.
- More real receipt photos and the pilot guide. No real bank transfers, scanner-provider calls or adoption evidence were created. Production health, migration and synthetic API smoke were checked; actual iOS installation still needs a person.

Still deferred: referenced-member deactivation (FR-18/AT-19), multi-funder receipts, automatic push reminders, post-Done changes and whole-event deletion after payment reports. Every event still expires after 30 days; export beforehand.
