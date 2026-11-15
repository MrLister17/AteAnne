# Portfolio case study — template

> Fill in only with real evidence. Leave a section as "Not yet measured" rather than inventing numbers. Use synthetic screenshots (`npm run db:seed`).

## The problem
Splitting a restaurant bill ÷ 9 overcharges the person who skipped the rice and ate a cheaper meal. The person who paid the merchant also struggles to track who has *really* paid them back.

## What I built
A mobile-first, installable web app (iPhone-first PWA) where people claim what they actually had, approve one exact split, and settle with payments only the receiver can confirm.

- Demo (synthetic): *Mark paid PHP 5,258; Juan skipped the rice → owes PHP 495.00, not PHP 584.22.*
- Screenshots: home, receipt editor with reconciliation, claim wizard, review breakdown, settle/confirm, Done.

## Engineering highlights
- Exact-centavo largest-remainder allocation with `bigint` and rational weights; discounts by line value; service proportional to post-discount spending; every allocation provably sums.
- Object-oriented layered design: value objects, domain services, aggregate root, abstract application service, storage port, DI container.
- Funding vs consumption vs repayment kept separate; deterministic netting frozen in an immutable snapshot.
- Payment state machine: pending reserves capacity, recipient-only confirmation, idempotent, disputes need both sides, one reasoned reversal.
- Security: hashed opaque sessions, HMAC join codes, server-side authority checks, private re-encoded images, CSP, rate limits.
- Tests: ported reference fixtures, 2,500 generated conservation cases, real-PostgreSQL concurrency tests, Playwright on emulated iPhone + 360px.

## A real defect or feedback-driven change
*Not yet recorded.* (Add one from the pilot: what happened, what you changed, how you verified it.)

## Results
*Not yet measured.* Sample size, completion, accuracy vs manual calc, time to verified settlement.

## Limitations (honest)
One payer per receipt; manual entry and manual verification; trusted-circle identity (no accounts); bill frozen after the first payment report; deactivation of referenced members not yet built.

## Links
Repository · CI · (deployed URL when it exists) · Kulayan and the Lucena commute guide are separate projects.
