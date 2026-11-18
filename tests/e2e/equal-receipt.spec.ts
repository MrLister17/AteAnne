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
  await page.getByLabel("Name of person without a phone").fill("Lola");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("No phone", { exact: true })).toBeVisible();
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
  await tab("Home");
  await page.getByLabel("I’ve entered every receipt I paid").check();
  await expect(page.getByLabel("I’ve entered every receipt I paid")).toBeChecked();
  await tab("Claim");
  await expect(page.getByText("Your share: PHP 50.01", { exact: true })).toBeVisible();
  await expect(page.getByText(/0 of 2 people confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm my equal share", exact: true }).click();
  await expect(page.getByText(/1 of 2 people confirmed/)).toBeVisible();
  // Once confirmed, the screen says so instead of still offering "Confirm".
  await expect(page.getByText("You confirmed your share", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm my equal share", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I disagree/ })).toBeHidden();
  await tab("Home");
  await page.getByRole("button", { name: "Act for Lola", exact: true }).click();
  await tab("Claim");
  await expect(page.getByText("Your share: PHP 50.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm my equal share", exact: true }).click();
  await expect(page.getByText(/2 of 2 people confirmed/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/2 of 2 people confirmed/)).toBeVisible();
  await page.screenshot({ path: `test-results/screens/equal-receipt-${testInfo.project.name}.png`, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await ctx.close();
});
