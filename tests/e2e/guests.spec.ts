/**
 * People without a phone, typed-in receipts that add themselves up, and a
 * recovery key pasted into the join-code box. One organizer phone does
 * everything for a guest ("Lola"), then shows Lola her amount in big text.
 * All data is synthetic.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function newPhone(browser: Browser, testInfo: { project: { use: Record<string, unknown> } }) {
  const ctx = await browser.newContext({ ...(testInfo.project.use as object) });
  await ctx.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
  return { ctx, page: await ctx.newPage() };
}

async function tab(page: Page, name: "Home" | "Receipts" | "Claim" | "Money" | "People") {
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name }).click();
}

test("organizer acts for a guest without a phone and shows her the amount", async ({ browser }, testInfo) => {
  const mark = await newPhone(browser, testInfo);
  const page = mark.page;

  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Merienda");
  await page.getByLabel("Your name in this group").fill("Mark");
  await page.getByRole("button", { name: "Create event" }).click();
  const key = (await page.getByTestId("recovery-key").textContent())!.trim();
  expect(key).toMatch(/^AA-/);
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  await expect(page.getByRole("heading", { name: "Merienda" })).toBeVisible();

  // ---------------------------------------------------------------- add a guest
  await tab(page, "People");
  await page.getByLabel("Name of person without a phone").fill("Lola");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("No phone", { exact: true })).toBeVisible();

  // ---------------------------------------------------------------- typed receipt adds itself up
  await tab(page, "Receipts");
  await page.getByRole("button", { name: /Add receipt/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add a receipt" });
  await sheet.getByLabel("Store or label").fill("Bakery");
  await sheet.getByLabel("Item 1 name").fill("Ensaymada");
  await sheet.getByLabel("Item 1 quantity").fill("3");
  await sheet.getByLabel("Item 1 price each").fill("40");
  await expect(sheet.getByLabel("Item 1 line total")).toHaveValue("120");
  await expect(sheet.getByLabel("Total paid to the merchant")).toHaveValue("120");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(page.getByText("Bakery")).toBeVisible();
  await page.getByRole("button", { name: /Bakery/ }).click();
  await page.getByRole("button", { name: "I paid PHP 120.00 for this" }).click();
  await page.getByRole("dialog", { name: "Bakery" }).getByRole("button", { name: "Close" }).click();

  await tab(page, "Home");
  await page.getByLabel("I’ve entered every receipt I paid").check();
  await expect(page.getByLabel("I’ve entered every receipt I paid")).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Lock roster & start claiming" }).click();
  await expect(page.getByText("Step 2 of 5 · Allocating")).toBeVisible();

  // ---------------------------------------------------------------- claims: mine, then Lola's
  await tab(page, "Claim");
  await page.getByRole("switch", { name: "I had some Ensaymada" }).click();
  await page.getByRole("button", { name: /Save my items/ }).click();
  await expect(page.getByText("1 of 1 receipts answered")).toBeVisible();

  await tab(page, "Home");
  await expect(page.getByTestId("guests-panel")).toContainText("Lola");
  await page.getByRole("button", { name: "Act for Lola" }).click();
  await expect(page.getByTestId("acting-banner")).toContainText("Acting for Lola");
  await tab(page, "Claim");
  await page.getByRole("switch", { name: "I had some Ensaymada" }).click();
  await page.getByRole("button", { name: /Save my items/ }).click();
  await expect(page.getByText("1 of 1 receipts answered")).toBeVisible();
  await page.getByTestId("acting-banner").getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("acting-banner")).toHaveCount(0);

  // The history says who did it for whom.
  await tab(page, "People");
  await expect(page.getByText("saved claims for Lola").first()).toBeVisible();

  // ---------------------------------------------------------------- the big screen for Lola
  await page.getByRole("button", { name: "Show amount", exact: true }).click();
  const screen = page.getByTestId("person-screen");
  await expect(screen).toBeVisible();
  await expect(screen.getByText("Your share so far")).toBeVisible();
  await expect(screen.getByTestId("person-amount")).toHaveText("PHP 60.00");
  await expect(screen.getByText("Ensaymada")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/screens/20-person-screen.png", animations: "disabled" });
  await screen.getByRole("button", { name: "Close" }).last().click();
  await expect(screen).toHaveCount(0);

  // ---------------------------------------------------------------- recovery key pasted in the join box
  const phone2 = await newPhone(browser, testInfo);
  await phone2.page.goto("/join");
  await phone2.page.getByLabel("Join code").fill(`${key.slice(0, 18)}\n${key.slice(18)}`);
  await expect(phone2.page.getByText("That’s your personal recovery key")).toBeVisible();
  await phone2.page.getByRole("button", { name: "Get back into my event" }).click();
  await expect(phone2.page.getByTestId("recovery-key")).toContainText("AA-");
  await phone2.page.getByLabel("I saved my recovery key somewhere safe").check();
  await phone2.page.getByRole("button", { name: /Open the event/ }).click();
  await expect(phone2.page.getByRole("heading", { name: "Merienda" })).toBeVisible();

  // And the home screen has an obvious way in.
  await phone2.page.goto("/");
  await expect(phone2.page.getByRole("link", { name: "I have a recovery key" })).toBeVisible();
});
