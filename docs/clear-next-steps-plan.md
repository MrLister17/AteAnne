# AteAnne plan for clearer next steps and lighter storage

Draft for review. Based on v0.7.1 at `720e6f7`. Proposed Sprint S9.

## What happens after the screen you shared?

**“2 of 2 confirmed” means everyone accepted their share of Breakfast.** The amount marked “est.” is still an estimate.

Today, open **Event Home → Your to-do**. Finish any remaining claims or payer confirmations. Tick **I’ve entered every receipt I paid** when you’re done, even if you paid nothing. The organizer taps **Everyone’s here** to close joining. Once the group is ready, AteAnne freezes the first bill and shows **Pay**. A corrected bill requires the organizer to freeze it again.

Use **Receipts → Add a receipt** for the bill from the store. Saving your own receipt confirms that you paid the store. If someone enters it for you, confirm the amount in **Receipts**. Later, reimbursements happen outside AteAnne. The sender taps **I sent money** and the recipient taps **Received** after checking. Confirm each transfer as it arrives. **Done** shows the settled record after the event closes.

## S9.1 Make the next action obvious

Put one short status and one primary action above the receipt details. For the screenshot, show **Share confirmed**, **Your share ₱698.50**, and the next action. Move the items and equal-split explanation under **See items**. Keep the receipt name and payer visible. Use the same next-action rules on Home and Claim. Recompute after a save or refresh so the screen shows the first task that actually applies.

| What’s happening | What the person sees or taps |
| --- | --- |
| You have another receipt to check | **Next receipt** opens the unfinished receipt. |
| Someone added a receipt you paid | **Confirm you paid ₱500** opens that receipt. |
| You’ve entered everything you paid | **Done adding receipts** saves your existing entry status. |
| The group is here and joining is still open | Organizer sees **Everyone’s here**. Others see **Waiting for the organizer**. |
| You’re finished and someone else has a task | **You’re done for now** · **Waiting for Mark**. **See what’s left** shows the group’s tasks. |
| The bill is frozen | **Open Pay** if you have a transfer. **You’re all set** if you have nothing to pay or confirm. |
| You owe someone | **Pay Mark ₱500**. After sending, tap **I sent ₱500**. Keep an amount choice for partial payments. |
| You reported sending money | **Sent · Waiting for Mark**. Show the saved amount and the amount still open when relevant. |
| A payment was reported to you | **Did you get ₱500 from Ana?** · **I got it** / **Not received**. |
| All transfers are confirmed | **Everyone’s paid** · **View summary**. The organizer can **Close it now**. Otherwise the daily job closes it after at least 24 hours without payment activity. |

After a refresh or a change made by someone else, keep the next step visible. A toast can draw attention to it. When the first bill freezes, show the Pay destination. During a correction, show **Check your claims** for the member who needs to act and **Freeze the corrected bill** for the organizer when it’s ready.

Apply the copy rules across Home, Receipts, Claim, Pay and People. Use plain verbs and familiar labels. Keep a status to one line when it fits and supporting copy to one short sentence. Put instructions, math and history behind descriptive rows. Use **Share confirmed**, **Paid the store**, **Sent**, and **Received** for their distinct meanings. When a transfer is pending, show who confirms it next.

## S9.2 Keep the numbers and confirmations

- Save the receipt’s name, payer, items and amounts as structured data. Show **Receipt saved** and **Claim your share** when that’s next.
- Keep **Type receipt** and optional **Scan to fill in**. Use the photo to fill the draft, then save the edited fields. Today saving a scanned receipt also uploads its image. Remove that upload and close the new receipt-photo attachment path in the UI and API. Keep existing attachments available under their current access and retention rules. Measure receipt-photo storage separately from payment QR images.
- Keep the reimbursement record small. Store the transfer, amount, sender report, recipient decision and timestamps through the existing ledger. Ask for confirmation in the app. Skip proof uploads. A QR code can still tell someone where to pay.
- Only the recipient or their authorized guest manager can confirm receipt. Preserve the existing conflict-of-interest checks, exact centavos, partial payments, duplicate protection, disputes, reversals and corrected statements.

Check that a typed or scanned receipt can reach **Pay → Done** without a new receipt image row. Check that a sender report stays pending until the recipient confirms. Check that old receipts with photos still open and expire as expected. [Current receipt editor](../src/ui/event/ReceiptEditor.tsx) · [Settlement](../src/ui/event/SettlementSection.tsx)

## S9.3 Give taps and loading a clear response

Use the shared button component and its existing press, activity and toast cues. Cover tabs, links and custom rows too. Make the main action feedback bold enough to notice on a phone.

| Moment | Proposed feedback |
| --- | --- |
| Tap | Quick press and release, visible highlight, immediate tab or panel selection. Optional vibration on devices that support it. |
| Saving | Change the label to **Saving…**, **Confirming…**, or **Sending…** while the request is in flight. Keep the button in place. Prevent duplicate submissions. |
| Success | Pop in a checkmark and use one short message like **Receipt saved** or **₱500 received** after the server confirms the action. Keep the resulting status on screen. |
| Failure | Pulse the error state and show a short message by the action, such as **Couldn’t save. Try again.** Keep entered values and let the person retry. |
| First load | Show the screen layout with a skeleton and **Loading event…**. Show **Retry** if the request fails. |
| Refresh or scan | Keep the current event visible during refresh. Show a small refresh cue for a manual tap. For a scan, show **Reading receipt…** and **Cancel**. |

