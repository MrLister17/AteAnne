import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

async function peopleGroup(browser: Browser, baseURL: string, options: BrowserContextOptions, withGuest = true) {
  const phones = await Promise.all(["Mark", "Juan", "Paolo"].map(async (name) => {
    const context = await browser.newContext({ ...options, baseURL });
    await context.addInitScript(() => {
      localStorage.setItem("ateanne.tutorial.v1", "asked");
      sessionStorage.setItem("ateanne.install.browser.v1", "1");
    });
    return { name, context, page: await context.newPage(), memberId: "" };
  }));
  const [organizer, admin, participant] = phones;
  const headers = { origin: baseURL };
  const response = await organizer.context.request.post("/api/events", { headers, data: { title: "People dinner", displayName: organizer.name } });
  expect(response.ok()).toBe(true);
  const event = await response.json();
  organizer.memberId = event.memberId;
  for (const person of [admin, participant]) {
    const joined = await person.context.request.post("/api/events/join", { headers, data: { code: event.joinCode, displayName: person.name } });
    expect(joined.ok()).toBe(true);
    person.memberId = (await joined.json()).memberId;
  }
  expect((await organizer.context.request.post(`/api/events/${event.eventId}/members/${admin.memberId}/admin`, { headers, data: { isAdmin: true } })).ok()).toBe(true);
  if (withGuest) {
    const guest = await organizer.context.request.post(`/api/events/${event.eventId}/guests`, { headers, data: { displayName: "Lola" } });
    expect(guest.ok()).toBe(true);
  }
  const open = async (page: Page) => {
    await page.goto(`/e/${event.eventId}`);
    await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "People", exact: true }).click({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  };
  return { organizer, admin, participant, eventId: event.eventId as string, headers, open, close: async () => Promise.all(phones.map((p) => p.context.close())) };
}

async function checkMobileControls(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // DOM geometry can represent a 44px target as43.999996px on mobile DPR.
  const small = await page.locator("button, a").evaluateAll((elements) => elements
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .map((el) => ({ height: el.getBoundingClientRect().height, text: el.textContent?.trim().slice(0, 50), inline: getComputedStyle(el).display === "inline" }))
    .filter((entry) => entry.height < 43.99 && !entry.inline));
  expect(small).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`People keeps actions inside focused sheets in ${colorScheme} mode`, async ({ browser, baseURL }, testInfo) => {
    const group = await peopleGroup(browser, baseURL!, { ...testInfo.project.use, colorScheme });
    const page = group.organizer.page;
    await group.open(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Name of person without a phone")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make admin", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New recovery key", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel event", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /CSV/ })).toHaveCount(0);
    await expect(page.getByText("created the event", { exact: false })).toHaveCount(0);
    await checkMobileControls(page);
    await page.screenshot({ path: `test-results/screens/people-overview-${testInfo.project.name}-${colorScheme}.png`, animations: "disabled", fullPage: true });

    const addRow = page.getByRole("button", { name: "Add someone without a phone", exact: true });
    await addRow.click();
    const add = page.getByRole("dialog", { name: "Add someone without a phone", exact: true });
    await expect(add.getByLabel("Name of person without a phone")).toBeVisible();
    await add.getByRole("button", { name: "Close", exact: true }).click();
    await expect(addRow).toBeFocused();

    const profileRow = page.getByRole("button", { name: "Your profile & access", exact: true });
    await profileRow.click();
    const profile = page.getByRole("dialog", { name: "Your profile & access", exact: true });
    await expect(profile.getByText("Shown as")).toContainText("Mark");
    await expect(profile.getByRole("button", { name: "New recovery key", exact: true })).toBeVisible();
    await checkMobileControls(page);
    await page.screenshot({ path: `test-results/screens/people-profile-${testInfo.project.name}-${colorScheme}.png`, animations: "disabled" });
    await profile.getByRole("button", { name: "Close", exact: true }).click();
    await expect(profile).toHaveCount(0);
    await expect(profileRow).toBeFocused();

    const memberRow = page.getByRole("button", { name: "View Juan", exact: true });
    await memberRow.click();
    const member = page.getByRole("dialog", { name: "Juan", exact: true });
    await expect(member.getByRole("button", { name: "Remove admin", exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "Reissue access for Juan", exact: true })).toBeVisible();
    await checkMobileControls(page);
    await page.screenshot({ path: `test-results/screens/people-member-${testInfo.project.name}-${colorScheme}.png`, animations: "disabled" });
    await member.getByRole("button", { name: "Reissue access for Juan", exact: true }).click();
    const recovery = page.getByRole("dialog", { name: "Reissue access for Juan", exact: true });
    await expect(recovery.getByRole("button", { name: "Make replacement key", exact: true })).toBeDisabled();
    await expect(recovery.getByRole("heading", { name: "Reissue access for Juan", exact: true })).toBeFocused();
    await recovery.getByRole("button", { name: "Back", exact: true }).click();
    await expect(member).toBeVisible();
    await expect(member.getByRole("heading", { name: "Juan", exact: true }).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(member).toHaveCount(0);
    await expect(memberRow).toBeFocused();

    for (const title of ["Download event record", "Event settings", "Help & privacy", "Activity"]) {
      const row = page.getByRole("button", { name: title, exact: true });
      await row.click();
      const sheet = page.getByRole("dialog", { name: title, exact: true });
      await expect(sheet).toBeVisible();
      if (title === "Download event record") await expect(sheet.getByRole("link", { name: /CSV/ })).toBeVisible();
      if (title === "Event settings") await expect(sheet.getByRole("button", { name: "Cancel event", exact: true })).toBeVisible();
      if (title === "Help & privacy") await expect(sheet.getByText(/This browser is you, and your personal recovery key/)).toBeVisible();
      if (title === "Activity") await expect(sheet.getByText(/created the event/)).toBeVisible();
      await checkMobileControls(page);
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(row).toBeFocused();
    }
    await group.close();
  });
}

