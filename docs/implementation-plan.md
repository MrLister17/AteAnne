# Implementation plan and status

Each milestone was a usable vertical slice with tests.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Foundations | Repo, pinned stack, Prisma schema + DB checks, sessions/recovery hashes, exact-money domain classes, ported fixtures, generated conservation tests | ✅ Done |
| M1 Collect | Create/join by code, roster, receipts with lines/discounts/service, reconciliation bar, payer funding ack, private receipt photos, entry gate, roster lock | ✅ Done |
| M2 Allocate | One-receipt-at-a-time wizard, shared/by-piece claims, "I got nothing", drafts, stale-version handling, concurrent over-claim 409 | ✅ Done |
| M3 Review | Financial versions, self-only approvals, line-by-line breakdown with service basis, proposed edges, immutable snapshot, reopen-before-report | ✅ Done |
| M4 Settle | Versioned cash/QR instructions, reports with reservation + idempotency, recipient confirm/reject, disputes with two-sided resolution and linked replacement, single reasoned reversal, Done gate | ✅ Done |
| M5 Polish | iPhone-first UI (safe areas, 44px targets, 16px inputs, bottom tab bar, sheets), dark mode, reduced motion, install prompt (iOS steps / Android prompt), PWA manifest + icons + SW, security headers/CSP, rate limits | ✅ Done |
| M5b Onboarding | First-visit ask, full start-to-finish walkthrough (12 steps, swipe/keyboard, progress), tutorial buttons | ✅ Done |
| M6 Release | CI workflow, Dockerfile, docker-compose, cleanup job, backup/restore/verify scripts, runbooks, pilot + case-study docs | ✅ Done locally · ⏳ not deployed |

## Sprint S7 — relatives’ next five improvements (2026-11-18)

Owner request: continue from v0.5.0 using the existing vertical-slice SDLC. Work is on `feature/pilot-improvements`; the owner subsequently authorized commit, merge to `main` and production deployment (2026-11-18).

| Slice | Acceptance criteria | Status |
| --- | --- | --- |
| S7.1 Home Screen first | Install guidance before creating/joining; native install prompt where supported; honest Safari Share → Add to Home Screen steps; explicit browser fallback; no duplicate member on install | Complete; verified |
| S7.2 Lost-key recovery | Organizer-only, short-lived single-use replacement; same member/ledger; old device revoked on redemption; no identity merging; visible audit and trust explanation | Complete; verified |
| S7.3 Equal receipt shortcut | Explicit receipt policy, exact centavo conservation; everyone accepts their own share; incomplete/declined answers block review | Complete; verified |
| S7.4 Copy reminders | Current phase-specific next steps; group/person preview and copy for Messenger; no automatic sending or credentials; pending reports never prompt duplicate transfers | Complete; verified |
| S7.5 Post-report corrections | Reasoned correction before Done; pending/disputed transfers resolved first; old statements/history immutable; roster locked; fresh approvals; confirmed transfers carried into remaining balances, including return transfers | Complete; verified |

Validation completed: 87 unit tests, 47 PostgreSQL integration tests and 47 distinct browser scenarios verified (full run plus corrected reminder assertion rerun); lint, typecheck, reference fixtures and production build passed. See `test-report.md` for exact runs.

Validation gate: reference fixtures → lint → typecheck → unit → real PostgreSQL integration → production build → Playwright (iPhone emulation and 360px). Record actual results in `test-report.md`; real iPhone Safari installation remains a human check. Update requirements, decision log, changelog and handoff before delivery.

Release: owner-approved code commit `8a24cc0` merged to `main`; full GitHub CI green, Vercel production READY, migration and live synthetic smoke verified. Details in `test-report.md`.

## Sprint S8 — simplify People (v0.7.1, 2026-11-19 Manila)

Owner request: reduce the amount of information and controls shown at once in People. This slice reorganizes the existing UI on top of v0.7.0; the three-step Add & claim → Pay → Done flow, automatic first freeze, manual corrected freeze, financial calculations, recovery rules and server authorization stay in their existing services. The earlier local v0.6.1 People candidate was integrated with the newer `main` and renumbered to avoid replacing the already released v0.6.1 Simpler Home work.

| Slice | Acceptance criteria | Status |
| --- | --- | --- |
| S8.1 Compact roster | Show each person as a compact, labeled row; open their available guest, admin, access and removal actions in a focused sheet | In progress |
| S8.2 Focused forms and settings | Add-guest form and labeled profile/access, export, event settings, help/privacy and activity entries open separate sheets; keep existing permission and phase gates | In progress |
| S8.3 Mobile and regression checks | Verify person/section sheet navigation and guest/recovery flows; check Back/Close, keyboard dismissal, ≥44px targets and no overflow at iPhone/360px widths; capture light/dark layouts | Pending verification |

Decision: D52. Requirements: S8-01–S8-04 in `requirements.md`. Validation uses the full `CLAUDE.md` command chain; record actual results in `test-report.md` before marking this sprint complete. Root handoff and changelog track release state.

## Next (P1 backlog)

1. Deactivate a member who has financial references (redact access, keep money). Gap from FR-18 / AT-19.
2. Deletion after payments with every member's approval.
3. Organizer correction *proposals* (accept/decline objects) instead of direct audited edits.
4. Post-payment append-only bill corrections are included in Sprint S7 above.
5. Multiple funders on one receipt; pooled advances.
6. iOS splash-screen images (`apple-touch-startup-image`) per device size.
7. Object-storage adapter for `PrivateStorage` (e.g. S3-compatible, private bucket).
8. Web push notifications ("Mark confirmed your payment"), which need a push service and user opt-in.
