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
| S8.1 Compact roster | Show each person as a compact, labeled row; open their available guest, admin, access and removal actions in a focused sheet | Complete; verified |
| S8.2 Focused forms and settings | Add-guest form and labeled profile/access, export, event settings, help/privacy and activity entries open separate sheets; keep existing permission and phase gates | Complete; verified |
| S8.3 Mobile and regression checks | Verify person/section sheet navigation and guest/recovery flows; check Back/Close, keyboard dismissal, ≥44px targets and no overflow at iPhone/360px widths; capture light/dark layouts | Complete; verified |

Decision: D52. Requirements: S8-01–S8-04 in `requirements.md`. Validation uses the full `CLAUDE.md` command chain; record actual results in `test-report.md` before marking this sprint complete. Source CI44420961707 and the full local92-unit/49-integration/61-browser chain passed. Merged as `b7d317f`; production READY and live People browser smoke passed, synthetic event deleted. Root handoff and changelog track release evidence.

## Sprint S9 — Claim → Pay → Done, lighter storage (v0.8.0, 2026-11-19 Manila)

Owner approved the S9 plan ([`sprint-s9-plan.md`](sprint-s9-plan.md)) with every recommended decision. Starting point: the screen where Claim says "2 of 2 confirmed" and nothing says what's next.

| Slice | Acceptance criteria | Status |
| --- | --- | --- |
| S9.4a Baseline first | Local measurement script and polling count recorded before any change; production read-only SQL handed to the owner | Local numbers recorded (`test-report.md`); production SQL pending the owner |
| S9.3a Feedback building blocks | Busy labels, inline errors, polite/assertive toasts, busy state on every action, Reduce Motion cues | Complete; see test report |
| S9.1 One next action | `NextAction` domain class, `view.next`/`view.group`, Next card on Home/Claim/Pay, Claim summary + See items, one tab dot, reminders and guests from the same tasks, Close-it-now confirmation | Complete; see test report |
| S9.2 No new receipt photos; confirmation-only payments | 410 for receipt photos with no rows stored; older photos viewable/removable and purged with the event; Pay/receive wording, "It didn't arrive" sheet, partial-payment status | Complete; see test report |
| S9.3b Loading, refresh, retry | Skeleton + Try again, error states split, refresh failure shown, one request on return, polling stops on Done/cancelled | Complete; see test report |
| S9.4b–d Database checks | RLS regression test, rate-limit counters outside the transaction, no identity before join/recover checks, Retry-After | Complete; see test report |

Decisions: D53–D57. Requirements: S9-01–S9-07. Follow-up after production numbers: F1 (`ReceiptAck.receiptId` and FK indexes), F2 (ETag/304 polling, lazy Activity), F3 (private browser cache for QR bytes), F4 (coarse write limit, Firewall), F5 (orphan actor cleanup), F6 (remaining prompts), F7 (pool size), F8 (return-transfer wording).

## Next (P1 backlog)

1. Deactivate a member who has financial references (redact access, keep money). Gap from FR-18 / AT-19.
2. Deletion after payments with every member's approval.
3. Organizer correction *proposals* (accept/decline objects) instead of direct audited edits.
4. Post-payment append-only bill corrections are included in Sprint S7 above.
5. Multiple funders on one receipt; pooled advances.
6. iOS splash-screen images (`apple-touch-startup-image`) per device size.
7. Object-storage adapter for `PrivateStorage` (e.g. S3-compatible, private bucket).
8. Web push notifications ("Mark confirmed your payment"), which need a push service and user opt-in.
