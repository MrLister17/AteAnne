import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ASSISTED_RECOVERY_TTL_MS } from "@/server/services/RecoveryService";
import { eventWith, makeApp, newActor, resetDb, version } from "./helpers";

const { app, db } = makeApp();
beforeEach(async () => resetDb(db));
afterAll(async () => db.$disconnect());

describe("organizer-assisted access recovery", () => {
  it("requires organizer authority, an active ordinary member and an identity check", async () => {
    const e = await eventWith(app, ["Mark", "Juan", "Paolo"]);
    const { Mark, Juan, Paolo } = e.people;
    await app.events.setAdmin(Mark.actorId, e.eventId, Juan.memberId, { isAdmin: true });
    await expect(app.recovery.reissue(Juan.actorId, e.eventId, Paolo.memberId, { identityConfirmed: true })).rejects.toThrow(/Only the organizer/);
    await expect(app.recovery.reissue(Mark.actorId, e.eventId, Mark.memberId, { identityConfirmed: true })).rejects.toThrow(/own access/);
    await expect(app.recovery.reissue(Mark.actorId, e.eventId, Paolo.memberId, { identityConfirmed: false } as never)).rejects.toThrow();
    const guest = await app.events.addGuest(Mark.actorId, e.eventId, { displayName: "Lola" });
    await expect(app.recovery.reissue(Mark.actorId, e.eventId, guest.memberId, { identityConfirmed: true })).rejects.toThrow(/Give them access/);
    await db.member.update({ where: { id: Paolo.memberId }, data: { active: false } });
    await expect(app.recovery.reissue(Mark.actorId, e.eventId, Paolo.memberId, { identityConfirmed: true })).rejects.toThrow(/no longer/);
    const other = await eventWith(app, ["Other"]);
    await expect(app.recovery.reissue(Mark.actorId, e.eventId, other.people.Other.memberId, { identityConfirmed: true })).rejects.toThrow();
  });

  it("hands over once, preserves frozen money and admin status, and revokes the old browser", async () => {
    const e = await eventWith(app, ["Mark", "Juan"]);
    const { Mark, Juan } = e.people;
    await app.events.setAdmin(Mark.actorId, e.eventId, Juan.memberId, { isAdmin: true });
    const originalKey = await app.recovery.rotate(Juan.actorId, e.eventId);
    const { receiptId } = await app.receipts.create(Mark.actorId, e.eventId, {
      label: "Dinner", payerMemberId: Juan.memberId, payable: "10000",
      lines: [{ label: "Shared food", quantity: 1, amount: "10000", mode: "SHARED" }], adjustments: [],
    });
    await app.receipts.acknowledgeFunding(Juan.actorId, receiptId, { receiptVersion: 1, amount: "10000" });
    for (const person of [Mark, Juan]) await app.events.updateMe(person.actorId, e.eventId, { entryComplete: true });
    await app.events.transition(Mark.actorId, e.eventId, { target: "ALLOCATING", expectedFinancialVersion: await version(app, e.eventId, Mark.actorId) });
    const line = (await app.queries.view(Mark.actorId, e.eventId)).receipts[0].lines[0];
    for (const person of [Mark, Juan]) await app.receipts.saveClaims(person.actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: 1, status: "finish", claims: [{ lineId: line.id, units: 1 }] });
    const fv = await version(app, e.eventId, Mark.actorId);
    await app.events.transition(Mark.actorId, e.eventId, { target: "REVIEWING", expectedFinancialVersion: fv });
    for (const person of [Mark, Juan]) await app.receipts.approveReview(person.actorId, e.eventId, fv);
    await app.events.transition(Mark.actorId, e.eventId, { target: "SETTLING", expectedFinancialVersion: fv });
    const frozen = (await app.queries.view(Juan.actorId, e.eventId)).settlement!;
    const report = await app.payments.report(Mark.actorId, frozen.edges[0].id, { amount: "2000", method: "CASH", idempotencyKey: "before-recovery-1234" });
    await app.payments.verify(Juan.actorId, report.reportId);
    const before = await app.queries.view(Juan.actorId, e.eventId);
    const beforeDb = await db.member.findUniqueOrThrow({ where: { id: Juan.memberId } });
    const start = Date.now();
    const issued = await app.recovery.reissue(Mark.actorId, e.eventId, Juan.memberId, { identityConfirmed: true });
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(start + ASSISTED_RECOVERY_TTL_MS);
    // Issuing a key cannot itself take over the person; their old phone still works.
    expect((await app.queries.view(Juan.actorId, e.eventId)).me.memberId).toBe(Juan.memberId);
    await expect(app.recovery.redeem(await newActor(app), { key: originalKey.recoveryKey }, "ip")).rejects.toThrow(/not valid/);
    // The organizer cannot merge their own browser into Juan's identity.
    await expect(app.recovery.redeem(Mark.actorId, { key: issued.recoveryKey }, "ip")).rejects.toThrow(/never merged/);
    const phone = await newActor(app);
    const redeemed = await app.recovery.redeem(phone, { key: issued.recoveryKey }, "ip");
    expect(redeemed.memberId).toBe(Juan.memberId);
    expect(redeemed.recoveryKey).not.toBe(issued.recoveryKey);
    await expect(app.queries.view(Juan.actorId, e.eventId)).rejects.toThrow();
    await expect(app.recovery.redeem(await newActor(app), { key: issued.recoveryKey }, "ip")).rejects.toThrow(/not valid/);
    const after = await app.queries.view(phone, e.eventId);
    expect(after.me.memberId).toBe(Juan.memberId);
    expect(after.me.isAdmin).toBe(true);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.settlement).toEqual(before.settlement);
    expect(after.event.financialVersion).toBe(before.event.financialVersion);
    const afterDb = await db.member.findUniqueOrThrow({ where: { id: Juan.memberId } });
    expect(afterDb.claimVersion).toBe(beforeDb.claimVersion);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { eventId: e.eventId, type: "member.access_reissued" } });
    expect(audit.actorMemberId).toBe(Mark.memberId);
    expect(JSON.stringify(audit.detail)).not.toContain(issued.recoveryKey);
  });

  it("expires unredeemed keys and invalidates earlier replacement keys", async () => {
    const e = await eventWith(app, ["Mark", "Juan"]);
    const issue = () => app.recovery.reissue(e.owner, e.eventId, e.people.Juan.memberId, { identityConfirmed: true });
    const earlier = await issue();
    const current = await issue();
    await expect(app.recovery.redeem(await newActor(app), { key: earlier.recoveryKey }, "ip")).rejects.toThrow(/not valid/);
    await db.member.update({ where: { id: e.people.Juan.memberId }, data: { recoveryExpiresAt: new Date(Date.now() - 1) } });
    await expect(app.recovery.redeem(await newActor(app), { key: current.recoveryKey }, "ip")).rejects.toThrow(/expired/);
    // Expiring a key does not erase existing access or financial identity.
    expect((await app.queries.view(e.people.Juan.actorId, e.eventId)).me.memberId).toBe(e.people.Juan.memberId);
  });

  it("allows only one winner when two new devices redeem together", async () => {
    const e = await eventWith(app, ["Mark", "Juan"]);
    const issued = await app.recovery.reissue(e.owner, e.eventId, e.people.Juan.memberId, { identityConfirmed: true });
    const phones = await Promise.all([newActor(app), newActor(app)]);
    const results = await Promise.allSettled(phones.map((phone) => app.recovery.redeem(phone, { key: issued.recoveryKey }, "ip")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
