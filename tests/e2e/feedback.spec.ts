/**
 * Sprint S9 (D56): every tap answers back. Busy labels, one request per
 * double tap, failures shown beside the button with values kept, the same
 * cues with Reduce Motion, visible first load / refresh / retry states, and
 * polling that stops when nothing can change. Synthetic data.
 */
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";

const origin = "http://localhost:3100";

async function phone(browser: Browser, use: object, extra: object = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...use, ...extra });
  await ctx.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  return ctx;
}

async function call<T>(ctx: BrowserContext, method: "post" | "put" | "patch", url: string, data: unknown): Promise<T> {
  const response = await ctx.request[method](url, { headers: { origin }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** One person, one item receipt they haven't answered yet. */
async function eventWithReceipt(ctx: BrowserContext) {
  const created = await call<{ eventId: string; memberId: string }>(ctx, "post", "/api/events", { title: "Feedback test", displayName: "Mark" });
  await call(ctx, "post", `/api/events/${created.eventId}/receipts`, { label: "Kusina", payerMemberId: created.memberId, payable: "60000", lines: [{ label: "Sisig", quantity: 1, amount: "60000", mode: "SHARED" }], adjustments: [] });
  return created;
}

/** Holds matching requests until release() is called. */
function hold(page: Page, pattern: string | RegExp) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const seen: string[] = [];
  const handler = async (route: Route) => {
    seen.push(route.request().method());
    await gate;
    await route.continue();
  };
  return { install: () => page.route(pattern, handler), release: () => release(), seen };
}

test("saving: busy label, one request for a double tap, error beside the button, retry keeps values", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object);
  const { eventId } = await eventWithReceipt(ctx);
  const page = await ctx.newPage();
  await page.goto(`/e/${eventId}#claim`);
  await page.getByRole("switch", { name: "I had some Sisig" }).click();

  // Slow save: the label says what's happening and a second tap sends nothing.
  const slow = hold(page, "**/api/receipts/*/claims");
  await slow.install();
  const save = page.getByRole("button", { name: /Save my items/ });
  await save.click();
  const busy = page.getByRole("button", { name: "Saving…" });
  await expect(busy).toBeVisible({ timeout: 500 });
  await expect(busy).toBeDisabled();
  await busy.click({ force: true }).catch(() => undefined);
  expect(slow.seen).toEqual(["PUT"]);
  slow.release();
  await expect(page.getByText("✓ Share confirmed")).toBeVisible();
  await page.unroute("**/api/receipts/*/claims");

  // A failed save: the reason sits next to the button and the picks are kept.
  await page.getByText("See items (1)", { exact: true }).click();
  await page.getByRole("switch", { name: "I had some Sisig" }).click(); // untick → a change to save
  await page.route("**/api/receipts/*/claims", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "boom" } }) }));
  await page.getByRole("button", { name: "I got nothing from this receipt" }).click();
  const error = page.getByTestId("action-error");
  await expect(error).toHaveText("Couldn’t save, try again");
  await expect(page.getByRole("switch", { name: "I had some Sisig" })).toHaveAttribute("aria-checked", "false");
  await page.unroute("**/api/receipts/*/claims");
  await page.getByRole("button", { name: "I got nothing from this receipt" }).click();
  await expect(page.getByText("✓ Got nothing")).toBeVisible();
  await expect(error).toHaveCount(0);
  await page.screenshot({ path: `test-results/screens/s9-feedback-${testInfo.project.name}.png`, animations: "disabled" });
  await ctx.close();
});

test("Reduce Motion: the label and colour carry the state; nothing keeps moving", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object, { reducedMotion: "reduce" });
  const { eventId } = await eventWithReceipt(ctx);
  const page = await ctx.newPage();
  await page.goto(`/e/${eventId}#claim`);
  await page.getByRole("switch", { name: "I had some Sisig" }).click();
  const slow = hold(page, "**/api/receipts/*/claims");
  await slow.install();
  await page.getByRole("button", { name: /Save my items/ }).click();
  const busy = page.getByRole("button", { name: "Saving…" });
  await expect(busy).toBeVisible({ timeout: 500 });
  const spinner = busy.locator(".spinner");
  await expect(spinner).toHaveCSS("animation-name", "none");
  expect(await spinner.evaluate((el) => getComputedStyle(el, "::after").content)).toBe('"…"');
  await page.waitForTimeout(300);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  expect(running).toBe(0);
  slow.release();
  await expect(page.getByText("✓ Share confirmed")).toBeVisible();
  await ctx.close();
});

