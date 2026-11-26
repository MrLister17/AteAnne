/** Exercise the Safari-first gate without claiming to automate Safari's OS sheet. */
import { expect, test } from "@playwright/test";

const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ateanne.tutorial.v1", "asked");
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  });
});

test("Safari guides install before joining and retains the shared code when continuing", async ({ page }) => {
  let joinWrites = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/events/join") && request.method() === "POST") joinWrites++; });
  await page.goto("/join#code=K7MPQ2XRTA");
  await expect(page.getByLabel("Your shared join code")).toHaveText("K7MPQ2XRTA");
  await expect(page.getByLabel("Your name in this group")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: "Add to Home Screen", exact: true }).click();
  await expect(page.getByText(/a website cannot open its Add to Home Screen confirmation/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy join code" })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/install-guide.png", fullPage: true, animations: "disabled" });
  expect(joinWrites).toBe(0);
  await page.getByRole("button", { name: "Continue in this browser" }).click();
  // The shared code answered the first question, so Join opens at the name, and Back shows the code kept
  await expect(page.getByLabel("Your name in this group")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Join code", { exact: true })).toHaveValue("K7MPQ2XRTA");
  // The explicit choice survives navigation in this tab, without pretending installation succeeded.
  await page.goto("/new");
  await expect(page.getByLabel("What’s the occasion?")).toBeVisible();
});

test("the installed iPhone app skips the gate and the install card", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { configurable: true, value: true }));
  await page.goto("/new");
  await expect(page.getByLabel("What’s the occasion?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue in this browser" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Install Hatian" })).toHaveCount(0);
});

for (const outcome of ["accepted", "dismissed"] as const) test(`native install requests confirmation once: ${outcome}`, async ({ browser }) => {
  const context = await browser.newContext({ userAgent: iphoneUa });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Install Hatian" })).toBeVisible();
  await page.evaluate((outcome) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.promptCalls = String(Number(document.documentElement.dataset.promptCalls || 0) + 1); },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
  }, outcome);
  await page.getByRole("link", { name: "Join with a code" }).click();
  await page.getByRole("button", { name: "Install Hatian", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: outcome === "accepted" ? "Added! Open Hatian from your Home Screen" : "Installation was cancelled" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-prompt-calls", "1");
  await expect(page.getByRole("button", { name: "Continue in this browser" })).toBeVisible();
  await context.close();
});
