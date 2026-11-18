/**
 * The simpler Home screens (D48): your to-do first, one "Next step" for the
 * group, organizer tools below, rarely needed controls one tap away behind a
 * plainly worded row. Checked at iPhone 15 and 360px widths. Synthetic data.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

const origin = "http://localhost:3100";

async function phone(browser: Browser, use: object): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...use });
  await ctx.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  return ctx;
}

async function post<T>(ctx: BrowserContext, url: string, data: unknown): Promise<T> {
  const response = await ctx.request.post(url, { headers: { origin }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function top(l: Locator) {
  return (await l.boundingBox())!.y;
}

async function expectPhoneFriendly(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Touch targets: visible buttons, links and disclosure rows at least 44px tall.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, a, summary")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ h: el.getBoundingClientRect().height, t: (el.textContent ?? "").trim().slice(0, 40), inline: getComputedStyle(el).display === "inline" }))
      .filter((x) => x.h < 44 && !x.inline),
  );
  expect(small).toEqual([]);
}

test("event Home: to-do first, one next step, rare controls one tap away", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as object;
  const mark = await phone(browser, use);
  const juan = await phone(browser, use);
  const created = await post<{ eventId: string; memberId: string; joinCode: string }>(mark, "/api/events", { title: "Calm dinner", displayName: "Mark" });
  await post(juan, "/api/events/join", { code: created.joinCode, displayName: "Juan" });
  await post(mark, `/api/events/${created.eventId}/receipts`, { label: "Kusina", payerMemberId: created.memberId, payable: "60000", lines: [{ label: "Sisig", quantity: 1, amount: "60000", mode: "SHARED" }], adjustments: [] });

  // ---------------------------------------------------------------- organizer
  const page = await mark.newPage();
  await page.goto(`/e/${created.eventId}`);
  const todo = page.getByRole("heading", { name: "Your to-do" });
  const next = page.getByRole("heading", { name: "Next step" });
  const invite = page.getByRole("heading", { name: "Invite people" });
  await expect(invite).toBeVisible();
  expect(await top(todo)).toBeLessThan(await top(next));
  expect(await top(next)).toBeLessThan(await top(invite));

  // The tick every member needs is in the to-do card, visible without scrolling.
  await expect(page.getByLabel("I’ve entered every receipt I paid")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Lock roster & start claiming" })).toBeDisabled();
  await expect(page.getByText("Still needed", { exact: true })).toBeVisible();

  // Rarely used join controls: one tap behind "More join options".
  await expect(page.getByTestId("join-code")).toHaveText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await expect(page.getByRole("button", { name: "New code" })).toBeHidden();
  await page.getByText("More join options", { exact: true }).click();
  await expect(page.getByRole("button", { name: "New code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close joining" })).toBeVisible();

  // The auto-delete date is fine print at the bottom, not a box at the top.
  await expect(page.getByText(/^Auto-deletes /)).toBeVisible();
  expect(await top(page.getByText(/^Auto-deletes /))).toBeGreaterThan(await top(invite));
  await expectPhoneFriendly(page);
  await page.screenshot({ path: "test-results/screens/30-home-organizer.png", fullPage: true, animations: "disabled" });

  // ---------------------------------------------------------------- member
  const juanPage = await juan.newPage();
  await juanPage.goto(`/e/${created.eventId}`);
  await expect(juanPage.getByRole("heading", { name: "Next step" })).toBeVisible();
  await expect(juanPage.getByText("Mark, the organizer, moves everyone on when it’s ready.")).toBeVisible();
  await expect(juanPage.getByText("Waiting on", { exact: true })).toBeVisible();
  await expect(juanPage.getByLabel("I’ve entered every receipt I paid")).toBeInViewport();
  await expect(juanPage.getByRole("button", { name: /Lock roster/ })).toHaveCount(0);
  await expect(juanPage.getByRole("heading", { name: "Invite people" })).toHaveCount(0);
  await expectPhoneFriendly(juanPage);
  await juanPage.screenshot({ path: "test-results/screens/31-home-member.png", fullPage: true, animations: "disabled" });

  await mark.close();
  await juan.close();
});

test("start screen: newcomers see how it works, returning people see their events first", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object);
  const page = await ctx.newPage();

  // First visit: the steps are open; the walkthrough lives with them; the recovery key is on screen once.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start a hatian" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your events on this phone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Watch the full walkthrough/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "I have a recovery key" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "I have a recovery key" })).toBeInViewport();
  await expectPhoneFriendly(page);

  // Returning: events come before the big buttons; "How it works" folds away but stays one tap away.
  await post(ctx, "/api/events", { title: "Barkada lunch", displayName: "Ana" });
  await page.reload();
  const events = page.getByRole("heading", { name: "Your events on this phone" });
  await expect(events).toBeVisible();
  await expect(page.getByRole("link", { name: /Barkada lunch/ })).toBeInViewport();
  expect(await top(events)).toBeLessThan(await top(page.getByRole("link", { name: "Start a hatian" })));
  await expect(page.getByRole("button", { name: /Watch the full walkthrough/ })).toBeHidden();
  await page.getByRole("heading", { name: "How it works" }).click();
  await expect(page.getByRole("button", { name: /Watch the full walkthrough/ })).toBeVisible();
  await expectPhoneFriendly(page);
  await page.screenshot({ path: "test-results/screens/32-start-returning.png", fullPage: true, animations: "disabled" });
  await ctx.close();
});
