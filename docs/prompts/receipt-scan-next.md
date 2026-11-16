# Prompt: continue fixing "take a receipt photo" (receipt scanning)

Paste everything below the line into a new Claude Code session that has the `MrLister17/AteAnne` repo attached.

---

You are continuing work on **AteAnne**, my mobile-first (iPhone-first) bill-splitting web app. Repo: GitHub `MrLister17/AteAnne`. **Work and push only on `main`. Never create other branches or PRs.** Vercel auto-deploys `main`.

## Read first
1. `GUIDE.md` (complete map of the app, how it works, how to change things)
2. `CLAUDE.md` (rules: money is bigint centavos, rules live in `src/domain`, writes go through `BaseService`, run all checks, record real results only)
3. `docs/decisions.md` D27–D29 and `docs/test-report.md` ("Live Groq receipt scans")

## The feature
"Scan a receipt": take or choose a photo → a vision model drafts the receipt → it opens in the normal editor with a "please check it" banner → the person corrects and saves. Nothing is saved automatically. Code path:
- UI: `src/ui/event/ReceiptsTab.tsx` (big purple **Scan a receipt** button), `src/ui/event/ReceiptEditor.tsx` (**Fill in from a photo** button at the top of the form), shared hook `src/ui/event/useReceiptScanner.ts`, photo shrinking `src/ui/image.ts`
- API: `src/app/api/events/[eventId]/receipts/scan/route.ts` (`maxDuration = 60`)
- Service: `src/server/services/ReceiptScanService.ts` (member + Collecting-phase checks, rate limits 10/h per person and 40/day per event, sharp re-encode, resize ≤1568px)
- Readers: `src/server/scan/GroqReceiptReader.ts` (default), `src/server/scan/ReceiptReader.ts` (Claude + Fake), shared instructions/schema in `src/server/scan/receiptPrompt.ts`
- Picking the reader: `chooseReceiptReader()` in `src/server/container.ts`: fake (tests only) → `RECEIPT_SCAN_PROVIDER` → Groq if `GROQ_API_KEY` → Claude if `ANTHROPIC_API_KEY` → off (Scan buttons hidden; the view sends `features.receiptScan`)
- Cleanup of model output: `src/domain/receipt/ReceiptDraftNormalizer.ts` (exact peso parsing, drops bad amounts with warnings, converts VAT-exclusive discounts to the VAT-inclusive equivalent, e.g. 592.63 → 663.75)
- Dev tool: `npx tsx scripts/try-scan.ts <photo.jpg> [model]` prints the draft without saving anything

## Known facts from the previous session (verified)
- Groq model **`qwen/qwen3.8-27b`** works with images. `qwen/qwen3.6-27b` is NOT offered.
- Groq `json_schema` mode with images returns garbage values, so the reader uses **`json_object` mode** with a compact shape example.
- Groq free tier: **7,000 input tokens/min** for that model; one scan ≈ 2,000–2,500 tokens → about 2–3 scans/min app-wide. SDK `maxRetries: 0` so a 429 shows "busy" immediately.
- Three synthetic receipts scanned live in 1.5–3.1 s, all reconciled exactly (restaurant with VAT/cash/change lines; senior citizen with VAT exemption + 20%, name/ID not copied; loyalty discount on the VAT-exclusive base). **Real phone photos have NOT been tested.**
- `/api/health` returns `{"ok":true,"version":"<commit>","receiptScan":"groq|claude|fake|off"}` (never secrets).

## The open problem
On my deployed Vercel site I added `GROQ_API_KEY` and redeployed, but I **only see the typing form, with no photo/scan option**, so `features.receiptScan` is false in production. Likely causes: (a) Vercel "Redeploy" was used on an OLD deployment from before the Groq commits; (b) the variable name is misspelled or not enabled for **Production**; (c) something else, such as the config failing to read it.

## What to do
1. Ask me for my Vercel URL and the output of `https://<my-app>/api/health`. Diagnose from `version` (must equal the latest `main` commit) and `receiptScan`. Walk me through the fix in Vercel in plain steps. If the code is at fault, fix it.
2. Once `receiptScan` is `groq` in production, have me scan 3–5 **real** receipts (crumpled, faded, tilted, long). Ask me to send the photos so you can run `scripts/try-scan.ts` on them, compare with what's printed, and improve `receiptPrompt.ts` and/or `ReceiptDraftNormalizer.ts` (with unit tests for each new case). Report accuracy honestly per receipt.
3. Check the phone experience end to end: iPhone camera vs library, HEIC photos (the file input uses `accept="image/jpeg,image/png,image/webp"` so iOS converts), large photos (Vercel 4.5 MB limit; the phone shrinks first), clear error messages (busy / not a receipt / model unavailable), and the spinner text.
4. Optional, ask me first: a no-AI fallback (Tesseract.js on the phone) and/or a "paste receipt text" box for iPhone Live Text, plugged into the same `ReceiptReader`/normalizer path.

## Rules
- Mobile-first: inputs ≥16px, touch targets ≥44px; test at iPhone 15 and 360px.
- Never print, log or commit API keys. If you need my Groq key in the session, use the secure credential form (`request_credential` for `api.groq.com`); code then uses the placeholder key `proxy-injected`.
- Before every push run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e`. Update `docs/test-report.md` with REAL results only, and `docs/decisions.md` / `GUIDE.md` when behaviour changes.
- Explain things to me in plain language. I'm the owner, not a developer.

## Session environment tips (cloud sandbox)
- Start PostgreSQL if tests fail with P1001: `service postgresql start` (dev DB `ateanne_dev`, test DB `ateanne_test`, user/password `ateanne`).
- Node does not use the sandbox proxy by default. For live Groq calls run with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- `huggingface.co` and `console.groq.com` were blocked by the session's network policy; `api.groq.com` works once a Groq credential is saved.
- Groq free-tier limit: wait ~60 s between live test scans.