These are proposed loading details because the loading request cuts off. Respect Reduce Motion with an immediate color or icon change. Announce status to screen readers and keep touch targets at least 44px. Test slow saves, errors, retries, fast taps and both mobile themes. [Shared controls](../src/ui/components/ui.tsx)

## Priority 1. Protect the database and keep it small

### A. Enable Row Level Security (RLS)

AteAnne’s migration enables RLS and revokes direct Data API access for `anon` and `authenticated`. Server routes check event membership and the authority to take each action. Verify RLS and effective grants on all exposed tables, including new tables. Test anonymous access and two unrelated events.

If a table is intentionally opened to the Data API later, write policies for each operation. People can read their own private records and modify data they own or are authorized to manage. Anonymous visitors see only public information. Someone else’s record cannot be edited or deleted without explicit authority. Preserve authorized group access to shared bills through the app. Keep the Supabase `service_role` and secret keys server-side. [Existing migration](../prisma/migrations/20261115230235_lock_down_data_api/migration.sql) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

### B. Use database indexes

Start with the queries that actually run often. AteAnne already indexes actor lookup, join codes and event activity. Review slow queries and use `EXPLAIN` with realistic staging data before adding an index. Check the receipt list and cleanup filters such as event or asset creation time. Match the filter and sort used by each query. Measure both the query improvement and the extra index size. [Prisma schema](../prisma/schema.prisma) · [Supabase index guide](https://supabase.com/docs/guides/database/query-optimization)

### C. Watch database connections

Verify that Vercel runtime uses the Supabase transaction pooler and that migrations use the separate session connection documented in the repo. Reuse the Prisma client per process and check the pool limit against peak traffic. Measure active connections and timeouts during bursts. Check whether rate-limit queries need a separate connection while a write transaction holds one. [Deployment guide](deploy-vercel.md) · [Supabase connection modes and limits](https://supabase.com/docs/guides/database/connecting-to-postgres)

## Priority 2. Reduce unnecessary database requests

- Measure requests, SQL queries and payload bytes for Home, opening an event, saving a claim and waiting on Pay. Five database requests per homepage visit would mean 50,000 requests for 10,000 visits.
- Start with the event refresh. It fetches the full event every 15 seconds while visible, plus on focus. Combine overlapping refreshes, pause while hidden and slow or stop routine polling on Done. Keep an immediate refresh after a write, a manual refresh, and a prompt refresh when someone returns. Recheck access on each refresh. Verify that Pay appears when another person finishes and that a payment confirmation appears promptly.
- Fetch the fields needed for each screen. Load Activity and older history when opened, with pagination if needed. If the full event fetch still dominates, measure a small authorized status response before replacing it. Ensure it sees payment and access changes as well as edits.
- Serve public static assets through Vercel’s CDN. Cache intentionally public data with a freshness window suited to the data. A public list that changes every five minutes can use a five-minute cache. Keep sessions, join codes, private images, receipts and payments out of shared caches. Debounce future search inputs and keep search results bounded. [Event refresh](../src/ui/event/EventApp.tsx) · [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache)

## Priority 3. Rate limit expensive and abusive requests

Keep the existing application limits for create, join codes, recovery, uploads, scans and the financial writes already covered. Review coverage for all create and modify endpoints, payment decisions, access management, export and repeated reads. Cover login, registration and search if those endpoints are added. Place a coarse limit before anonymous join or recovery creates a session. Use member and event limits for signed-in work, with IP limits for public abuse. Tune for a group sharing Wi-Fi.

Use Vercel Firewall for broad traffic caps where the project supports them, and app limits for actions tied to a person or event. Rate-limit scan and upload before expensive image processing or provider calls. Return **Too many tries. Try again shortly.** with HTTP 429 and a retry delay. Check normal retries, missed responses, legitimate group traffic and burst traffic. Track 429 counts, query volume and connection timeouts. [Existing limits](../src/server/security/RateLimiter.ts) · [Vercel Firewall](https://vercel.com/docs/vercel-firewall)

## Sprint order and release checks

1. Record the current request count, storage by image type and connection peaks.
2. Ship the clearer Claim → Pay handoff with the short copy and tap feedback. Confirm that someone unfamiliar with AteAnne can tell you what to do next without being coached.
3. Remove the automatic photo upload and verify the confirmation-only payment path. Validate RLS, grants, indexes and pooling using the checks above.
4. Compare the smaller request path with the baseline. Add rate-limit coverage where the audit shows gaps. Keep an eye on how soon another person’s changes appear.
5. Run the repo’s lint, type, unit, integration, build and browser checks. Test at iPhone and 360px widths in light and dark mode. Check a real iPhone for tap and loading feedback, and document measured storage and request changes. [Sprint process](implementation-plan.md) · [Test report](test-report.md)