test("People exposes management controls only to the appropriate roles", async ({ browser, baseURL }, testInfo) => {
  const group = await peopleGroup(browser, baseURL!, testInfo.project.use);
  const participant = group.participant.page;
  await group.open(participant);
  await expect(participant.getByRole("button", { name: "Add someone without a phone", exact: true })).toHaveCount(0);
  await expect(participant.getByRole("button", { name: "Event settings", exact: true })).toHaveCount(0);
  await participant.getByRole("button", { name: "View Juan", exact: true }).click();
  const member = participant.getByRole("dialog", { name: "Juan", exact: true });
  await expect(member.getByRole("button", { name: /admin/i })).toHaveCount(0);
  await expect(member.getByRole("button", { name: /Reissue access/ })).toHaveCount(0);
  await member.getByRole("button", { name: "Close", exact: true }).click();
  await participant.getByRole("button", { name: "View Lola", exact: true }).click();
  const guest = participant.getByRole("dialog", { name: "Lola", exact: true });
  await expect(guest.getByRole("button", { name: "Act for them", exact: true })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /Give them access/ })).toHaveCount(0);
  await guest.getByRole("button", { name: "Close", exact: true }).click();
  expect((await group.participant.context.request.post(`/api/events/${group.eventId}/members/${group.admin.memberId}/recovery-key`, { headers: group.headers, data: { identityConfirmed: true } })).status()).toBe(403);

  const admin = group.admin.page;
  await group.open(admin);
  await expect(admin.getByRole("button", { name: "Add someone without a phone", exact: true })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Event settings", exact: true })).toHaveCount(0);
  await admin.getByRole("button", { name: "View Lola", exact: true }).click();
  const adminGuest = admin.getByRole("dialog", { name: "Lola", exact: true });
  await expect(adminGuest.getByRole("button", { name: "Act for them", exact: true })).toBeVisible();
  await expect(adminGuest.getByRole("button", { name: /Give them access/ })).toBeVisible();
  await adminGuest.getByRole("button", { name: "Close", exact: true }).click();
  await admin.getByRole("button", { name: "View Paolo", exact: true }).click();
  const adminMember = admin.getByRole("dialog", { name: "Paolo", exact: true });
  await expect(adminMember.getByRole("button", { name: /Reissue access/ })).toHaveCount(0);
  await expect(adminMember.getByRole("button", { name: "Make admin", exact: true })).toHaveCount(0);
  await group.close();
});

