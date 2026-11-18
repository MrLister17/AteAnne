/**
 * Full mobile workflow with isolated browser contexts (organizer + 2 guests):
 * create → join → receipts (payer ≠ creator, units, service) → claims (Juan
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
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false, animations: "disabled" });

async function newPhone(browser: Browser, testInfo: { project: { use: Record<string, unknown> } }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...(testInfo.project.use as object) });
  // Returning visitors: skip the first-visit tutorial ask (covered in tutorial.spec.ts).
  await ctx.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
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
  const mark = await newPhone(browser, testInfo);
  const juan = await newPhone(browser, testInfo);
  const paolo = await newPhone(browser, testInfo);

  // ---------------------------------------------------------------- create
  await mark.page.goto("/");
  await shot(mark.page, "01-home");
  await expectNoHorizontalScroll(mark.page);
  await mark.page.getByRole("link", { name: "Start a hatian" }).click();
  await mark.page.getByLabel("What’s the occasion?").fill("Dinner sa Lucena");
  await mark.page.getByLabel("Your name in this group").fill("Mark");
  await mark.page.getByRole("button", { name: "Create event" }).click();
  const code = (await mark.page.getByLabel(/^Join code/).first().textContent())!.replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await shot(mark.page, "02-created");
  await saveRecoveryAndContinue(mark.page, /Open my event/);
  await expect(mark.page.getByRole("heading", { name: "Dinner sa Lucena" })).toBeVisible();
  const eventUrl = mark.page.url();

  // ---------------------------------------------------------------- join (guests)
  for (const [p, name] of [
    [juan.page, "Juan"],
    [paolo.page, "Paolo"],
  ] as const) {
    await p.goto(`/join#code=${code.replace("-", "")}`);
    await expect(p.getByLabel("Join code")).toHaveValue(code.replace("-", ""));
    await p.getByLabel("Your name in this group").fill(name);
    await p.getByRole("button", { name: "Join event" }).click();
    await saveRecoveryAndContinue(p, /Open the event/);
    await expect(p.getByRole("heading", { name: "Dinner sa Lucena" })).toBeVisible();
  }
  // A guest cannot reach organizer controls.
  await expect(juan.page.getByRole("button", { name: /Lock roster/ })).toHaveCount(0);

  // ---------------------------------------------------------------- receipts
  await tab(mark.page, "Receipts");
  await mark.page.getByRole("button", { name: "Add receipt" }).click();
  const sheet = mark.page.getByRole("dialog", { name: "Add a receipt" });
  await sheet.getByLabel("Store or label").fill("Kusina");
  await sheet.getByLabel("Item 1 name").fill("Shared platter");
  await sheet.getByLabel("Item 1 line total").fill("600");
  await sheet.getByRole("button", { name: "Add item" }).click();
  await sheet.getByLabel("Item 2 name").fill("Rice");
  await sheet.getByLabel("Item 2 quantity").fill("3");
  await sheet.getByLabel("Item 2 line total").fill("180");
  await sheet.getByRole("button", { name: "By piece" }).nth(1).click();
  await sheet.getByRole("button", { name: "Add item" }).click();
  await sheet.getByLabel("Item 3 name").fill("Juan pasta");
  await sheet.getByLabel("Item 3 line total").fill("250");
  // Service charge defaults to 10% of the items: 10% of 1,030 = 103, and the total fills itself in.
  await sheet.getByRole("button", { name: "Service charge" }).click();
  await expect(sheet.getByLabel("Percent")).toHaveValue("10");
  await expect(sheet.getByLabel("Total paid to the merchant")).toHaveValue("1133");
  await expect(sheet.getByRole("status")).toContainText("PHP 1,133.00");
  // Typing the printed total switches to checking it against the items.
  await sheet.getByLabel("Total paid to the merchant").fill("1130");
  await expect(sheet.getByRole("status")).toContainText("off by PHP 3.00");
  await sheet.getByLabel("Total paid to the merchant").fill("1133");
  await expect(sheet.getByRole("status")).toContainText("matches");
  await shot(mark.page, "03-receipt-editor");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(mark.page.getByText("Kusina")).toBeVisible();

  // Mark enters Paolo's drinks receipt (creator ≠ payer).
  await mark.page.getByRole("button", { name: "Add receipt" }).click();
  const sheet2 = mark.page.getByRole("dialog", { name: "Add a receipt" });
  await sheet2.getByLabel("Store or label").fill("Drinks");
  await sheet2.getByLabel("Who actually paid the merchant?").selectOption({ label: "Paolo" });
  await sheet2.getByLabel("Item 1 name").fill("Iced tea pitcher");
  // Manual entry: quantity × price each fills the line total and the receipt total.
  await sheet2.getByLabel("Item 1 quantity").fill("2");
  await sheet2.getByLabel("Item 1 price each").fill("75");
  await expect(sheet2.getByLabel("Item 1 line total")).toHaveValue("150");
  await expect(sheet2.getByLabel("Total paid to the merchant")).toHaveValue("150");
  await sheet2.getByRole("button", { name: "Save receipt" }).click();
  await expect(mark.page.getByText("Drinks")).toBeVisible();

  // Each payer confirms their own funding.
  await mark.page.getByRole("button", { name: /Kusina/ }).click();
  await mark.page.getByRole("button", { name: "I paid PHP 1,133.00 for this" }).click();
  await mark.page.getByRole("dialog", { name: "Kusina" }).getByRole("button", { name: "Close" }).click();
  await paolo.page.reload();
  await tab(paolo.page, "Receipts");
  await paolo.page.getByRole("button", { name: /Drinks/ }).click();
  await paolo.page.getByRole("button", { name: "I paid PHP 150.00 for this" }).click();
  await paolo.page.getByRole("dialog", { name: "Drinks" }).getByRole("button", { name: "Close" }).click();
  await shot(paolo.page, "04-receipts");

  // Everyone marks entry complete; organizer locks roster.
  for (const p of [mark.page, juan.page, paolo.page]) {
    await p.reload();
    await tab(p, "Home");
    await p.getByLabel("I’ve entered every receipt I paid").check();
    await expect(p.getByLabel("I’ve entered every receipt I paid")).toBeChecked();
  }
  await mark.page.reload();
  await shot(mark.page, "05-organizer");
  await mark.page.getByRole("button", { name: "Lock roster & start claiming" }).click();
  await expect(mark.page.getByText("Step 2 of 5 · Allocating")).toBeVisible();

  // ---------------------------------------------------------------- claims
  async function claimShared(p: Page, item: string) {
    await p.getByRole("switch", { name: `I had some ${item}` }).click();
  }
  // Mark: platter + 2 rice; drinks.
  await mark.page.reload();
  await tab(mark.page, "Claim");
  await claimShared(mark.page, "Shared platter");
  const joyRice = mark.page.getByRole("group", { name: "Pieces of Rice you had" });
  await joyRice.getByRole("button", { name: "One more" }).click();
  await joyRice.getByRole("button", { name: "One more" }).click();
  await shot(mark.page, "06-claim");
  await mark.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(mark.page.getByRole("switch", { name: "I had some Iced tea pitcher" })).toBeVisible();
  await claimShared(mark.page, "Iced tea pitcher");
  await mark.page.getByRole("button", { name: /Save my items/ }).click();

  // Juan: platter + pasta, NO rice; nothing from drinks.
  await juan.page.reload();
  await tab(juan.page, "Claim");
  await claimShared(juan.page, "Shared platter");
  await claimShared(juan.page, "Juan pasta");
  await juan.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(juan.page.getByRole("switch", { name: "I had some Iced tea pitcher" })).toBeVisible();
  await juan.page.getByRole("button", { name: "I got nothing from this receipt" }).click();
  await expect(juan.page.getByText("2 of 2 receipts answered")).toBeVisible();

  // Paolo: platter + 1 rice; drinks. Tries to over-claim rice first (only 1 left).
  await paolo.page.reload();
  await tab(paolo.page, "Claim");
  await claimShared(paolo.page, "Shared platter");
  const marcoRice = paolo.page.getByRole("group", { name: "Pieces of Rice you had" });
  await marcoRice.getByRole("button", { name: "One more" }).click();
  await expect(marcoRice.getByRole("button", { name: "One more" })).toBeDisabled(); // 3 of 3 claimed
  await paolo.page.getByRole("button", { name: /Save my items/ }).click();
  await claimShared(paolo.page, "Iced tea pitcher");
  await paolo.page.getByRole("button", { name: /Save my items/ }).click();
  await expect(paolo.page.getByText("2 of 2 receipts answered")).toBeVisible();

  // ---------------------------------------------------------------- review
  await mark.page.reload();
  await tab(mark.page, "Home");
  await mark.page.getByRole("button", { name: "Start review" }).click();
  await expect(mark.page.getByText("Step 3 of 5 · Reviewing")).toBeVisible();

  for (const [p, label, amount] of [
    [mark.page, "Net to receive", "+PHP 706.00"],
    [juan.page, "Net to pay", "−PHP 495.00"],
    [paolo.page, "Net to pay", "−PHP 211.00"],
  ] as const) {
    await p.reload();
    await tab(p, "Money");
    const banner = p.getByRole("status").filter({ hasText: label });
    await expect(banner).toContainText(amount);
    if (p === juan.page) {
      // Juan has no rice and no drinks; service only on her PHP 450 of items.
      await expect(p.getByText("You had nothing from this receipt")).toBeVisible();
      await expect(p.getByText("PHP 103.00 × your PHP 450.00 ÷ PHP 1,030.00 spending")).toBeVisible();
      await shot(p, "07-review-juan");
    }
    await p.getByRole("button", { name: "I agree with this split" }).click();
    await expect(p.getByText("You approved this version.")).toBeVisible();
  }

  await mark.page.reload();
  await tab(mark.page, "Home");
  await mark.page.getByRole("button", { name: "Freeze & start settling" }).click();
  await expect(mark.page.getByText("Step 4 of 5 · Settling")).toBeVisible();

  // ---------------------------------------------------------------- settle
  // Mark shares cash + a QR (synthetic PNG).
  await tab(mark.page, "Money");
  await mark.page.getByRole("button", { name: "Set up" }).click();
  const qrPath = path.join(SHOTS, "synthetic-qr.png");
  writeFileSync(qrPath, await sharp({ create: { width: 200, height: 200, channels: 3, background: "#000" } }).png().toBuffer());
  const instr = mark.page.getByRole("dialog", { name: "How you want to be paid" });
  await instr.getByLabel("Cash note (optional)").fill("Abot mo na lang sa Sabado");
  await instr.getByLabel("Your payment QR (optional)").setInputFiles(qrPath);
  await instr.getByLabel("QR label (optional)").fill("GCash — Mark (synthetic)");
  await instr.getByRole("button", { name: "Save" }).click();
  await expect(mark.page.getByText(/Cash \+ QR · v1/)).toBeVisible();

  // Juan pays PHP 200 cash first (partial).
  await juan.page.reload();
  await tab(juan.page, "Money");
  await expect(juan.page.getByAltText("Payment QR shared by Mark")).toBeVisible();
  await shot(juan.page, "08-pay");
  await juan.page.getByRole("button", { name: "I sent money" }).click();
  const rep = juan.page.getByRole("dialog", { name: "Report money sent to Mark" });
  await rep.getByLabel("Amount sent").fill("200");
  await rep.getByLabel("Cash").check();
  await rep.getByRole("button", { name: /Report PHP 200.00 sent/ }).click();
  await expect(juan.page.getByText("Awaiting confirmation")).toBeVisible();
  // Pending does not change the verified balance.
  await expect(juan.page.getByRole("status").filter({ hasText: "Net to pay" })).toContainText("−PHP 495.00");

  // Mark confirms.
  await mark.page.reload();
  await tab(mark.page, "Money");
  await shot(mark.page, "09-receive");
  await mark.page.getByRole("button", { name: "Received", exact: true }).click();
  // Wait until the confirmation is saved before looking from Juan's phone (was a race: CI run 44322635354).
  await expect(mark.page.getByText("Confirmed received").first()).toBeVisible();
  await juan.page.reload();
  await tab(juan.page, "Money");
  await expect(juan.page.getByRole("status").filter({ hasText: "Net to pay" })).toContainText("−PHP 295.00");

  // Juan pays the rest; Paolo pays by QR.
  await juan.page.getByRole("button", { name: "I sent money" }).click();
  await juan.page.getByRole("dialog", { name: "Report money sent to Mark" }).getByRole("button", { name: /Report PHP 295.00 sent/ }).click();
  await paolo.page.reload();
  await tab(paolo.page, "Money");
  await paolo.page.getByRole("button", { name: "I sent money" }).click();
  const mrep = paolo.page.getByRole("dialog", { name: "Report money sent to Mark" });
  await expect(mrep.getByLabel("QR / e-wallet")).toBeChecked();
  await mrep.getByLabel("Note (optional)").fill("ref ending 4821");
  await mrep.getByRole("button", { name: /Report PHP 211.00 sent/ }).click();

  // Done is blocked while reports are pending.
  await mark.page.reload();
  await tab(mark.page, "Home");
  await expect(mark.page.getByRole("button", { name: "Mark as Done" })).toBeDisabled();
  await tab(mark.page, "Money");
  for (let i = 0; i < 2; i++) {
    await mark.page.getByRole("button", { name: "Received", exact: true }).first().click();
    await expect(mark.page.getByRole("button", { name: "Received", exact: true })).toHaveCount(1 - i);
  }
  await tab(mark.page, "Home");
  await mark.page.getByRole("button", { name: "Mark as Done" }).click();
  await expect(mark.page.getByText("Step 5 of 5 · Done")).toBeVisible();

  // ---------------------------------------------------------------- persistence
  await paolo.page.goto(eventUrl);
  await tab(paolo.page, "Money");
  await expect(paolo.page.getByRole("status").filter({ hasText: "Settled" })).toBeVisible();
  await expect(paolo.page.getByText("Every transfer was confirmed by its recipient.")).toBeVisible();
  await shot(paolo.page, "10-done");
  await expectNoHorizontalScroll(paolo.page);

  await Promise.all([mark.ctx.close(), juan.ctx.close(), paolo.ctx.close()]);
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
