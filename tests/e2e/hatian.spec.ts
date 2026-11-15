/**
 * Full mobile workflow with isolated browser contexts (organizer + 2 guests):
 * create → join → receipts (payer ≠ creator, units, service) → claims (Leanne
 * skips rice and gets nothing from drinks) → review/approve → freeze → QR +
 * cash instructions → partial report → recipient confirms → Done → persists
 * after reload. All data is synthetic.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

test.describe.configure({ mode: "serial" });

const SHOTS = "test-results/screens";
mkdirSync(SHOTS, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

async function newPhone(browser: Browser, testInfo: { project: { use: Record<string, unknown> } }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...(testInfo.project.use as object) });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function saveRecoveryAndContinue(page: Page, button: RegExp) {
  await expect(page.getByTestId("recovery-key")).toContainText("AA-");
  await page.getByLabel("I saved my recovery key somewhere safe").check();
  await page.getByRole("button", { name: button }).click();
}

async function tab(page: Page, name: "Home" | "Receipts" | "Claim" | "Money" | "People") {
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name }).click();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("complete hatian from create to Done on phones", async ({ browser }, testInfo) => {
  const joy = await newPhone(browser, testInfo);
  const leanne = await newPhone(browser, testInfo);
  const marco = await newPhone(browser, testInfo);

  // ---------------------------------------------------------------- create
  await joy.page.goto("/");
  await shot(joy.page, "01-home");
  await expectNoHorizontalScroll(joy.page);
  await joy.page.getByRole("link", { name: "Start a hatian" }).click();
  await joy.page.getByLabel("What’s the occasion?").fill("Dinner sa Lucena");
  await joy.page.getByLabel("Your name in this group").fill("Joy");
  await joy.page.getByRole("button", { name: "Create event" }).click();
  const code = (await joy.page.getByLabel(/^Join code/).first().textContent())!.replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await shot(joy.page, "02-created");
  await saveRecoveryAndContinue(joy.page, /Open my event/);
  await expect(joy.page.getByRole("heading", { name: "Dinner sa Lucena" })).toBeVisible();
  const eventUrl = joy.page.url();

  // ---------------------------------------------------------------- join (guests)
  for (const [p, name] of [
    [leanne.page, "Leanne"],
    [marco.page, "Marco"],
  ] as const) {
    await p.goto(`/join#code=${code.replace("-", "")}`);
    await expect(p.getByLabel("Join code")).toHaveValue(code.replace("-", ""));
    await p.getByLabel("Your name in this group").fill(name);
    await p.getByRole("button", { name: "Join event" }).click();
    await saveRecoveryAndContinue(p, /Open the event/);
    await expect(p.getByRole("heading", { name: "Dinner sa Lucena" })).toBeVisible();
  }
  // A guest cannot reach organizer controls.
  await expect(leanne.page.getByRole("button", { name: /Lock roster/ })).toHaveCount(0);

  // ---------------------------------------------------------------- receipts
  await tab(joy.page, "Receipts");
  await joy.page.getByRole("button", { name: "Add receipt" }).click();
  const sheet = joy.page.getByRole("dialog", { name: "Add a receipt" });
  await sheet.getByLabel("Store or label").fill("Kusina");
  await sheet.getByLabel("Item 1 name").fill("Shared platter");
  await sheet.getByLabel("Line total (as printed)").first().fill("600");
  await sheet.getByRole("button", { name: "Add item" }).click();
  await sheet.getByLabel("Item 2 name").fill("Rice");
  await sheet.getByLabel("Qty").nth(1).fill("3");
  await sheet.getByLabel("Line total (as printed)").nth(1).fill("180");
  await sheet.getByRole("button", { name: "By piece" }).nth(1).click();
  await sheet.getByRole("button", { name: "Add item" }).click();
  await sheet.getByLabel("Item 3 name").fill("Leanne pasta");
  await sheet.getByLabel("Line total (as printed)").nth(2).fill("250");
  await sheet.getByRole("button", { name: "Service charge" }).click();
  await sheet.getByLabel("Amount").fill("103");
  await sheet.getByLabel("Total paid to the merchant").fill("1133");
  await expect(sheet.getByRole("status")).toContainText("matches");
  await shot(joy.page, "03-receipt-editor");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(joy.page.getByText("Kusina")).toBeVisible();

  // Joy enters Marco's drinks receipt (creator ≠ payer).
  await joy.page.getByRole("button", { name: "Add receipt" }).click();
  const sheet2 = joy.page.getByRole("dialog", { name: "Add a receipt" });
  await sheet2.getByLabel("Store or label").fill("Drinks");
  await sheet2.getByLabel("Who actually paid the merchant?").selectOption({ label: "Marco" });
  await sheet2.getByLabel("Item 1 name").fill("Iced tea pitcher");
  await sheet2.getByLabel("Line total (as printed)").fill("150");
  await sheet2.getByLabel("Total paid to the merchant").fill("150");
  await sheet2.getByRole("button", { name: "Save receipt" }).click();
  await expect(joy.page.getByText("Drinks")).toBeVisible();

  // Each payer confirms their own funding.
  await joy.page.getByRole("button", { name: /Kusina/ }).click();
  await joy.page.getByRole("button", { name: "I paid PHP 1,133.00 for this" }).click();
  await joy.page.getByRole("dialog", { name: "Kusina" }).getByRole("button", { name: "Close" }).click();
  await marco.page.reload();
  await tab(marco.page, "Receipts");
  await marco.page.getByRole("button", { name: /Drinks/ }).click();
  await marco.page.getByRole("button", { name: "I paid PHP 150.00 for this" }).click();
  await marco.page.getByRole("dialog", { name: "Drinks" }).getByRole("button", { name: "Close" }).click();
  await shot(marco.page, "04-receipts");

  // Everyone marks entry complete; organizer locks roster.
  for (const p of [joy.page, leanne.page, marco.page]) {
    await p.reload();
    await tab(p, "Home");
    await p.getByLabel("I’ve entered every receipt I paid").check();
    await expect(p.getByLabel("I’ve entered every receipt I paid")).toBeChecked();
  }
  await joy.page.reload();
  await shot(joy.page, "05-organizer");
  await joy.page.getByRole("button", { name: "Lock roster & start claiming" }).click();
  await expect(joy.page.getByText("Step 2 of 5 · Allocating")).toBeVisible();

  // ---------------------------------------------------------------- claims
  async function claimShared(p: Page, item: string) {
    await p.getByRole("switch", { name: `I had some ${item}` }).click();
  }
  // Joy: platter + 2 rice; drinks.
  await joy.page.reload();
  await tab(joy.page, "Claim");
  await claimShared(joy.page, "Shared platter");
  const joyRice = joy.page.getByRole("group", { name: "Pieces of Rice you had" });
  await joyRice.getByRole("button", { name: "One more" }).click();
  await joyRice.getByRole("button", { name: "One more" }).click();
  await shot(joy.page, "06-claim");
  await joy.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(joy.page.getByRole("switch", { name: "I had some Iced tea pitcher" })).toBeVisible();
  await claimShared(joy.page, "Iced tea pitcher");
  await joy.page.getByRole("button", { name: /Save my items/ }).click();

  // Leanne: platter + pasta, NO rice; nothing from drinks.
  await leanne.page.reload();
  await tab(leanne.page, "Claim");
  await claimShared(leanne.page, "Shared platter");
  await claimShared(leanne.page, "Leanne pasta");
  await leanne.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(leanne.page.getByRole("switch", { name: "I had some Iced tea pitcher" })).toBeVisible();
  await leanne.page.getByRole("button", { name: "I got nothing from this receipt" }).click();
  await expect(leanne.page.getByText("2 of 2 receipts answered")).toBeVisible();

  // Marco: platter + 1 rice; drinks. Tries to over-claim rice first (only 1 left).
  await marco.page.reload();
  await tab(marco.page, "Claim");
  await claimShared(marco.page, "Shared platter");
  const marcoRice = marco.page.getByRole("group", { name: "Pieces of Rice you had" });
  await marcoRice.getByRole("button", { name: "One more" }).click();
  await expect(marcoRice.getByRole("button", { name: "One more" })).toBeDisabled(); // 3 of 3 claimed
  await marco.page.getByRole("button", { name: /Save my items/ }).click();
  await claimShared(marco.page, "Iced tea pitcher");
  await marco.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(marco.page.getByText("2 of 2 receipts answered")).toBeVisible();

  // ---------------------------------------------------------------- review
  await joy.page.reload();
  await tab(joy.page, "Home");
  await joy.page.getByRole("button", { name: "Start review" }).click();
  await expect(joy.page.getByText("Step 3 of 5 · Reviewing")).toBeVisible();

  for (const [p, label, amount] of [
    [joy.page, "Net to receive", "+PHP 706.00"],
    [leanne.page, "Net to pay", "−PHP 495.00"],
    [marco.page, "Net to pay", "−PHP 211.00"],
  ] as const) {
    await p.reload();
    await tab(p, "Money");
    const banner = p.getByRole("status").filter({ hasText: label });
    await expect(banner).toContainText(amount);
    if (p === leanne.page) {
      // Leanne has no rice and no drinks; service only on her PHP 450 of items.
      await expect(p.getByText("You had nothing from this receipt")).toBeVisible();
      await expect(p.getByText("PHP 103.00 × your PHP 450.00 ÷ PHP 1,030.00 spending")).toBeVisible();
      await shot(p, "07-review-leanne");
    }
    await p.getByRole("button", { name: "I agree with this split" }).click();
    await expect(p.getByText("You approved this version.")).toBeVisible();
  }

  await joy.page.reload();
  await tab(joy.page, "Home");
  await joy.page.getByRole("button", { name: "Freeze & start settling" }).click();
  await expect(joy.page.getByText("Step 4 of 5 · Settling")).toBeVisible();

  // ---------------------------------------------------------------- settle
  // Joy shares cash + a QR (synthetic PNG).
  await tab(joy.page, "Money");
  await joy.page.getByRole("button", { name: "Set up" }).click();
  const qrPath = path.join(SHOTS, "synthetic-qr.png");
  writeFileSync(qrPath, await sharp({ create: { width: 200, height: 200, channels: 3, background: "#000" } }).png().toBuffer());
  const instr = joy.page.getByRole("dialog", { name: "How you want to be paid" });
  await instr.getByLabel("Cash note (optional)").fill("Abot mo na lang sa Sabado");
  await instr.getByLabel("Your payment QR (optional)").setInputFiles(qrPath);
  await instr.getByLabel("QR label (optional)").fill("GCash — Joy (synthetic)");
  await instr.getByRole("button", { name: "Save" }).click();
  await expect(joy.page.getByText(/Cash \+ QR · v1/)).toBeVisible();

  // Leanne pays PHP 200 cash first (partial).
  await leanne.page.reload();
  await tab(leanne.page, "Money");
  await expect(leanne.page.getByAltText("Payment QR shared by Joy")).toBeVisible();
  await shot(leanne.page, "08-pay");
  await leanne.page.getByRole("button", { name: "I sent money" }).click();
  const rep = leanne.page.getByRole("dialog", { name: "Report money sent to Joy" });
  await rep.getByLabel("Amount sent").fill("200");
  await rep.getByLabel("Cash").check();
  await rep.getByRole("button", { name: /Report PHP 200.00 sent/ }).click();
  await expect(leanne.page.getByText("Awaiting confirmation")).toBeVisible();
  // Pending does not change the verified balance.
  await expect(leanne.page.getByRole("status").filter({ hasText: "Net to pay" })).toContainText("−PHP 495.00");

  // Joy confirms.
  await joy.page.reload();
  await tab(joy.page, "Money");
  await shot(joy.page, "09-receive");
  await joy.page.getByRole("button", { name: "Received", exact: true }).click();
  await leanne.page.reload();
  await tab(leanne.page, "Money");
  await expect(leanne.page.getByRole("status").filter({ hasText: "Net to pay" })).toContainText("−PHP 295.00");

  // Leanne pays the rest; Marco pays by QR.
  await leanne.page.getByRole("button", { name: "I sent money" }).click();
  await leanne.page.getByRole("dialog", { name: "Report money sent to Joy" }).getByRole("button", { name: /Report PHP 295.00 sent/ }).click();
  await marco.page.reload();
  await tab(marco.page, "Money");
  await marco.page.getByRole("button", { name: "I sent money" }).click();
  const mrep = marco.page.getByRole("dialog", { name: "Report money sent to Joy" });
  await expect(mrep.getByLabel("QR / e-wallet")).toBeChecked();
  await mrep.getByLabel("Note (optional)").fill("ref ending 4821");
  await mrep.getByRole("button", { name: /Report PHP 211.00 sent/ }).click();

  // Done is blocked while reports are pending.
  await joy.page.reload();
  await tab(joy.page, "Home");
  await expect(joy.page.getByRole("button", { name: "Mark as Done" })).toBeDisabled();
  await tab(joy.page, "Money");
  for (let i = 0; i < 2; i++) {
    await joy.page.getByRole("button", { name: "Received", exact: true }).first().click();
    await expect(joy.page.getByRole("button", { name: "Received", exact: true })).toHaveCount(1 - i);
  }
  await tab(joy.page, "Home");
  await joy.page.getByRole("button", { name: "Mark as Done" }).click();
  await expect(joy.page.getByText("Step 5 of 5 · Done")).toBeVisible();

  // ---------------------------------------------------------------- persistence
  await marco.page.goto(eventUrl);
  await tab(marco.page, "Money");
  await expect(marco.page.getByRole("status").filter({ hasText: "Settled" })).toBeVisible();
  await expect(marco.page.getByText("Every transfer was confirmed by its recipient.")).toBeVisible();
  await shot(marco.page, "10-done");
  await expectNoHorizontalScroll(marco.page);

  await Promise.all([joy.ctx.close(), leanne.ctx.close(), marco.ctx.close()]);
});

test("a stranger's browser cannot open the event or private API", async ({ browser, request }, testInfo) => {
  const owner = await newPhone(browser, testInfo);
  await owner.page.goto("/new");
  await owner.page.getByLabel("What’s the occasion?").fill("Private lunch");
  await owner.page.getByLabel("Your name in this group").fill("Ana");
  await owner.page.getByRole("button", { name: "Create event" }).click();
  await saveRecoveryAndContinue(owner.page, /Open my event/);
  await owner.page.waitForURL(/\/e\//);
  const url = owner.page.url();
  const eventId = url.split("/e/")[1].split("#")[0];

  const stranger = await newPhone(browser, testInfo);
  await stranger.page.goto(url);
  await expect(stranger.page.getByText("You can’t open this event here")).toBeVisible();
  const res = await request.get(`/api/events/${eventId}`);
  expect(res.status()).toBe(401);
  // Cross-site writes are rejected even with a valid-looking body.
  const forged = await request.post(`/api/events/${eventId}/phase`, { headers: { origin: "https://evil.example" }, data: { target: "ALLOCATING", expectedFinancialVersion: 1 } });
  expect(forged.status()).toBe(403);
  expect(res.headers()["cache-control"]).toContain("no-store");
  await owner.ctx.close();
  await stranger.ctx.close();
});
