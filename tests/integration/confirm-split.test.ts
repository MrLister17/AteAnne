import { afterAll, beforeAll, expect, it } from "vitest";
import { eventWith, makeApp, resetDb } from "./helpers";

const { app, db } = makeApp();
beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

it("confirms outstanding equal shares, item drafts and receipt funding under the organizer’s name", async () => {
  const { owner, eventId, people: { Mark, Ana } } = await eventWith(app, ["Mark", "Ana"]);
  const guest = await app.events.addGuest(owner, eventId, { displayName: "Lola" });
  const { receiptId } = await app.receipts.create(owner, eventId, {
    label: "Tea", payerMemberId: Mark.memberId, payable: "6000",
    lines: [{ label: "Tea", amount: "6000", quantity: 2, mode: "UNITS" }],
  });
  await app.receipts.create(owner, eventId, {
    label: "Bakery", payerMemberId: guest.memberId, payable: "10001", equalSplit: true,
    lines: [{ label: "Pastries", amount: "10001", quantity: 1, mode: "SHARED" }],
  });

  const before = await app.queries.view(Ana.actorId, eventId);
  const lineId = before.receipts[0].lines[0].id;
  await app.receipts.saveClaims(Ana.actorId, receiptId, {
    receiptVersion: 1, expectedClaimVersion: before.me.claimVersion,
    status: "draft", claims: [{ lineId, units: 2 }],
  });
  const ready = await app.queries.view(owner, eventId);
  const input = { expectedFinancialVersion: ready.event.financialVersion };
  expect(ready.canConfirmSplit).toBe(true);
  expect(before.canConfirmSplit).toBe(false);
  await app.events.setAdmin(owner, eventId, Ana.memberId, { isAdmin: true });
  await expect(app.receipts.confirmSplit(Ana.actorId, eventId, input)).rejects.toMatchObject({ code: "owner_only" });
  await expect(app.receipts.confirmSplit(owner, eventId, {
    expectedFinancialVersion: before.event.financialVersion,
  })).rejects.toMatchObject({ code: "stale_version" });

  expect(await app.receipts.confirmSplit(owner, eventId, input)).toEqual({ phase: "COLLECTING" });
  const confirmed = await app.queries.view(Ana.actorId, eventId);
  expect(confirmed.event.joinsOpen).toBe(true);
  expect(confirmed.members.every((m) => m.entryComplete)).toBe(true);
  expect(confirmed.receipts[0].lines[0].claims).toEqual([
    expect.objectContaining({ memberId: Ana.memberId, units: 2 }),
  ]);
  expect(confirmed.receipts[0].acks.map((a) => a.kind)).toEqual(["NONE", "FINISHED", "NONE"]);
  expect(confirmed.receipts[1].fundingAcknowledged).toBe(true);
  expect(confirmed.receipts[1].acks.every((a) => a.kind === "FINISHED")).toBe(true);
  expect(confirmed.me.claimVersion).toBe(before.me.claimVersion + 2);
  expect(confirmed.audit).toContainEqual(expect.objectContaining({
    actorMemberId: Mark.memberId, type: "split.organizer_confirmed",
  }));
  await expect(app.receipts.confirmSplit(owner, eventId, input)).rejects.toMatchObject({ code: "stale_version" });
  expect(await app.events.lockRoster(owner, eventId)).toEqual({ phase: "SETTLING" });
  const frozen = await app.queries.view(owner, eventId);
  expect(frozen.canConfirmSplit).toBe(false);
  expect(frozen.settlement?.positions.map((p) => [p.funding, p.cost])).toEqual([
    ["6000", "3334"], ["0", "9334"], ["10001", "3333"],
  ]);
});

it("rolls back receipt funding, claims and entry status when an item has no assigned units", async () => {
  const { owner, eventId, people } = await eventWith(app, ["Mark", "Ana"]);
  await app.receipts.create(owner, eventId, {
    label: "Lunch", payerMemberId: people.Ana.memberId, payable: "10000",
    lines: [{ label: "Lunch plates", amount: "10000", quantity: 2, mode: "UNITS" }],
  });
  await app.events.lockRoster(owner, eventId);
  const before = await app.queries.view(owner, eventId);

  await expect(app.receipts.confirmSplit(owner, eventId, {
    expectedFinancialVersion: before.event.financialVersion,
  })).rejects.toMatchObject({
    code: "split_incomplete",
    details: { blockers: ['Lunch: "Lunch plates": 0 of 2 units assigned'] },
  });
  const after = await app.queries.view(owner, eventId);
  expect(after.event.phase).toBe("COLLECTING");
  expect(after.event.financialVersion).toBe(before.event.financialVersion);
  expect(after.members.every((m) => !m.entryComplete)).toBe(true);
  expect(after.receipts[0].fundingAcknowledged).toBe(false);
  expect(after.receipts[0].acks.every((a) => !a.kind)).toBe(true);
});

it("keeps a participant’s equal-split objection", async () => {
  const { owner, eventId, people } = await eventWith(app, ["Mark", "Ana"]);
  const { receiptId } = await app.receipts.create(owner, eventId, {
    label: "Dessert", payerMemberId: people.Mark.memberId, payable: "10000", equalSplit: true,
    lines: [{ label: "Cake", amount: "10000", quantity: 1, mode: "SHARED" }],
  });
  const ana = await app.queries.view(people.Ana.actorId, eventId);
  await app.receipts.saveClaims(people.Ana.actorId, receiptId, {
    receiptVersion: 1, expectedClaimVersion: ana.me.claimVersion, status: "none", claims: [],
  });
  const before = await app.queries.view(owner, eventId);
  await expect(app.receipts.confirmSplit(owner, eventId, {
    expectedFinancialVersion: before.event.financialVersion,
  })).rejects.toMatchObject({ code: "equal_split_disagreed" });
  const after = await app.queries.view(owner, eventId);
  expect(after.receipts[0].acks.map((a) => a.kind)).toEqual([null, "NONE"]);
});
