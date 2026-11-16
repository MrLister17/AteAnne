/** Scan a receipt photo → reviewed draft → saved receipt with the photo attached (fake reader). */
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

test("scan a receipt, check the draft, save it with the photo", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
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

  await expect(page.getByRole("button", { name: /Scan a receipt/ })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/13-scan-button.png", animations: "disabled" });
  await page.getByLabel("Receipt photo to scan").setInputFiles(photoPath);

  const editor = page.getByRole("dialog", { name: "Add a receipt" });
  await expect(editor.getByText("Drafted from your photo — please check it")).toBeVisible();
  await expect(editor.getByLabel("Store or label")).toHaveValue("Sample Kainan (demo scan)");
  await expect(editor.getByLabel("Item 1 name")).toHaveValue("Sisig");
  await expect(editor.getByLabel("Item 2 name")).toHaveValue("Rice");
  await expect(editor.getByLabel("Total paid to the merchant")).toHaveValue("665.50");
  await expect(editor.getByRole("status")).toContainText("matches");
  await expect(editor.getByAltText("The receipt photo you scanned")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/14-scan-draft.png", animations: "disabled" });

  // The person corrects a misread line before saving.
  await editor.getByLabel("Item 2 name").fill("Garlic rice");
  await editor.getByRole("button", { name: "Save receipt" }).click();
  await expect(page.getByRole("button", { name: /Sample Kainan/ })).toContainText("photo");
  await page.getByRole("button", { name: /Sample Kainan/ }).click();
  await expect(page.getByText("Garlic rice")).toBeVisible();
  await page.getByRole("button", { name: "View photo" }).click();
  await expect(page.getByAltText(/Photo of Sample Kainan/)).toBeVisible();
});

test("the Add-receipt form itself offers 'Fill in from a photo'", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
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
  await expect(editor.getByRole("button", { name: /Fill in from a photo/ })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/15-form-photo-button.png", animations: "disabled" });
  await editor.getByLabel("Receipt photo to fill in this form").setInputFiles(photoPath);
  await expect(editor.getByText("Drafted from your photo — please check it")).toBeVisible();
  await expect(editor.getByLabel("Item 1 name")).toHaveValue("Sisig");
  await expect(editor.getByLabel("Total paid to the merchant")).toHaveValue("665.50");
  await expect(editor.getByRole("button", { name: /Scan a different photo/ })).toBeVisible();
});

test("/api/health reports version and scan provider without secrets", async ({ request }) => {
  const body = await (await request.get("/api/health")).json();
  expect(body).toMatchObject({ ok: true, receiptScan: "fake" });
  expect(typeof body.version).toBe("string");
  expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
});
