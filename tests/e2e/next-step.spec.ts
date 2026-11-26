/**
 * Sprint S9 (D53, D55): what each person sees after Claim says "2 of 2
 * confirmed", through freeze, a partial payment and its confirmation.
 * Breakfast, split equally, PHP 1,397.00 paid by Mark (organizer); Mark and
 * Ana each owe PHP 698.50. Synthetic data, iPhone 15 and 360px.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://localhost:3100";

async function phone(browser: Browser, use: object): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...use });
  await ctx.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
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

test("after “2 of 2 confirmed”: organizer, someone with a task, someone done, then pay and confirm", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as object;
  const mark = await phone(browser, use);
  const ana = await phone(browser, use);
  const created = await call<{ eventId: string; memberId: string; joinCode: string }>(mark, "post", "/api/events", { title: "Beach trip", displayName: "Mark" });
  await call(ana, "post", "/api/events/join", { code: created.joinCode, displayName: "Ana" });
  const { receiptId } = await call<{ receiptId: string }>(mark, "post", `/api/events/${created.eventId}/receipts`, {
    label: "Breakfast",
    payerMemberId: created.memberId,
    payable: "139700",
    equalSplit: true,
    lines: [
      { label: "Silog", quantity: 2, amount: "90000", mode: "SHARED" },
      { label: "Coffee", quantity: 2, amount: "49700", mode: "SHARED" },
    ],
    adjustments: [],
  });
  for (const ctx of [mark, ana]) {
    const view = await (await ctx.request.get(`/api/events/${created.eventId}`)).json();
    await call(ctx, "put", `/api/receipts/${receiptId}/claims`, { receiptVersion: 1, expectedClaimVersion: view.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true });
  }
  await call(mark, "patch", `/api/events/${created.eventId}/me`, { entryComplete: true });

  // ---------------------------------------------------------------- Ana: still has a task
  const anaPage = await ana.newPage();
  await anaPage.setViewportSize({ width: 360, height: 640 });
  await anaPage.goto(`/e/${created.eventId}#claim`);
  const main = anaPage.locator("main");
  await expect(main.getByText("✓ Share confirmed")).toBeVisible();
  await expect(main.getByTestId("my-share")).toContainText("PHP 698.50");
  await expect(main.getByText("PHP 698.50")).toHaveCount(1); // the share appears once
  await expect(main.getByTestId("receipt-progress")).toHaveText("Everyone confirmed (2 of 2)");
  await expect(main.getByText("Can change if someone else joins")).toBeVisible();
  // Receipt details are behind "See items".
  await expect(main.getByText("Silog")).toBeHidden();
  const anaCard = anaPage.getByTestId("next-card");
  await expect(anaCard.getByTestId("next-status")).toHaveText("Did you pay for anything else?");
  await expect(main.locator(".btn-primary")).toHaveCount(1); // exactly one primary action on the screen
  await expect(anaCard.getByRole("button", { name: "I’m done adding receipts" })).toBeInViewport();
  await anaPage.screenshot({ path: `test-results/screens/s9-claim-has-task-${testInfo.project.name}.png`, animations: "disabled" });
  await main.getByText("See items (2)", { exact: true }).click();
  await expect(main.getByText("Silog")).toBeVisible();

  // ---------------------------------------------------------------- Ana: done, waiting on the organizer
  await anaCard.getByRole("button", { name: "I’m done adding receipts" }).click();
  await expect(anaCard.getByTestId("next-status")).toHaveText("You’re done for now");
  await expect(anaCard.getByText("Waiting for Mark to tap Everyone’s here")).toBeVisible();
  await anaCard.getByRole("button", { name: "See what’s left" }).click();
  const left = anaPage.getByRole("dialog", { name: "What’s left" });
  await expect(left.getByText("Tap Everyone’s here")).toBeVisible();
  await left.getByRole("button", { name: "Close" }).click();
  await anaPage.screenshot({ path: `test-results/screens/s9-claim-done-${testInfo.project.name}.png`, animations: "disabled" });

  // ---------------------------------------------------------------- Mark: the organizer
  const markPage = await mark.newPage();
  await markPage.goto(`/e/${created.eventId}#claim`);
  const markCard = markPage.getByTestId("next-card");
  await expect(markCard.getByTestId("next-status")).toHaveText("Is everyone here?");
  await expect(markCard.getByText("Nobody can join after this")).toBeVisible();
  await expect(markCard.getByRole("button", { name: "Invite more people" })).toBeVisible();
  await markPage.screenshot({ path: `test-results/screens/s9-claim-organizer-${testInfo.project.name}.png`, animations: "disabled" });
  markPage.once("dialog", (d) => d.accept());
  await markCard.getByRole("button", { name: "Everyone’s here" }).click();
  // Everyone was done, so the bill froze by itself.
  await expect(markPage.getByText("Step 2 of 3 · Pay")).toBeVisible();
  await expect(markPage.getByText("Bill frozen, time to pay")).toBeVisible();

  // ---------------------------------------------------------------- freeze → Pay
  await expect(markCard.getByTestId("next-status")).toHaveText("How should Ana pay you?");
  await markCard.getByRole("button", { name: "Add cash or QR" }).click();
  const details = markPage.getByRole("dialog", { name: "How you want to be paid" });
  await details.getByRole("button", { name: "Save" }).click();
  await expect(details).toHaveCount(0);
  await tab(markPage, "Home");
  await expect(markCard.getByTestId("next-status")).toHaveText("Waiting for Ana");
  await expect(markCard.getByText("Ana will pay you PHP 698.50")).toBeVisible();

  await anaPage.reload();
  await tab(anaPage, "Home");
  await expect(anaCard.getByTestId("next-status")).toHaveText("Pay Mark PHP 698.50");
  await expect(anaCard.getByText("Cash", { exact: true })).toBeVisible();
  // The one attention dot is on Pay, where the card leads.
  await expect(anaPage.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: /^Pay/ }).getByLabel("needs your attention")).toHaveCount(1);
  await anaCard.getByRole("button", { name: "Pay Mark" }).click();
  await anaPage.getByRole("button", { name: "I sent PHP 698.50" }).click();
  const sheet = anaPage.getByRole("dialog", { name: "How much did you send?" });
  await sheet.getByLabel("Amount sent").fill("400");
  await sheet.getByRole("button", { name: "I sent PHP 400.00" }).click();
  await expect(anaPage.getByText("Sent, Mark will confirm")).toBeVisible();
  await expect(anaPage.getByText("Sent PHP 400.00 · Waiting for Mark")).toBeVisible();
  await expect(anaPage.getByTestId("edge-status").first()).toHaveText("PHP 400.00 sent, waiting · PHP 298.50 left");
  await tab(anaPage, "Home");
  await expect(anaCard.getByTestId("next-status")).toHaveText("Sent PHP 400.00 · Waiting for Mark");
  await expect(anaCard.getByText("PHP 298.50 left")).toBeVisible();

  // ---------------------------------------------------------------- Mark confirms it arrived (within one refresh)
  await expect(markCard.getByTestId("next-status")).toHaveText("Did PHP 400.00 from Ana arrive?", { timeout: 20_000 });
  await expect(markCard.getByText("Not there yet? Leave this and check later")).toBeVisible();
  await markPage.screenshot({ path: `test-results/screens/s9-did-it-arrive-${testInfo.project.name}.png`, animations: "disabled" });
  await markCard.getByRole("button", { name: "Yes, I got it" }).click();
  await expect(markPage.getByText("Got it, PHP 400.00 from Ana")).toBeVisible();
  await expect(markCard.getByTestId("next-status")).toHaveText("Waiting for Ana");

  await anaPage.reload();
  await tab(anaPage, "Home");
  await expect(anaCard.getByTestId("next-status")).toHaveText("Pay Mark PHP 298.50");
  await expect(anaCard.getByText("Mark got PHP 400.00 so far")).toBeVisible();

  // ---------------------------------------------------------------- "It didn't arrive" asks why, in a sheet
  await anaCard.getByRole("button", { name: "Pay Mark" }).click();
  await anaPage.getByRole("button", { name: "I sent PHP 298.50" }).click();
  await anaPage.getByRole("dialog", { name: "How much did you send?" }).getByRole("button", { name: "I sent PHP 298.50" }).click();
  await expect(anaPage.getByText("Sent PHP 298.50 · Waiting for Mark")).toBeVisible();
  await markPage.reload();
  await markCard.getByRole("button", { name: "It didn’t arrive" }).click();
  const why = markPage.getByRole("dialog", { name: "What happened?" });
  await expect(why.getByRole("button", { name: "Tell Ana" })).toBeDisabled();
  await why.getByLabel("What happened?").fill("Nothing came into my GCash");
  await why.getByRole("button", { name: "Tell Ana" }).click();
  await expect(markPage.getByText("Saved, Ana will see it")).toBeVisible();
  await expect(markCard.getByTestId("next-status")).toHaveText("Sort this out with Ana");

  for (const p of [markPage, anaPage]) expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await mark.close();
  await ana.close();
});
