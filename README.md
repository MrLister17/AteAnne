# AteAnne — hatian na malinaw, bayaran na tama

> **New here? Read [GUIDE.md](GUIDE.md)**: a complete map of the app, how it works, and how to change things.

AteAnne (a pun on *hatian*, splitting a bill) is a **mobile-first, installable web app** for splitting shared expenses by **what each person actually had**, then settling with **payments that only the receiver can confirm**.

- Whoever paid enters the receipt: items, quantities, discounts, service charge, exact total.
- First-time visitors are asked if they want a quick walkthrough; a **Tutorial** (?) button opens it any time.
- Optional **Scan a receipt**: take a photo and a vision model drafts the items, service charge and total for you to check. Use Groq's free tier (`GROQ_API_KEY`) or Claude (`ANTHROPIC_API_KEY`).
- Everyone claims their own items — shared equally or by piece — or says “I got nothing from this receipt”.
- Everyone approves the same server-calculated split, to the centavo.
- People pay outside the app (cash or their own QR); the **recipient** confirms money arrived. Only then does a debt go down.

Built for small groups of friends in Lucena City. It is designed for **iPhone first** (Safari → Share → *Add to Home Screen*) and also installs on Android (Chrome → *Install app*). No accounts, no bank logins, no payment processing. Receipt scanning with Claude is optional; typed entry always works.

> **Deploy:** ready for Vercel + PostgreSQL. Follow [docs/deploy-vercel.md](docs/deploy-vercel.md).

> Status: engineering complete for the P0 workflow and verified locally (see [docs/test-report.md](docs/test-report.md)). **Not deployed** yet, and **not piloted** with real groups. See [docs/handoff.md](docs/handoff.md).

## Quick start (local)

Requirements: Node 22+, PostgreSQL 16 (Docker or native), Python 3 (optional, for the reference arithmetic).

```sh
# 1. Database — pick one
docker compose up -d db                       # Docker: creates ateanne_dev + ateanne_test
# or native PostgreSQL:
#   createuser -P ateanne   (password: ateanne)
#   createdb -O ateanne ateanne_dev && createdb -O ateanne ateanne_test

# 2. App
npm install
npm run setup        # writes .env with generated secrets, applies migrations, generates the client
npm run db:seed      # optional: synthetic 9-person demo dinner (prints recovery keys)
npm run dev          # http://localhost:3000
```

To test on your phone during development, run `npm run dev -- -H 0.0.0.0` and open `http://<your-computer-ip>:3000` on the same Wi-Fi (set `APP_ORIGIN` to that URL). Installing as an app and secure cookies need HTTPS in production.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run setup` | Create `.env` (never overwrites), `prisma migrate deploy`, `prisma generate` |
| `npm run db:migrate` | Apply migrations (controlled release step) |
| `npm run db:migrate:dev` | Create a new migration during development |
| `npm run db:seed` | Synthetic demo data. Refuses `NODE_ENV=production` |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run test:unit` | Domain + fixture tests (Vitest) |
| `npm run test:integration` | Services against real PostgreSQL (`TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright, iPhone + 360px, against a production build. Run `npm run build` first |
| `npm run test:reference` | Supplied Python reference assertions |
| `npm run data:cleanup` | Daily housekeeping (expired sessions, orphan uploads, retention purge) |
| `npm run vercel-build` | What Vercel runs: env check → `prisma generate` → migrate (production only) → `next build` |
| `npm run icons` | Regenerate PWA / iOS icons |
| `scripts/backup.sh`, `scripts/restore.sh` | Database + private-image backup and verified restore |

## Stack (actual versions)

Next.js 16.4.6 (App Router) · React 19.3.1 · TypeScript 5.9.3 · Tailwind CSS 4.3.5 · PostgreSQL 16 · Prisma 7.10.1 (+ `@prisma/adapter-pg`, `pg` 8.23.1) · Zod 4.6.7 · sharp 0.35.5 · Vitest 4.1.12 · Playwright 1.63.0 · ESLint 9.39.5 · Node 22.

## Project layout (object-oriented, layered)

```
src/
  domain/      Pure business rules as classes, with no I/O: Money, Fraction, LargestRemainderAllocator,
               ReceiptReconciler, ReceiptCalculator, EventLedger, SettlementPlanner,
               PaymentLedger, PhaseMachine, DomainError hierarchy
  server/
    aggregate/ EventAggregate (aggregate root: gates, calculations, settlement state) + EventRepository
    services/  Application services: EventService, ReceiptService, PaymentService,
               RecoveryService, AssetService, QueryService, CleanupService (extend BaseService)
    readmodels/EventViewBuilder: safe, member-scoped JSON projection
    auth/ security/ storage/ http/   sessions, crypto, rate limits, private storage port, route wrapper
    container.ts  AppContainer (composition root / dependency injection)
  app/         Next.js pages + API routes (thin: parse → service → JSON)
  ui/          Mobile UI components, event tabs, PWA helpers
prisma/        schema, migrations (incl. DB check constraints), synthetic seed
tests/         unit/ integration/ e2e/
reference/     Supplied Python reference + expected JSON fixtures
docs/          Requirements, architecture, rules, runbooks, reports, original spec
```

Read [docs/architecture.md](docs/architecture.md) for the class, ER, lifecycle and payment diagrams.

## Documentation

- [docs/requirements.md](docs/requirements.md): FR/AT traceability to code and tests
- [docs/implementation-plan.md](docs/implementation-plan.md): milestones M0–M6 and status
- [docs/decisions.md](docs/decisions.md): decision log
- [docs/architecture.md](docs/architecture.md): OOP design, ER, lifecycle, payment state machine
- [docs/financial-rules.md](docs/financial-rules.md): exact-money rules with worked examples
- [docs/test-report.md](docs/test-report.md): commands run and actual results
- [docs/privacy-and-recovery.md](docs/privacy-and-recovery.md): privacy, retention, recovery limits
- [docs/deploy-vercel.md](docs/deploy-vercel.md): step-by-step Vercel deployment
- [docs/runbooks.md](docs/runbooks.md): deploy, storage, migration, backup, restore, rollback, cleanup
- [docs/pilot-guide.md](docs/pilot-guide.md): running a real small-group pilot
- [docs/case-study-template.md](docs/case-study-template.md): honest portfolio write-up template
- [docs/handoff.md](docs/handoff.md): current status and next steps
- [docs/spec/](docs/spec/): original SDLC PDF, editable spec, starter prompt

## Scope boundaries (v1)

One actual payer per receipt (many receipts may have different payers). No pooled advances or multiple funders on one receipt. PHP only. Manual entry is the source of truth; photos are supporting evidence. Once any payment is reported, the bill is frozen. Done events are read-only. Kulayan and the Lucena commute guide are separate projects.
