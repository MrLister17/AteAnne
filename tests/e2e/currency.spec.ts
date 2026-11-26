/**
 * Sprint S10 (D58–D62): a Bangkok trip settled in pesos. Ana paid PHP 600 of
 * airport snacks; Mark typed in Breakfast, THB 1,397.00 bought yesterday and
 * split equally, which counts as PHP 2,270.13 at that day's (fake) ECB rate of
 * 1 THB = 1.625 PHP. Ana owes Mark PHP 835.06, looks at it in baht, pays in
 * baht and Mark confirms the baht that arrived. Synthetic data; fake rates
 * (FX_RATES_FAKE=1). iPhone 15 and 360px.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://localhost:3100";
const manilaDay = (offsetDays = 0) => new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

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

test("a baht receipt in a peso trip: converted at its day's rate, seen in baht, paid in baht", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as object;
  const mark = await phone(browser, use);
  const ana = await phone(browser, use);
  const created = await call<{ eventId: string; memberId: string; joinCode: string }>(mark, "post", "/api/events", { title: "Bangkok", displayName: "Mark", intent: "PAID_EXPENSE" });
  const joined = await call<{ memberId: string }>(ana, "post", "/api/events/join", { code: created.joinCode, displayName: "Ana" });
  const snacks = await call<{ receiptId: string }>(ana, "post", `/api/events/${created.eventId}/receipts`, {
    label: "Airport snacks",
    payerMemberId: joined.memberId,
    payable: "60000",
    lines: [{ label: "Snacks", quantity: 1, amount: "60000", mode: "SHARED" }],
    adjustments: [],
  });

  // ---------------------------------------------------------------- Mark types a baht receipt
  const markPage = await mark.newPage();
  await markPage.goto(`/e/${created.eventId}#receipts`);
  await markPage.getByRole("button", { name: /Add receipt/ }).first().click();
  const sheet = markPage.getByRole("dialog", { name: "Add a receipt" });
  await sheet.getByLabel("Store or label").fill("Breakfast");
  await sheet.getByLabel("Receipt currency").selectOption("THB");
  await sheet.getByLabel("Bought on").fill(manilaDay(-1));
  await expect(sheet.getByTestId("receipt-conversion")).toContainText("Counted in PHP at the ECB rate for");
  await sheet.getByLabel("Item 1 name").fill("Set breakfast");
  await sheet.getByLabel("Item 1 line total").fill("1397");
  await sheet.getByLabel("Split this receipt equally among everyone").check();
  await expect(sheet.getByText("THB 1,397.00 total")).toBeVisible();
  await markPage.screenshot({ path: `test-results/screens/s10-editor-${testInfo.project.name}.png`, animations: "disabled" });
  await sheet.getByRole("button", { name: "Save receipt", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const row = markPage.getByRole("button", { name: /Breakfast/ });
  await expect(row).toContainText("THB 1,397.00");
  await expect(row).toContainText("PHP 2,270.13");
  await row.click();
  const detail = markPage.getByRole("dialog", { name: "Breakfast" });
  await expect(detail.getByTestId("converted-note")).toContainText("Counts as PHP 2,270.13 · 1 THB = 1.625 PHP");
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  // Everyone answers through the API; Mark closes the roster and the bill freezes.
  const view = await (await mark.request.get(`/api/events/${created.eventId}`)).json();
  const breakfast = view.receipts.find((r: { label: string }) => r.label === "Breakfast");
  expect(breakfast).toMatchObject({ currency: "THB", purchasedOn: manilaDay(-1), settlePayable: "227013" });
  for (const ctx of [mark, ana]) {
    let v = await (await ctx.request.get(`/api/events/${created.eventId}`)).json();
    const snackLine = v.receipts.find((r: { id: string }) => r.id === snacks.receiptId).lines[0].id;
    await call(ctx, "put", `/api/receipts/${snacks.receiptId}/claims`, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [{ lineId: snackLine, units: 1 }] });
    v = await (await ctx.request.get(`/api/events/${created.eventId}`)).json();
    await call(ctx, "put", `/api/receipts/${breakfast.id}/claims`, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true });
    await call(ctx, "patch", `/api/events/${created.eventId}/me`, { entryComplete: true });
  }
  await call(mark, "post", `/api/events/${created.eventId}/lock`, {});

  // ---------------------------------------------------------------- Ana sees it in pesos, then in baht
  const anaPage = await ana.newPage();
  await anaPage.goto(`/e/${created.eventId}#overview`);
  await expect(anaPage.getByText("Step 2 of 3 · Pay")).toBeVisible();
  const banner = anaPage.locator("main [role=status]").first();
  await expect(banner).toContainText("PHP 835.06");
  const switcher = anaPage.getByTestId("currency-switch");
  await expect(switcher).toBeVisible();
  await switcher.getByRole("radio", { name: /THB/ }).click();
  await expect(banner).toContainText("≈ −THB 513.88");
  await expect(banner).toContainText("PHP 835.06"); // the exact figure stays underneath
  await expect(anaPage.getByTestId("view-rate")).toContainText("1 THB = 1.625 PHP");
  await expect(anaPage.getByLabel("My balance")).toContainText("≈ −THB 513.88");
  await noSidewaysScroll(anaPage);
  await anaPage.screenshot({ path: `test-results/screens/s10-home-baht-${testInfo.project.name}.png`, animations: "disabled" });
  // The choice is remembered on this phone.
  await anaPage.reload();
  await expect(anaPage.locator("main [role=status]").first()).toContainText("≈ −THB 513.88");

  // ---------------------------------------------------------------- Ana pays in baht
  await tab(anaPage, "Pay");
  const payIn = anaPage.getByTestId("pay-in");
  await payIn.getByRole("radio", { name: /Thai baht/ }).click();
  await expect(anaPage.getByTestId("pay-quote")).toContainText("1 THB = 1.625 PHP");
  await expect(anaPage.getByTestId("pay-quote")).toContainText("Send THB 513.88");
  await noSidewaysScroll(anaPage);
  await anaPage.screenshot({ path: `test-results/screens/s10-pay-in-baht-${testInfo.project.name}.png`, animations: "disabled" });
  await anaPage.getByRole("button", { name: "I sent THB 513.88" }).click();
  const report = anaPage.getByRole("dialog", { name: "How much did you send?" });
  await expect(report.getByTestId("counts-as")).toContainText("Counts as PHP 835.06");
  await report.getByRole("button", { name: "I sent THB 513.88" }).click();
  await expect(anaPage.getByText("Sent, Mark will confirm")).toBeVisible();
  await expect(anaPage.getByText("Sent PHP 835.06 · Waiting for Mark")).toBeVisible();

  // ---------------------------------------------------------------- Mark confirms the baht that arrived
  await markPage.reload();
  await tab(markPage, "Pay");
  const pending = markPage.getByTestId("pending-report");
  await expect(pending).toContainText("Did THB 513.88 from Ana arrive?");
  await expect(pending).toContainText("Counts as PHP 835.06 · 1 THB = 1.625 PHP");
  await markPage.screenshot({ path: `test-results/screens/s10-receive-baht-${testInfo.project.name}.png`, animations: "disabled" });
  await pending.getByRole("button", { name: "Yes, I got it" }).click();
  await expect(markPage.getByText("Got it, THB 513.88 from Ana")).toBeVisible();
  await expect(markPage.getByTestId("edge-status").first()).toHaveText("PHP 835.06 received");

  await mark.close();
  await ana.close();
});

test("a peso-only event shows no currency switch and pays in pesos as before", async ({ browser }, testInfo) => {
  const mark = await phone(browser, testInfo.project.use as object);
  const created = await call<{ eventId: string; memberId: string }>(mark, "post", "/api/events", { title: "Sunday dinner", displayName: "Mark" });
  await call(mark, "post", `/api/events/${created.eventId}/receipts`, {
    label: "Lunch",
    payerMemberId: created.memberId,
    payable: "10000",
    lines: [{ label: "Pancit", quantity: 1, amount: "10000", mode: "SHARED" }],
    adjustments: [],
  });
  const page = await mark.newPage();
  await page.goto(`/e/${created.eventId}#receipts`);
  await expect(page.getByRole("button", { name: /Lunch/ })).toContainText("PHP 100.00");
  await expect(page.getByTestId("currency-switch")).toHaveCount(0);
  await tab(page, "Home");
  await expect(page.getByTestId("currency-switch")).toHaveCount(0);
  await mark.close();
});
