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
  const move = async (target: string) => post(mark, `${eventPath}/phase`, { target, expectedFinancialVersion: (await view()).event.financialVersion });
  const receipt = await post<{ receiptId: string }>(mark, `${eventPath}/receipts`, { label: "Dinner", payerMemberId: created.memberId, payable: "10000", lines: [{ label: "Shared meal", quantity: 1, amount: "10000", mode: "SHARED" }], adjustments: [] });
  await post(mark, `/api/receipts/${receipt.receiptId}/funding`, { receiptVersion: 1, amount: "10000" });
  for (const ctx of [mark, juan]) {
    const response = await ctx.request.patch(`${eventPath}/me`, { headers: { origin }, data: { entryComplete: true } });
    expect(response.ok()).toBe(true);
  }
  await move("ALLOCATING");
  const claims = async (ctx: BrowserContext, none = false) => {
    const v = await view(ctx);
    const r = v.receipts[0];
    const response = await ctx.request.put(`/api/receipts/${r.id}/claims`, { headers: { origin }, data: { receiptVersion: r.version, expectedClaimVersion: v.me.claimVersion, status: none ? "none" : "finish", claims: none ? [] : r.lines.map((l) => ({ lineId: l.id, units: 1 })) } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await claims(mark);
  await claims(juan);
  await move("REVIEWING");
  for (const ctx of [mark, juan]) await post(ctx, `${eventPath}/review`, { financialVersion: (await view()).event.financialVersion });
  await move("SETTLING");
  const initial = (await view()).settlement!;
  const report = await post<{ reportId: string }>(juan, `/api/edges/${initial.edges[0].id}/reports`, { amount: "5000", method: "CASH", idempotencyKey: "e2e-correction-paid" });
  await post(mark, `/api/payments/${report.reportId}/verify`, {});

  const markPage = await mark.newPage();
  const juanPage = await juan.newPage();
  await markPage.goto(`/e/${created.eventId}`);
  // Rarely needed: one tap behind a plainly worded row on Home (D48).
  await expect(markPage.getByRole("button", { name: "Correct the bill" })).toBeHidden();
  await markPage.getByText("Something wrong with the bill?", { exact: true }).click();
  await expect(markPage.getByRole("button", { name: "Correct the bill" })).toBeVisible();
  markPage.once("dialog", (dialog) => dialog.accept("Juan did not eat this meal"));
  await markPage.getByRole("button", { name: "Correct the bill" }).click();
  await expect(markPage.getByText("Step 3 of 5 · Reviewing")).toBeVisible();
  await expect(markPage.getByRole("button", { name: "Freeze & start settling" })).toBeDisabled();
  await markPage.getByText("Need to fix something? Go back a step", { exact: true }).click();
  await markPage.getByRole("button", { name: "Back to claims", exact: true }).click();
  await expect(markPage.getByText("Step 2 of 5 · Allocating")).toBeVisible();
  await claims(juan, true);
  await markPage.reload();
  await markPage.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(markPage.getByText("Step 3 of 5 · Reviewing")).toBeVisible();
  await tab(markPage, "Money");
  await expect(markPage.getByText("Earlier payments are included")).toBeVisible();
  await markPage.getByText("Payment history from prior statements", { exact: true }).click();
  await expect(markPage.getByText("Confirmed received — included in this bill", { exact: false })).toBeVisible();
  await markPage.getByRole("button", { name: "I agree with this split" }).click();
  await expect(markPage.getByText("You approved this version.")).toBeVisible();
  await juanPage.goto(`/e/${created.eventId}`);
  await tab(juanPage, "Money");
  await juanPage.getByRole("button", { name: "I agree with this split" }).click();
  await expect(juanPage.getByText("You approved this version.")).toBeVisible();
  await tab(markPage, "Home");
  await markPage.reload();
  await markPage.getByRole("button", { name: "Freeze & start settling" }).click();
  await expect(markPage.getByText("Step 4 of 5 · Settling")).toBeVisible();
  const corrected = (await view()).settlement!;
  expect(corrected.edges).toHaveLength(1);
  expect(corrected.edges[0]).toMatchObject({ from: created.memberId, to: joined.memberId, amount: "5000" });
  await tab(markPage, "Money");
  await expect(markPage.getByText("You pay", { exact: true })).toBeVisible();
  await expect(markPage.getByRole("button", { name: "I sent money", exact: true })).toBeVisible();
  await expect(markPage.getByText("Earlier payments are included")).toBeVisible();
  await mark.close();
  await juan.close();
});
