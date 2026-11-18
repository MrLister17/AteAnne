import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { EventView } from "@/server/readmodels/EventViewBuilder";

const origin = "http://localhost:3100";
async function post<T = { ok: boolean }>(ctx: BrowserContext, url: string, data: unknown): Promise<T> {
  const response = await ctx.request.post(url, { headers: { origin }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function tab(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: new RegExp(`^${name}(?: needs your attention)?$`) }).click();
}

test("corrects a reported bill and shows a return transfer with original payment history", async ({ browser }, testInfo) => {
  const mark = await browser.newContext({ ...(testInfo.project.use as object) });
  const juan = await browser.newContext({ ...(testInfo.project.use as object) });
  for (const ctx of [mark, juan]) await ctx.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  const created = await post<{ eventId: string; memberId: string; joinCode: string }>(mark, "/api/events", { title: "Correction dinner", displayName: "Mark" });
  const joined = await post<{ memberId: string }>(juan, "/api/events/join", { code: created.joinCode, displayName: "Juan" });
  const eventPath = `/api/events/${created.eventId}`;
  const view = async (ctx = mark): Promise<EventView> => (await ctx.request.get(eventPath)).json();
  const receipt = await post<{ receiptId: string }>(mark, `${eventPath}/receipts`, { label: "Dinner", payerMemberId: created.memberId, payable: "10000", lines: [{ label: "Shared meal", quantity: 1, amount: "10000", mode: "SHARED" }], adjustments: [] });
  void receipt; // Mark saved it as the payer: that already counts as "I paid"
  for (const ctx of [mark, juan]) {
    const response = await ctx.request.patch(`${eventPath}/me`, { headers: { origin }, data: { entryComplete: true } });
    expect(response.ok()).toBe(true);
  }
  await post(mark, `${eventPath}/lock`, {}); // "Everyone's here"
  const claims = async (ctx: BrowserContext, none = false) => {
    const v = await view(ctx);
    const r = v.receipts[0];
    const response = await ctx.request.put(`/api/receipts/${r.id}/claims`, { headers: { origin }, data: { receiptVersion: r.version, expectedClaimVersion: v.me.claimVersion, status: none ? "none" : "finish", claims: none ? [] : r.lines.map((l) => ({ lineId: l.id, units: 1 })) } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await claims(mark);
  await claims(juan); // the last answer freezes the bill by itself
  expect((await view()).event.phase).toBe("SETTLING");
  const initial = (await view()).settlement!;
  const report = await post<{ reportId: string }>(juan, `/api/edges/${initial.edges[0].id}/reports`, { amount: "5000", method: "CASH", idempotencyKey: "e2e-correction-paid" });
  await post(mark, `/api/payments/${report.reportId}/verify`, {});

  const markPage = await mark.newPage();
  await markPage.goto(`/e/${created.eventId}`);
  // Rarely needed: one tap behind a plainly worded row on Home (D48).
  await expect(markPage.getByRole("button", { name: "Correct the bill" })).toBeHidden();
  await markPage.getByText("Something wrong with the bill?", { exact: true }).click();
  await expect(markPage.getByRole("button", { name: "Correct the bill" })).toBeVisible();
  markPage.once("dialog", (dialog) => dialog.accept("Juan did not eat this meal"));
  await markPage.getByRole("button", { name: "Correct the bill" }).click();
  // Back to "Add & claim"; a corrected bill waits for the organizer instead of re-freezing by itself.
  await expect(markPage.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  await expect(markPage.getByText("Fix the bill, then freeze it again")).toBeVisible();
  await claims(juan, true);
  await markPage.reload();
  await expect(markPage.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  await markPage.getByRole("button", { name: "Freeze the corrected bill", exact: true }).click();
  await expect(markPage.getByText("Step 2 of 3 · Pay")).toBeVisible();
  const corrected = (await view()).settlement!;
  expect(corrected.edges).toHaveLength(1);
  expect(corrected.edges[0]).toMatchObject({ from: created.memberId, to: joined.memberId, amount: "5000" });
  await tab(markPage, "Pay");
  await expect(markPage.getByText("Earlier payments are included")).toBeVisible();
  await markPage.getByText("Payment history from prior statements", { exact: true }).click();
  await expect(markPage.getByText("Confirmed received — included in this bill", { exact: false })).toBeVisible();
  await expect(markPage.getByText("You pay", { exact: true })).toBeVisible();
  await expect(markPage.getByRole("button", { name: "I sent money", exact: true })).toBeVisible();
  await mark.close();
  await juan.close();
});
