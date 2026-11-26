import { expect, test } from "@playwright/test";

test("one-tap equal receipt confirmation preserves each person’s consent", async ({ browser }, testInfo) => {
  const ctx = await browser.newContext({ ...(testInfo.project.use as object) });
  await ctx.addInitScript(() => {
    localStorage.setItem("ateanne.tutorial.v1", "asked");
    sessionStorage.setItem("ateanne.install.browser.v1", "1");
  });
  const page = await ctx.newPage();
  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Equal merienda");
  await page.getByLabel("Your name in this group").fill("Mark");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  const tab = async (name: string) => page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name }).click();
  await tab("People");
  await page.getByRole("button", { name: "Add someone without a phone", exact: true }).click();
  await page.getByLabel("Name of person without a phone").fill("Lola");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Lola", exact: true })).toContainText("No phone");
  await tab("Receipts");
  await page.getByRole("button", { name: /Add receipt/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add a receipt" });
  await sheet.getByLabel("Store or label").fill("Bakery");
  await sheet.getByLabel("Item 1 name").fill("Ensaymada");
  await sheet.getByLabel("Item 1 line total").fill("100.01");
  await sheet.getByLabel("Split this receipt equally among everyone").check();
  await sheet.getByRole("button", { name: "Save receipt", exact: true }).click();
  await expect(page.getByText("Everyone splits equally", { exact: true })).toBeVisible();
  // Saved by its payer: already counts as paid. Claiming starts straight away, no lock needed.
  await page.getByRole("button", { name: /Bakery/ }).click();
  await expect(page.getByRole("button", { name: /I paid PHP 100.01/ })).toHaveCount(0);
  await page.getByRole("dialog", { name: "Bakery" }).getByRole("button", { name: "Close", exact: true }).click();
  await tab("Claim");
  await expect(page.getByTestId("my-share")).toContainText("PHP 50.01");
  await expect(page.getByTestId("receipt-progress")).toHaveText(/0 of 2 confirmed · waiting for Lola/);
  // The items are information here, one tap away (D53).
  await expect(page.getByText("Ensaymada", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Confirm my equal share", exact: true }).click();
  await expect(page.getByTestId("receipt-progress")).toHaveText(/1 of 2 confirmed/);
  // Once confirmed, the screen says so instead of still offering "Confirm", and says what's next.
  await expect(page.getByText("✓ Share confirmed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm my equal share", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I disagree/ })).toBeHidden();
  await expect(page.getByTestId("next-status")).toHaveText("Did you pay for anything else?");
  await page.getByTestId("next-card").getByRole("button", { name: "I’m done adding receipts" }).click();
  await expect(page.getByTestId("next-status")).toHaveText("Is everyone here?");
  await tab("Home");
  await page.getByRole("button", { name: "Act for Lola", exact: true }).click();
  await tab("Claim");
  await expect(page.getByTestId("my-share")).toContainText("PHP 50.00");
  await page.getByRole("button", { name: "Confirm my equal share", exact: true }).click();
  await expect(page.getByTestId("receipt-progress")).toHaveText("Everyone confirmed (2 of 2)");
  await page.reload();
  await expect(page.getByTestId("receipt-progress")).toHaveText("Everyone confirmed (2 of 2)");
  await page.getByText("See items (1)", { exact: true }).click();
  await expect(page.getByText("Ensaymada", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/equal-receipt-${testInfo.project.name}.png`, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("the organizer confirms an equal split from Home without acting for guests", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
  await page.goto("/");
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/events", {
    headers, data: { title: "Family merienda", displayName: "Mark", intent: "PAID_EXPENSE" },
  });
  expect(created.ok()).toBe(true);
  const { eventId, memberId } = await created.json();
  const eventUrl = `/api/events/${eventId}`;
  const guest = await page.request.post(`${eventUrl}/guests`, { headers, data: { displayName: "Lola" } });
  expect(guest.ok()).toBe(true);
  const { memberId: guestId } = await guest.json();
  expect((await page.request.post(`${eventUrl}/receipts`, {
    headers,
    data: {
      label: "Bakery", payerMemberId: memberId, payable: "10001", equalSplit: true,
      lines: [{ label: "Ensaymada", amount: "10001", quantity: 1, mode: "SHARED" }],
    },
  })).ok()).toBe(true);
  expect((await page.request.post(`${eventUrl}/lock`, { headers })).ok()).toBe(true);

  await page.goto(`/e/${eventId}`);
  const open = page.getByRole("button", { name: "Confirm for everyone", exact: true });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Confirm for everyone?" });
  await expect(sheet.getByRole("list", { name: "Receipts and payers" })).toContainText("Mark paid PHP 100.01 · split equally");
  expect(await sheet.getByRole("button", { name: "Confirm split" }).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  const view = await (await page.request.get(eventUrl)).json();
  expect(view.event.phase).toBe("COLLECTING");
  expect((await page.request.post(`${eventUrl}/confirm-split`, {
    headers: { ...headers, "x-ateanne-act-as": guestId },
    data: { expectedFinancialVersion: view.event.financialVersion },
  })).status()).toBe(400);

  await open.click();
  await sheet.getByRole("button", { name: "Confirm split" }).click();
  await expect(page.getByText("Split confirmed for everyone", { exact: true })).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect(open).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: /^Pay\b/ })).toBeVisible();
  const frozen = await (await page.request.get(eventUrl)).json();
  expect(frozen.event.phase).toBe("SETTLING");
  expect(frozen.settlement.positions.map((p: { cost: string }) => p.cost)).toEqual(["5001", "5000"]);
});
