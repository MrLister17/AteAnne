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
| M6 Release | CI workflow, Dockerfile, docker-compose, cleanup job, backup/restore/verify scripts, runbooks, pilot + case-study docs | ✅ Done locally · ⏳ not deployed |

## Next (P1 backlog, not started)

1. Deactivate a member who has financial references (redact access, keep money). Gap from FR-18 / AT-19.
2. Deletion after payments with every member's approval.
3. Organizer correction *proposals* (accept/decline objects) instead of direct audited edits.
4. Post-payment append-only bill corrections.
5. Multiple funders on one receipt; pooled advances.
6. iOS splash-screen images (`apple-touch-startup-image`) per device size.
7. Object-storage adapter for `PrivateStorage` (e.g. S3-compatible, private bucket).
8. Web push notifications ("Joy confirmed your payment"), which need a push service and user opt-in.
