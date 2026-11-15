# AteAnne — notes for coding agents

- Standalone project. Never merge with the portfolio, Kulayan or the Lucena commute guide.
- Mobile-first (iPhone first): keep inputs ≥16px, touch targets ≥44px, respect safe-area insets, test at 360px and iPhone 15 (`npm run test:e2e`).
- Money is `bigint` centavos; JSON uses decimal strings; never use floats. Business rules live in `src/domain` as pure classes. Do not put rules in React components or route handlers.
- Every money-affecting write goes through a `BaseService` subclass (`inEvent`: lock event row → load `EventAggregate` → check authority/phase/version → act → audit).
- The server recomputes everything; never trust client totals. Frozen snapshots and payment history are append-only.
- Before finishing: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e`. Record real results in `docs/test-report.md`; never invent results, deployments or pilot data.
- Keep `docs/decisions.md` and `docs/handoff.md` current.
