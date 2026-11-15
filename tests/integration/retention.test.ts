/**
 * Owner policy: every event — finished or not — is deleted N days (default 30)
 * after creation. The purge must remove an event with full payment history
 * (reports, rejection, dispute, QR image bytes) and leave younger events alone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { AppContainer } from "@/server/container";
import { DatabaseStorage } from "@/server/storage/PrivateStorage";
import { RetentionPolicy } from "@/domain/event/RetentionPolicy";
import { eventWith, makeApp, pesos, resetDb, version, TEST_KEY } from "./helpers";

const { db } = makeApp();
const app = new AppContainer(db, new DatabaseStorage(db), TEST_KEY, new RetentionPolicy(30));

beforeAll(async () => resetDb(db));
afterAll(async () => db.$disconnect());

describe("RetentionPolicy", () => {
  it("computes the deletion date and days left", () => {
    const p = new RetentionPolicy(30);
    const created = new Date("2026-11-01T00:00:00Z");
    expect(p.deletesAt(created).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(p.daysLeft(created, new Date("2026-11-25T00:00:00Z"))).toBe(6);
    expect(p.daysLeft(created, new Date("2027-01-01T00:00:00Z"))).toBe(0);
    expect(() => new RetentionPolicy(0)).toThrow();
  });
});

describe("30-day purge", () => {
  it("deletes an unfinished event with payment history and its images, keeps younger events", async () => {
    const old = await eventWith(app, ["Mark", "Juan"], "Old trip");
    const P = old.people;
    const { receiptId } = await app.receipts.create(P.Mark.actorId, old.eventId, {
      label: "Groceries",
      payerMemberId: P.Mark.memberId,
      payable: pesos(400),
      lines: [{ label: "Snacks", quantity: 1, amount: pesos(400), mode: "SHARED" }],
      adjustments: [],
    });
    await app.receipts.acknowledgeFunding(P.Mark.actorId, receiptId, { receiptVersion: 1, amount: pesos(400) });
    for (const n of ["Mark", "Juan"]) await app.events.updateMe(P[n].actorId, old.eventId, { entryComplete: true });
    await app.events.transition(P.Mark.actorId, old.eventId, { target: "ALLOCATING", expectedFinancialVersion: await version(app, old.eventId, P.Mark.actorId) });
    const view = await app.queries.view(P.Mark.actorId, old.eventId);
    for (const n of ["Mark", "Juan"]) {
      const me = await app.queries.view(P[n].actorId, old.eventId);
      await app.receipts.saveClaims(P[n].actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: me.me.claimVersion, status: "finish", claims: [{ lineId: view.receipts[0].lines[0].id, units: 1 }] });
    }
    await app.events.transition(P.Mark.actorId, old.eventId, { target: "REVIEWING", expectedFinancialVersion: await version(app, old.eventId, P.Mark.actorId) });
    const v = await version(app, old.eventId, P.Mark.actorId);
    for (const n of ["Mark", "Juan"]) await app.receipts.approveReview(P[n].actorId, old.eventId, v);
    await app.events.transition(P.Mark.actorId, old.eventId, { target: "SETTLING", expectedFinancialVersion: v });
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#000" } }).png().toBuffer();
    const { assetId } = await app.assets.upload(P.Mark.actorId, old.eventId, "QR", png);
    await app.payments.setInstructions(P.Mark.actorId, old.eventId, { acceptsCash: true, keepQr: true }, assetId);
    const edge = (await app.queries.view(P.Juan.actorId, old.eventId)).settlement!.edges[0];
    const r1 = await app.payments.report(P.Juan.actorId, edge.id, { amount: pesos(100), method: "QR", idempotencyKey: "retention-1-abcdef" });
    await app.payments.reject(P.Mark.actorId, r1.reportId, { reason: "not yet" });
    // Event is unfinished (Settling, open dispute) — still purged after 30 days by owner policy.

    const young = await eventWith(app, ["Ana"], "This week");
    const keyRow = await db.asset.findUniqueOrThrow({ where: { id: assetId } });

    // Today: nothing is old enough.
    expect((await app.cleanup.run(new Date())).purgedEvents).toBe(0);

    // 31 days after the old event was created, but only 29 after the young one.
    const oldCreated = (await db.event.findUniqueOrThrow({ where: { id: old.eventId } })).createdAt;
    await db.event.update({ where: { id: young.eventId }, data: { createdAt: new Date(oldCreated.getTime() + 2 * 86_400_000) } });
    const result = await app.cleanup.run(new Date(oldCreated.getTime() + 31 * 86_400_000));
    expect(result.purgedEvents).toBe(1);

    expect(await db.event.count({ where: { id: old.eventId } })).toBe(0);
    expect(await db.member.count({ where: { eventId: old.eventId } })).toBe(0);
    expect(await db.paymentReport.count({ where: { edgeId: edge.id } })).toBe(0);
    expect(await db.dispute.count({ where: { edgeId: edge.id } })).toBe(0);
    expect(await db.assetBlob.count({ where: { key: keyRow.storageKey } })).toBe(0);
    expect(await db.event.count({ where: { id: young.eventId } })).toBe(1);
  });
});
