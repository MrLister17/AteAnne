# Handoff

_Last updated: 2026-11-18_

## Current state

- Remote `main`: v0.5.0, last checked commit `2a3a8db`. Latest changelog and the repository SDLC were read before work.
- Local `feature/pilot-improvements`: **v0.6.0 / Sprint S7**, implementing the owner’s five improvements. The owner authorized committing, merging to `main` and production deployment on 2026-11-18; release checks and CI are in progress. Actual deployment results will be recorded after verification. See [CHANGELOG.md](../CHANGELOG.md), [implementation-plan.md](implementation-plan.md), decisions D43–D47 and [test-report.md](test-report.md).
- New migration `20261118150000_equal_receipt_split` adds `Receipt.equalSplit` with default false. Only local test/development databases were migrated during implementation. The authorized production release runs this migration in the Vercel build. Apply before serving new code in production.

**Verification:** reference fixtures, lint, typecheck and production build passed; 87 unit, 47 PostgreSQL integration and 47 distinct browser scenarios verified (full run plus targeted reminder rerun). Detailed failures/fixes and real-device limits are recorded in the test report.

## What changed

1. Mobile create/join is preceded by Home Screen installation guidance and an explicit browser fallback. Safari requires Share → Add to Home Screen; no website API opens that confirmation. Native prompts are used where supported. Copy a shared join code before installing, then join inside the app. Recovery is never blocked by installation.
2. Organizer can reissue a private, 15-minute single-use key after checking a phone member’s identity in person. Reissue invalidates the old key immediately; redemption moves the same member, preserving money/roles and revoking the old browser’s event access. This is an explicit trusted-circle recovery power, not additional act-for access.
3. Whole-receipt equal policy and per-person one-tap acceptance. Everyone must agree before review; exact component conservation and final shares within one centavo.
4. Home → Copy reminder → choose person/group → preview/copy → manually paste into Messenger. Current tasks only; pending payments do not ask for another transfer.
5. Organizer → Correct the bill before Done, with a reason and no pending/disputed reports. Earlier immutable history is preserved, roster remains locked, everyone reapproves, and all confirmed money carries forward. Overpayments create return transfers. Reverse any mistaken confirmation before superseding its statement. Done stays read-only.

## Run and verify

Use README setup, an isolated PostgreSQL test database and Node 22. Commands: reference, lint, typecheck, unit, integration, build, E2E. Never reset production. This session’s Node 22 executable lives under `/home/agent/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin`; local `.env` uses synthetic development secrets and is ignored. PostgreSQL runs via Docker Compose. Browser tests run against a production build on port 3100 and an isolated test database.

**Rollback:** once correction statements exist, v0.5 is not accounting-compatible even though the migration is additive. Use a compatible forward fix; never reset money/history to roll back.

## Remaining human checks

- Real iPhone Safari installation and reopening, including joining from a Messenger link. Chromium emulation does not test the OS Share sheet or actual Safari storage behavior.
- Try the access hand-over and big-text screen with a relative; verify identity in person and send keys privately.
- Confirm a corrected split’s carry-forward/return-transfer explanation with a real group before relying on it.
- More real receipt photos and the pilot guide. No new real bank transfers, scanner-provider calls, adoption evidence or production checks were performed.

Still deferred: referenced-member deactivation (FR-18/AT-19), multi-funder receipts, automatic push reminders, post-Done changes and whole-event deletion after payment reports. Every event still expires after 30 days; export beforehand.
