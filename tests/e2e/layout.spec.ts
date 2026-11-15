/** 360px layout, keyboard focus, labels and reduced motion on entry screens. */
import { expect, test } from "@playwright/test";

for (const path of ["/", "/new", "/join", "/recover", "/offline"]) {
  test(`no horizontal scroll and labelled controls at 360px: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Every input has an accessible name.
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")].filter((el) => {
        const e = el as HTMLInputElement;
        if (e.type === "hidden") return false;
        return !(e.labels?.length || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby"));
      }).length,
    );
    expect(unlabeled).toBe(0);
    // Touch targets: buttons and links at least 44px tall (WCAG 2.2 target size, iOS HIG).
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, a")]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ h: el.getBoundingClientRect().height, t: (el.textContent ?? "").trim().slice(0, 30), inline: getComputedStyle(el).display === "inline" }))
        .filter((x) => x.h < 44 && !x.inline),
    );
    expect(small).toEqual([]);
  });
}

test("keyboard users can reach and see focus on the primary action", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(focused).toBeTruthy();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("honours reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto("/new");
  const dur = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-sheet";
    document.body.appendChild(el);
    return getComputedStyle(el).animationDuration;
  });
  expect(parseFloat(dur)).toBeLessThan(0.05);
  await ctx.close();
});

test("PWA manifest and iOS meta are served", async ({ page, request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  expect((await request.get("/sw.js")).status()).toBe(200);
});