test("first load: skeleton with words, then Try again after a failure or a long wait", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object);
  const { eventId } = await eventWithReceipt(ctx);
  const page = await ctx.newPage();
  const eventApi = `**/api/events/${eventId}`;

  // Slow: the screen's shape and "Loading your event…" right away, "Try again" after 10 s.
  await page.clock.install();
  const slow = hold(page, eventApi);
  await slow.install();
  await page.goto(`/e/${eventId}`);
  await expect(page.getByTestId("event-loading")).toContainText("Loading your event…");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.getByText("Still loading, check your connection")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  slow.release();
  await expect(page.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  await page.unroute(eventApi);

  // Server trouble: not "you're not a member", and Try again works.
  const fresh = await ctx.newPage();
  let fail = true;
  await fresh.route(eventApi, (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue()));
  await fresh.goto(`/e/${eventId}`);
  await expect(fresh.getByRole("heading", { name: "Couldn’t load this event" })).toBeVisible();
  await expect(fresh.getByText("This phone isn’t a member")).toHaveCount(0);
  fail = false;
  await fresh.getByRole("button", { name: "Try again" }).click();
  await expect(fresh.getByText("Step 1 of 3 · Add & claim")).toBeVisible();

  // A failed manual refresh says so (no success tick) and keeps showing what we had.
  fail = true;
  await fresh.getByRole("button", { name: "Refresh" }).click();
  await expect(fresh.getByText("Couldn’t refresh, check your connection")).toBeVisible();
  await expect(fresh.getByTestId("stale-banner")).toContainText("Couldn’t refresh · showing");
  await expect(fresh.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  fail = false;
  await fresh.getByTestId("stale-banner").getByRole("button", { name: "Try again" }).click();
  await expect(fresh.getByTestId("stale-banner")).toHaveCount(0);
  await ctx.close();
});

test("polling: one request when you come back, none at all once the hatian is Done", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object);
  const created = await call<{ eventId: string; memberId: string }>(ctx, "post", "/api/events", { title: "Solo", displayName: "Mark" });
  const eventId = created.eventId;
  const { receiptId } = await call<{ receiptId: string }>(ctx, "post", `/api/events/${eventId}/receipts`, { label: "Snacks", payerMemberId: created.memberId, payable: "10000", lines: [{ label: "Chips", quantity: 1, amount: "10000", mode: "SHARED" }], adjustments: [] });

  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(`/e/${eventId}`);
  await expect(page.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  let gets = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === `/api/events/${eventId}`) gets++;
  });
  // Coming back fires "visibilitychange" and "focus" together: one refresh.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => gets).toBe(1);
  await page.waitForTimeout(300);
  expect(gets).toBe(1);
  // While the hatian is live it still refreshes every 15 s (each refresh finishes before the next is due).
  gets = 0;
  for (let i = 1; i <= 2; i++) {
    const answered = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/events/${eventId}`);
    await page.clock.runFor(15_100);
    await answered;
    expect(gets).toBe(i);
  }

  // Finish it: one person, nothing owed → freeze, then close.
  const view = await (await ctx.request.get(`/api/events/${eventId}`)).json();
  await call(ctx, "put", `/api/receipts/${receiptId}/claims`, { receiptVersion: 1, expectedClaimVersion: view.me.claimVersion, status: "finish", claims: [{ lineId: view.receipts[0].lines[0].id, units: 1 }] });
  await call(ctx, "patch", `/api/events/${eventId}/me`, { entryComplete: true });
  await call(ctx, "post", `/api/events/${eventId}/lock`, {});
  const frozen = await (await ctx.request.get(`/api/events/${eventId}`)).json();
  expect(frozen.event.phase).toBe("SETTLING");
  await call(ctx, "post", `/api/events/${eventId}/phase`, { target: "DONE", expectedFinancialVersion: frozen.event.financialVersion });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Step 3 of 3 · Done")).toBeVisible();
  await expect(page.getByTestId("next-status")).toHaveText("All paid and closed");
  await page.waitForTimeout(300);
  gets = 0;
  await page.clock.runFor(60_000);
  await page.waitForTimeout(300);
  expect(gets).toBe(0);
  await ctx.close();
});
