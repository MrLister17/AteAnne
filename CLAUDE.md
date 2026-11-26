# AteAnne — notes for coding agents

- **Start with [CHANGELOG.md](CHANGELOG.md)**: version history and exactly where the last session stopped. Add an entry for every change you ship.

- Standalone project. Never merge with the portfolio, Kulayan or the Lucena commute guide.
- Mobile-first (iPhone first): keep inputs ≥16px, touch targets ≥44px, respect safe-area insets, test at 360px and iPhone 15 (`npm run test:e2e`).
- UI copy is English only (the brand name Hatian is the one exception). No period at the end of a statement: write one sentence per string and join related clauses with a comma, "so", "and" or parentheses instead of clipped "X. Y." fragments. This covers screens, toasts, errors, prompts, tutorial steps, shared reminder text and server error messages. Abbreviations (`e.g.`, `est.`) and numbered list markers keep their dot. See D66.
- Money is `bigint` centavos; JSON uses decimal strings; never use floats. Business rules live in `src/domain` as pure classes. Do not put rules in React components or route handlers.
- Every money-affecting write goes through a `BaseService` subclass (`inEvent`: lock event row → load `EventAggregate` → check authority/phase/version → act → audit).
- The server recomputes everything; never trust client totals. Frozen snapshots and payment history are append-only.
- Before finishing: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e`. Record real results in `docs/test-report.md`; never invent results, deployments or pilot data.
- Keep `docs/decisions.md` and `docs/handoff.md` current.
- Owner's standing instruction (2026-11-26): "always merge and push to main to deploy". Once the full check chain above passes, merge your branch into `main` and push it (Vercel deploys `main`), then check production `/api/health` and record it.