test("Home opens the add-guest form while the event allows adding people", async ({ browser, baseURL }, testInfo) => {
  const group = await peopleGroup(browser, baseURL!, testInfo.project.use, false);
  const name = "Add someone without a phone";
  const eventPath = `/e/${group.eventId}`;
  try {
    for (const { page } of [group.organizer, group.admin]) {
      await page.goto(eventPath);
      await page.getByRole("button", { name, exact: true }).click();
      const form = page.getByRole("dialog", { name, exact: true });
      await expect(form.getByLabel("Name of person without a phone")).toBeVisible();
      await form.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "Home", exact: true }).click();
    }
    const cancelled = await group.organizer.context.request.post(`/api/events/${group.eventId}/cancel`, {
      headers: group.headers,
      data: { cancelled: true },
    });
    expect(cancelled.ok()).toBe(true);
    for (const { page } of [group.organizer, group.admin]) {
      await page.reload();
      await expect(page.getByTestId("next-status")).toHaveText("This split was cancelled");
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      await page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "People", exact: true }).click();
      await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  } finally {
    await group.close();
  }
});

test("People wraps a long display name in the overview and profile", async ({ browser, baseURL }, testInfo) => {
  const group = await peopleGroup(browser, baseURL!, testInfo.project.use);
  try {
    const displayName = "M".repeat(40);
    const changed = await group.organizer.context.request.patch(`/api/events/${group.eventId}/me`, { headers: group.headers, data: { displayName } });
    expect(changed.ok()).toBe(true);
    const page = group.organizer.page;
    await group.open(page);
    await expect(page.getByRole("button", { name: `View ${displayName}`, exact: true })).toBeVisible();
    await checkMobileControls(page);
    await page.getByRole("button", { name: "Your profile & access", exact: true }).click();
    const profile = page.getByRole("dialog", { name: "Your profile & access", exact: true });
    await expect(profile.getByText("Shown as")).toContainText(displayName);
    await checkMobileControls(page);
  } finally {
    await group.close();
  }
});

test("a late recovery-key response does not reopen a closed People sheet", async ({ browser, baseURL }, testInfo) => {
  const group = await peopleGroup(browser, baseURL!, testInfo.project.use);
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  try {
    const page = group.organizer.page;
    const eventPath = `/api/events/${group.eventId}`;
    await page.route(`**${eventPath}/members/${group.admin.memberId}/recovery-key`, async (route) => {
      const response = await route.fetch();
      requestStarted();
      await responseGate;
      await route.fulfill({ response });
    });
    await group.open(page);
    const memberRow = page.getByRole("button", { name: "View Juan", exact: true });
    await memberRow.click();
    await page.getByRole("button", { name: "Reissue access for Juan", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Reissue access for Juan", exact: true });
    await sheet.getByLabel("I have checked that this is Juan in person").check();
    await sheet.getByRole("button", { name: "Make replacement key", exact: true }).click();
    await started;
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(memberRow).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const reloaded = page.waitForResponse((response) => new URL(response.url()).pathname === eventPath && response.request().method() === "GET" && response.ok());
    releaseResponse();
    await (await reloaded).finished();
    // Let React commit the response continuation before checking the final UI.
    // Frame synchronization avoids a fixed timeout or a race against fetch.json().
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(memberRow).toBeFocused();
  } finally {
    releaseResponse();
    await group.close();
  }
});
