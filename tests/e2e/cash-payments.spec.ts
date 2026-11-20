/**
 * D64 running event payments, in two signed-in browsers. A THB trip: Sam
 * hands Maya THB 2,000.00 before any receipt; Maya confirms; once the dinner
 * is in, Sam owes THB 1,734.48, so the rest shows as THB 265.52 credit. After
 * the freeze, Tess hands Maya more cash than her transfer and the plan updates.
 * Synthetic data; iPhone 15 and 360px.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://localhost:3100";

async function phone(browser: Browser, use: object): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...use });
  await ctx.addInitScript(() => {
    localStorage.setItem("ateanne.tutorial.v1", "asked");
    sessionStorage.setItem("ateanne.install.browser.v1", "1");
  });
  return ctx;
}

async function call<T>(ctx: BrowserContext, method: "post" | "put" | "patch", url: string, data: unknown): Promise<T> {
  const response = await ctx.request[method](url, { headers: { origin }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function tab(page: Page, name: "Home" | "Receipts" | "Claim" | "Pay" | "People") {
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name }).click();
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("cash before any receipt becomes credit, and cash during Pay updates the plan", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as object;
  const maya = await phone(browser, use);
  const sam = await phone(browser, use);
  const tess = await phone(browser, use);
  const created = await call<{ eventId: string; memberId: string; joinCode: string }>(maya, "post", "/api/events", { title: "Chiang Mai", displayName: "Maya", intent: "PAID_EXPENSE", currency: "THB" });
  const samJoin = await call<{ memberId: string }>(sam, "post", "/api/events/join", { code: created.joinCode, displayName: "Sam" });
  const tessJoin = await call<{ memberId: string }>(tess, "post", "/api/events/join", { code: created.joinCode, displayName: "Tess" });
  const eventId = created.eventId;

  // ---------------------------------------------------------------- Sam records cash before any receipt
  const samPage = await sam.newPage();
  await samPage.goto(`/e/${eventId}#overview`);
  const card = samPage.getByTestId("cash-payments").locator("xpath=..");
  await expect(card).toContainText("Handed someone money already?");
  await card.getByRole("button", { name: "Record payment" }).click();
  const sheet = samPage.getByRole("dialog", { name: "Record a payment" });
  await sheet.getByLabel("Who did you give it to?").selectOption({ label: "Maya" });
  await sheet.getByLabel("Amount handed over (THB)").fill("2000");
  await expect(sheet.getByTestId("cash-estimate")).toHaveText("Once Maya confirms: Credit THB 2,000.00");
  await noSidewaysScroll(samPage);
  await samPage.screenshot({ path: `test-results/screens/d64-record-${testInfo.project.name}.png`, animations: "disabled" });
  await sheet.getByRole("button", { name: "Record THB 2,000.00 to Maya" }).click();
  await expect(samPage.getByText("Recorded. Maya will confirm.")).toBeVisible();
  await expect(card.getByTestId("cash-item")).toContainText("THB 2,000.00 to Maya · Awaiting confirmation");

  // ---------------------------------------------------------------- Maya confirms from her Next card
  const mayaPage = await maya.newPage();
  await mayaPage.goto(`/e/${eventId}#overview`);
  const next = mayaPage.getByTestId("next-card");
  await expect(next.getByTestId("next-status")).toHaveText("Did THB 2,000.00 from Sam arrive?");
  await next.getByRole("button", { name: "Confirm received" }).click();
  await expect(mayaPage.getByText("Confirmed. THB 2,000.00 from Sam.")).toBeVisible();
  await expect(mayaPage.getByTestId("cash-summary")).toHaveText(/Received THB 2,000.00 from Sam/);

  // ---------------------------------------------------------------- the dinner arrives: Sam owes THB 1,734.48, so THB 265.52 is credit
  const dinner = await call<{ receiptId: string }>(maya, "post", `/api/events/${eventId}/receipts`, {
    label: "Khantoke dinner",
    payerMemberId: created.memberId,
    payable: "735356",
    lines: [
      { label: "Sam set", quantity: 1, amount: "173448", mode: "SHARED" },
      { label: "Tess set", quantity: 1, amount: "461908", mode: "SHARED" },
      { label: "Maya set", quantity: 1, amount: "100000", mode: "SHARED" },
    ],
    adjustments: [],
  });
  for (const [ctx, label] of [[maya, "Maya set"], [sam, "Sam set"], [tess, "Tess set"]] as const) {
    const v = await (await ctx.request.get(`/api/events/${eventId}`)).json();
    const line = v.receipts[0].lines.find((l: { label: string }) => l.label === label).id;
    await call(ctx, "put", `/api/receipts/${dinner.receiptId}/claims`, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [{ lineId: line, units: 1 }] });
    await call(ctx, "patch", `/api/events/${eventId}/me`, { entryComplete: true });
  }
  await samPage.reload();
  const banner = samPage.locator("main [role=status]").first();
  await expect(banner).toContainText("Credit");
  await expect(banner).toContainText("+THB 265.52");
  await expect(samPage.getByTestId("cash-summary")).toHaveText(/Paid THB 2,000.00 to Maya/);
  await noSidewaysScroll(samPage);
  await samPage.screenshot({ path: `test-results/screens/d64-credit-${testInfo.project.name}.png`, animations: "disabled" });

  // ---------------------------------------------------------------- freeze: Tess owes Maya THB 4,353.56 and Sam his THB 265.52
  await call(maya, "post", `/api/events/${eventId}/lock`, {});
  await samPage.reload();
  await tab(samPage, "Pay");
  await expect(samPage.getByText("Tess pays you THB 265.52")).toBeVisible();

  // ---------------------------------------------------------------- during Pay, Tess hands Maya THB 5,000.00, more than her transfer
  await call(tess, "post", `/api/events/${eventId}/cash-payments`, { recipientMemberId: created.memberId, amount: "500000", idempotencyKey: `e2e-cash-${testInfo.project.name}-${Date.now()}` });
  await mayaPage.reload();
  await tab(mayaPage, "Pay");
  await expect(mayaPage.getByText("A cash payment is waiting for a decision.")).toBeVisible();
  await mayaPage.getByTestId("cash-item").getByRole("button", { name: "Confirm received" }).click();
  await expect(mayaPage.getByText("Confirmed. THB 5,000.00 from Tess.")).toBeVisible();
  await expect(mayaPage.getByText("Confirmed cash was included and the remaining transfers were updated.")).toBeVisible();
  // Maya now gives back what Tess and Sam paid ahead.
  await expect(mayaPage.getByText("Pay Sam THB 265.52")).toBeVisible();
  await expect(mayaPage.getByText("Pay Tess THB 380.92")).toBeVisible();
  await noSidewaysScroll(mayaPage);
  await mayaPage.screenshot({ path: `test-results/screens/d64-pay-replanned-${testInfo.project.name}.png`, animations: "disabled" });
  void samJoin;
  void tessJoin;

  await maya.close();
  await sam.close();
  await tess.close();
});
