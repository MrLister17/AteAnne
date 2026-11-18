/**
 * v0.7 "fewer waits" rules on real PostgreSQL (D49, D50): the bill freezes by
 * itself once the roster is closed and everyone is done; a receipt edit puts
 * people back to work; a cancelled event never freezes; a fully paid event
 * closes a day after its last payment activity (the daily cleanup job), so a
 * mistaken confirmation can still be undone in that day.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWith, makeApp, resetDb } from "./helpers";

const { app, db } = makeApp();
beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

type Ctx = Awaited<ReturnType<typeof eventWith>>;
const view = (ctx: Ctx, name = "Mark") => app.queries.view(ctx.people[name].actorId, ctx.eventId);

async function dinner(ctx: Ctx, amount = "10000") {
  const { receiptId } = await app.receipts.create(ctx.people.Mark.actorId, ctx.eventId, {
    label: "Dinner", payerMemberId: ctx.people.Mark.memberId, payable: amount,
    lines: [{ label: "Shared meal", quantity: 1, amount, mode: "SHARED" }], adjustments: [],
  });
  return receiptId;
}

async function claimAll(ctx: Ctx, name: string, receiptId: string) {
  const v = await view(ctx, name);
  const r = v.receipts.find((x) => x.id === receiptId)!;
  await app.receipts.saveClaims(ctx.people[name].actorId, receiptId, { receiptVersion: r.version, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: r.lines.map((l) => ({ lineId: l.id, units: 1 })) });
}

describe("automatic freeze", () => {
  it("a receipt edit makes earlier claims stale and holds the freeze until people answer again", async () => {
    const ctx = await eventWith(app, ["Mark", "Juan"]);
    const receiptId = await dinner(ctx);
    await claimAll(ctx, "Mark", receiptId);
    for (const n of ["Mark", "Juan"]) await app.events.updateMe(ctx.people[n].actorId, ctx.eventId, { entryComplete: true });
    await app.events.lockRoster(ctx.people.Mark.actorId, ctx.eventId);
    // Mark corrects the amount before Juan answers: Mark's own claim is now stale too.
    const r = (await view(ctx)).receipts[0];
    await app.receipts.update(ctx.people.Mark.actorId, receiptId, { label: "Dinner", payerMemberId: ctx.people.Mark.memberId, payable: "12000", lines: [{ id: r.lines[0].id, label: "Shared meal", quantity: 1, amount: "12000", mode: "SHARED" }], adjustments: [], expectedVersion: r.version });
    await claimAll(ctx, "Juan", receiptId);
    let v = await view(ctx);
    expect(v.event.phase).toBe("COLLECTING");
    expect(v.gates.freeze!.blockers.join(" ")).toMatch(/Mark hasn’t claimed from “Dinner” yet/);
    expect(v.receipts[0].fundingAcknowledged).toBe(true); // Mark saved it as the payer
    await claimAll(ctx, "Mark", receiptId);
    v = await view(ctx);
    expect(v.event.phase).toBe("SETTLING");
    expect(v.settlement!.edges.map((e) => e.amount)).toEqual(["6000"]);
  });

  it("a cancelled event never freezes by itself", async () => {
    const ctx = await eventWith(app, ["Mark", "Juan"]);
    const receiptId = await dinner(ctx);
    for (const n of ["Mark", "Juan"]) await app.events.updateMe(ctx.people[n].actorId, ctx.eventId, { entryComplete: true });
    await claimAll(ctx, "Mark", receiptId);
    await app.events.lockRoster(ctx.people.Mark.actorId, ctx.eventId);
    await app.events.setCancelled(ctx.people.Mark.actorId, ctx.eventId, true);
    await expect(claimAll(ctx, "Juan", receiptId)).rejects.toThrow(/cancelled/);
    expect((await view(ctx)).event.phase).toBe("COLLECTING");
  });
});

describe("closing a paid event", () => {
  it("stays open a day after the last payment activity; a reversal restarts the clock", async () => {
    const ctx = await eventWith(app, ["Mark", "Juan"]);
    const receiptId = await dinner(ctx);
    for (const n of ["Mark", "Juan"]) await claimAll(ctx, n, receiptId);
    for (const n of ["Mark", "Juan"]) await app.events.updateMe(ctx.people[n].actorId, ctx.eventId, { entryComplete: true });
    await app.events.lockRoster(ctx.people.Mark.actorId, ctx.eventId);
    const edge = (await view(ctx)).settlement!.edges[0];
    const pay = async (key: string) => {
      const { reportId } = await app.payments.report(ctx.people.Juan.actorId, edge.id, { amount: "5000", method: "CASH", idempotencyKey: key });
      await app.payments.verify(ctx.people.Mark.actorId, reportId);
      return reportId;
    };
    const first = await pay("auto-close-first-1");
    expect((await view(ctx)).gates.done!.ready).toBe(true);
    const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);
    expect(await app.events.closeSettledEvents(later(23))).toBe(0);
    // Mark realises the cash never arrived: the reversal reopens the debt and restarts the clock.
    await app.payments.reverse(ctx.people.Mark.actorId, first, { reason: "Counted the wrong envelope" });
    expect((await view(ctx)).gates.done!.ready).toBe(false);
    expect(await app.events.closeSettledEvents(later(48))).toBe(0);
    await pay("auto-close-second-2");
    expect(await app.events.closeSettledEvents(later(12))).toBe(0);
    const result = await app.cleanup.run(later(25));
    expect(result.closedEvents).toBe(1);
    const done = await view(ctx);
    expect(done.event.phase).toBe("DONE");
    expect(done.audit.find((a) => a.type === "phase.changed")?.actorMemberId).toBeNull();
  });
});
