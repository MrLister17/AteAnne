import { expect, test } from "@playwright/test";

test("organizer hands a replacement key to the same member on a new phone", async ({ browser, baseURL }, testInfo) => {
  const phones = await Promise.all([0, 1, 2].map(async () => {
    const context = await browser.newContext({ ...testInfo.project.use, baseURL });
    await context.addInitScript(() => localStorage.setItem("ateanne.tutorial.v1", "asked"));
    return { context, page: await context.newPage() };
  }));
  const [organizer, oldPhone, newPhone] = phones;
  const headers = { origin: baseURL! };
  const created = await organizer.context.request.post("/api/events", { headers, data: { title: "Recovery dinner", displayName: "Mark" } });
  expect(created.ok()).toBe(true);
  const event = await created.json();
  const joined = await oldPhone.context.request.post("/api/events/join", { headers, data: { code: event.joinCode, displayName: "Juan" } });
  expect(joined.ok()).toBe(true);
  const member = await joined.json();

  await organizer.page.goto(`/e/${event.eventId}`);
  await organizer.page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "People" }).click();
  await organizer.page.getByRole("button", { name: "View Juan", exact: true }).click();
  await organizer.page.getByRole("button", { name: "Reissue access for Juan", exact: true }).click();
  const confirm = organizer.page.getByRole("dialog", { name: "Reissue access for Juan", exact: true });
  await expect(confirm.getByRole("button", { name: "Make replacement key" })).toBeDisabled();
  await confirm.getByLabel("I have checked that this is Juan in person").check();
  await confirm.getByRole("button", { name: "Make replacement key" }).click();
  const reveal = organizer.page.getByRole("dialog", { name: "Replacement key for Juan", exact: true });
  await expect(reveal).toBeVisible();
  const key = (await reveal.getByTestId("replacement-key").textContent())!.trim();
  expect(key).toMatch(/^AA-/);

  await newPhone.page.goto("/recover");
  await newPhone.page.getByLabel("Personal recovery key").fill(key);
  await newPhone.page.getByRole("button", { name: "Get back into my event" }).click();
  await expect(newPhone.page.getByRole("heading", { name: "Access recovered" })).toBeVisible();
  await newPhone.page.getByLabel("I saved my recovery key somewhere safe").check();
  await newPhone.page.getByRole("button", { name: "Open the event" }).click();
  await expect(newPhone.page.getByRole("heading", { name: "Recovery dinner" })).toBeVisible();
  await newPhone.page.getByRole("navigation", { name: "Event sections" }).getByRole("button", { name: "People" }).click();
  await newPhone.page.getByRole("button", { name: "Your profile & access", exact: true }).click();
  await expect(newPhone.page.getByText("Shown as")).toContainText("Juan");
  const view = await newPhone.context.request.get(`/api/events/${event.eventId}`);
  expect((await view.json()).me.memberId).toBe(member.memberId);
  const denied = await oldPhone.context.request.get(`/api/events/${event.eventId}`);
  expect(denied.ok()).toBe(false);
  for (const phone of phones) await phone.context.close();
});
