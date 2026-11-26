/**
 * The simpler Home screens (D48, D53): one "Next for you" action first, the
 * group card, organizer tools below, rarely needed controls one tap away behind
 * a plainly worded row. Checked at iPhone 15 and 360px widths. Synthetic data.
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

test("event Home: one next action first, invite + “Everyone’s here”, the group, only this step’s tabs", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as object;
  const mark = await phone(browser, use);
  const juan = await phone(browser, use);
  const created = await post<{ eventId: string; memberId: string; joinCode: string }>(mark, "/api/events", { title: "Calm dinner", displayName: "Mark" });
  await post(juan, "/api/events/join", { code: created.joinCode, displayName: "Juan" });
  const { receiptId } = await post<{ receiptId: string }>(mark, `/api/events/${created.eventId}/receipts`, { label: "Kusina", payerMemberId: created.memberId, payable: "60000", lines: [{ label: "Sisig", quantity: 1, amount: "60000", mode: "SHARED" }], adjustments: [] });
  // Mark claims first; Juan hasn't answered yet.
  const markView = await (await mark.request.get(`/api/events/${created.eventId}`)).json();
  const claim = await mark.request.put(`/api/receipts/${receiptId}/claims`, { headers: { origin }, data: { receiptVersion: 1, expectedClaimVersion: markView.me.claimVersion, status: "finish", claims: [{ lineId: markView.receipts[0].lines[0].id, units: 1 }] } });
  expect(claim.ok(), await claim.text()).toBe(true);

  // ---------------------------------------------------------------- organizer
  const page = await mark.newPage();
  await page.goto(`/e/${created.eventId}`);
  await expect(page.getByText("Step 1 of 3 · Add & claim")).toBeVisible();
  const nextHeading = page.getByRole("heading", { name: "Next for you" });
  const invite = page.getByRole("heading", { name: "Invite people" });
  const group = page.getByRole("heading", { name: "The group" });
  await expect(invite).toBeVisible();
  expect(await top(nextHeading)).toBeLessThan(await top(invite));
  expect(await top(invite)).toBeLessThan(await top(group));

  // Only this step's tabs: Receipts and Claim, no Money/Pay yet.
  const nav = page.getByRole("navigation", { name: "Event sections" });
  await expect(nav.getByRole("button")).toHaveText([/^Home/, /^Receipts/, /^Claim/, /^People/]);

  // One next action, visible without scrolling: Mark already claimed, so it's "done adding receipts" (D53).
  const card = page.getByTestId("next-card");
  await expect(card.getByTestId("next-status")).toHaveText("Did you pay for anything else?");
  await expect(card.getByRole("button", { name: "I’m done adding receipts" })).toBeInViewport();
  await expect(card.getByRole("button")).toHaveCount(2); // the action + "Add a receipt"
  // The rest of Mark's list is folded away.
  await page.getByText("Everything left (2)").click();
  await expect(page.getByTestId("everything-left")).toContainText("Tap Everyone’s here");
  // No estimate while someone hasn't answered: Mark would look like he paid for himself only.
  await expect(page.getByRole("status").filter({ hasText: /Net to (pay|receive)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Everyone’s here" })).toHaveCount(1);
  await expect(page.getByText("Waiting on", { exact: true })).toBeVisible();
  await expect(page.getByText("The bill freezes by itself once everyone is done", { exact: false })).toBeVisible();

  // Rarely used join controls: one tap behind "More join options".
  await expect(page.getByTestId("join-code")).toHaveText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await expect(page.getByRole("button", { name: "New code" })).toBeHidden();
  await page.getByText("More join options", { exact: true }).click();
  await expect(page.getByRole("button", { name: "New code" })).toBeVisible();

  // The auto-delete date is fine print at the bottom, not a box at the top.
  await expect(page.getByText(/^Auto-deletes /)).toBeVisible();
  expect(await top(page.getByText(/^Auto-deletes /))).toBeGreaterThan(await top(group));
  await expectPhoneFriendly(page);
  await page.screenshot({ path: "test-results/screens/30-home-organizer.png", fullPage: true, animations: "disabled" });

  // Saying you're done moves Mark's card on to "Is everyone here?" and offers Undo.
  await card.getByRole("button", { name: "I’m done adding receipts" }).click();
  await expect(card.getByTestId("next-status")).toHaveText("Is everyone here?");
  await expect(page.getByRole("button", { name: "Everyone’s here" })).toHaveCount(1); // only in the card now
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  // ---------------------------------------------------------------- member
  const juanPage = await juan.newPage();
  await juanPage.goto(`/e/${created.eventId}`);
  const juanCard = juanPage.getByTestId("next-card");
  await expect(juanCard.getByTestId("next-status")).toHaveText("Next: Kusina");
  await expect(juanCard.getByRole("button", { name: "Claim from Kusina" })).toBeInViewport();
  await expect(juanPage.getByRole("heading", { name: "The group" })).toBeVisible();
  await expect(juanPage.getByText("The bill freezes by itself once everyone is done, then you’ll see exactly who to pay")).toBeVisible();
  await expect(juanPage.getByText("Waiting on", { exact: true })).toBeVisible();
  await expect(juanPage.getByRole("button", { name: /Everyone’s here/ })).toHaveCount(0);
  await expect(juanPage.getByRole("heading", { name: "Invite people" })).toHaveCount(0);
  // The one attention dot is on Claim, where the card leads.
  await expect(juanPage.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: /^Claim/ }).getByLabel("needs your attention")).toHaveCount(1);
  await expectPhoneFriendly(juanPage);
  await juanPage.screenshot({ path: "test-results/screens/31-home-member.png", fullPage: true, animations: "disabled" });
  await juanCard.getByRole("button", { name: "Claim from Kusina" }).click();
  await expect(juanPage.getByRole("switch", { name: "I had some Sisig" })).toBeVisible();

  await mark.close();
  await juan.close();
});

test("start screen: newcomers see how it works, returning people see their events first", async ({ browser }, testInfo) => {
  const ctx = await phone(browser, testInfo.project.use as object);
  const page = await ctx.newPage();

  // First visit: the steps are open; the walkthrough lives with them; the recovery key is on screen once.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start a split" })).toBeVisible();
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
  expect(await top(events)).toBeLessThan(await top(page.getByRole("link", { name: "Start a split" })));
  await expect(page.getByRole("button", { name: /Watch the full walkthrough/ })).toBeHidden();
  await page.getByRole("heading", { name: "How it works" }).click();
  await expect(page.getByRole("button", { name: /Watch the full walkthrough/ })).toBeVisible();
  await expectPhoneFriendly(page);
  await page.screenshot({ path: "test-results/screens/32-start-returning.png", fullPage: true, animations: "disabled" });
  await ctx.close();
});
