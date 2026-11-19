import { expect, test } from "@playwright/test";

test("preview and copy a manual reminder without sending it", async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("ateanne.tutorial.v1", "asked");
    sessionStorage.setItem("ateanne.install.browser.v1", "1");
    // Capture clipboard output consistently across mobile browser emulation.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } } });
  });
  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Reminder dinner");
  await page.getByLabel("Your name in this group").fill("Mark");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const key = (await page.getByTestId("recovery-key").textContent())!.trim();
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  await page.getByRole("button", { name: "Copy reminder", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Copy reminder for Messenger" });
  await expect(sheet.getByTestId("reminder-preview")).toContainText("tap “I’m done adding receipts”");
  await sheet.getByLabel("Who is this for?").selectOption({ label: "Mark" });
  await sheet.getByRole("button", { name: "Copy message", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/reminder-preview.png", animations: "disabled" });
  const copied = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  expect(copied).toContain("Reminder dinner");
  expect(copied).toContain(page.url());
  expect(copied).toContain("not a payment confirmation");
  expect(copied).not.toContain(key);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("next-card").getByRole("button", { name: "I’m done adding receipts" }).click();
  await expect(page.getByTestId("next-status")).toHaveText("Is everyone here?");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("next-card").getByRole("button", { name: "Everyone’s here" }).click();
  // Nobody has anything left to do (the bill waits for a receipt), so there is nothing to remind anyone of.
  await expect(page.getByTestId("next-status")).toHaveText("You’re done for now");
  await expect(page.getByTestId("next-card").getByText("Add at least one receipt.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy reminder", exact: true })).toHaveCount(0);
});
