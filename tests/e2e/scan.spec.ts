/** Scan a receipt photo → reviewed draft → saved receipt; the photo itself is never uploaded or kept (D54, fake reader). */
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

test("scan a receipt, check the draft, save only the details (no photo kept)", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  mkdirSync("test-results/screens", { recursive: true });
  const photoPath = path.join("test-results", "synthetic-receipt.jpg");
  writeFileSync(photoPath, await sharp({ create: { width: 900, height: 1400, channels: 3, background: "#fdfdf8" } }).jpeg().toBuffer());

  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Scan test");
  await page.getByLabel("Your name in this group").fill("Mark");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "Receipts" }).click();

  // Two plain choices: camera or photo library. Both are full-size touch targets.
  await expect(page.getByRole("heading", { name: "Scan a receipt" })).toBeVisible();
  for (const name of ["Take photo", "Upload photo"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByLabel("Take a receipt photo to scan")).toHaveAttribute("capture", "environment");
  await page.screenshot({ path: "test-results/screens/13-scan-button.png", animations: "disabled" });
  await page.getByLabel("Choose a receipt photo to scan").setInputFiles(photoPath);

  const editor = page.getByRole("dialog", { name: "Add a receipt" });
  await expect(editor.getByText("Drafted from your photo — please check it")).toBeVisible();
  await expect(editor.getByLabel("Store or label")).toHaveValue("Sample Diner (demo scan)");
  await expect(editor.getByLabel("Item 1 name")).toHaveValue("Pizza");
  await expect(editor.getByLabel("Item 2 name")).toHaveValue("Rice");
  await expect(editor.getByLabel("Total paid to the merchant")).toHaveValue("665.50");
  await expect(editor.getByRole("status")).toContainText("matches");
  await expect(editor.getByAltText("The receipt photo you scanned")).toBeVisible();
  await expect(editor.getByText("We don’t keep this photo. Only what you save is kept.")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/14-scan-draft.png", animations: "disabled" });

  // The person corrects a misread line before saving. Saving sends only the details: no upload request.
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/events\/[^/]+\/assets$/.test(new URL(r.url()).pathname)) uploads.push(r.url());
  });
  await editor.getByLabel("Item 2 name").fill("Garlic rice");
  await editor.getByRole("button", { name: "Save receipt" }).click();
  await expect(page.getByRole("button", { name: /Sample Diner/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sample Diner/ })).not.toContainText("photo");
  await page.getByRole("button", { name: /Sample Diner/ }).click();
  await expect(page.getByText("Garlic rice")).toBeVisible();
  await expect(page.getByRole("button", { name: "View photo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Attach photo|Replace photo/ })).toHaveCount(0);
  expect(uploads).toEqual([]);
});

test("the Add-receipt form itself offers 'Fill in from a photo'", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  const photoPath = path.join("test-results", "synthetic-receipt-2.jpg");
  writeFileSync(photoPath, await sharp({ create: { width: 800, height: 1200, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Form scan test");
  await page.getByLabel("Your name in this group").fill("Juan");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "Receipts" }).click();
  await page.getByRole("button", { name: "Add receipt by typing" }).click();
  const editor = page.getByRole("dialog", { name: "Add a receipt" });
  await expect(editor.getByRole("heading", { name: "Fill in from a photo" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Upload photo" })).toBeVisible();

  // A Save tap on an unfinished form must answer back (message shown above the open sheet), not look dead.
  await editor.getByRole("button", { name: "Save receipt" }).click();
  const toast = page.getByRole("alert").filter({ hasText: "Not saved yet" });
  await expect(toast).toBeVisible();
  // Sheets are modal dialogs; messages must be in the browser's top layer to show above them.
  expect(await toast.evaluate((el) => !!el.closest(":popover-open"))).toBe(true);
  await expect(editor.getByLabel("Store or label")).toBeFocused();
  await page.screenshot({ path: "test-results/screens/16-save-feedback.png", animations: "disabled" });
  await page.screenshot({ path: "test-results/screens/15-form-photo-button.png", animations: "disabled" });
  await editor.getByLabel("Choose a receipt photo to fill in this form").setInputFiles(photoPath);
  await expect(editor.getByText("Drafted from your photo — please check it")).toBeVisible();
  await expect(editor.getByLabel("Item 1 name")).toHaveValue("Pizza");
  await expect(editor.getByLabel("Total paid to the merchant")).toHaveValue("665.50");
  await expect(editor.getByRole("heading", { name: "Scan a different photo" })).toBeVisible();
});

test("a failed scan stays on screen with a way to retry; buttons respond to presses", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ateanne.tutorial.v1", "asked"); sessionStorage.setItem("ateanne.install.browser.v1", "1"); });
  const badPath = path.join("test-results", "not-a-photo.jpg");
  writeFileSync(badPath, "this is not an image");
  await page.goto("/new");
  await page.getByLabel("What’s the occasion?").fill("Scan error test");
  await page.getByLabel("Your name in this group").fill("Ana");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: /Open my event/ }).click();
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "Receipts" }).click();

  await page.getByLabel("Choose a receipt photo to scan").setInputFiles(badPath);
  const panel = page.getByRole("region", { name: "Scan a receipt photo" });
  await expect(panel.getByText("That didn’t work")).toBeVisible();
  await expect(panel.getByText(/Only JPEG, PNG or WebP photos are accepted/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Retake" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Upload photo" })).toBeEnabled();
  await page.screenshot({ path: "test-results/screens/17-scan-error.png", animations: "disabled" });

  // Press feedback is part of the stylesheet for every button.
  const pressed = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes("button:not(:disabled):active") && rule.cssText.includes("scale"))),
  );
  expect(pressed).toBe(true);
});

test("/api/health reports version and scan provider without secrets", async ({ request }) => {
  const body = await (await request.get("/api/health")).json();
  expect(body).toMatchObject({ ok: true, receiptScan: "fake" });
  expect(typeof body.version).toBe("string");
  expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
});
