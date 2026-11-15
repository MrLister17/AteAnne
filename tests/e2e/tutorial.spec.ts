/** First-visit ask + full walkthrough, on phone sizes. */
import { expect, test } from "@playwright/test";
import { TUTORIAL_STEPS } from "../../src/ui/tutorial/steps";

test("first visit asks once; walkthrough covers every step; button reopens it", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("dialog", { name: "First time here?" });
  await expect(ask).toBeVisible();
  await page.screenshot({ path: "test-results/screens/11-first-visit-ask.png", animations: "disabled" });
  await ask.getByRole("button", { name: "Show me how" }).click();

  const tour = page.getByRole("dialog", { name: "How to use AteAnne" });
  for (const [n, step] of TUTORIAL_STEPS.entries()) {
    await expect(tour.getByText(`Step ${n + 1} of ${TUTORIAL_STEPS.length}`)).toBeVisible();
    await expect(tour.getByRole("heading", { name: step.title })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (["start", "receipts", "claim", "confirm"].includes(step.id)) await page.screenshot({ path: `test-results/screens/12-tutorial-${step.id}.png`, animations: "disabled" });
    if (n < TUTORIAL_STEPS.length - 1) await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour.getByRole("link", { name: "Start a hatian" })).toBeVisible();
  await tour.getByRole("button", { name: "Got it" }).click();
  await expect(tour).toBeHidden();

  // Not asked again on the next visit.
  await page.reload();
  await expect(page.getByRole("link", { name: "Start a hatian" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "First time here?" })).toHaveCount(0);

  // Tutorial button reopens it from step 1; Back works; Escape closes.
  await page.getByRole("button", { name: /Tutorial: how to use AteAnne/ }).first().click();
  await expect(tour.getByText(`Step 1 of ${TUTORIAL_STEPS.length}`)).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour.getByText(`Step 1 of ${TUTORIAL_STEPS.length}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
});

test("'Maybe later' dismisses the ask for good", async ({ page }) => {
  await page.goto("/join");
  await page.getByRole("button", { name: "Maybe later" }).click();
  await expect(page.getByRole("dialog", { name: "First time here?" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start a hatian" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "First time here?" })).toHaveCount(0);
});
