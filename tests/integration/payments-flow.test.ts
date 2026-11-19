/**
 * S9.2b: confirmation-only reimbursements on real PostgreSQL. The sender
 * reports what they sent, the recipient confirms it arrived; partial
 * payments, a "didn't arrive" dispute and re-recording keep exact centavos,
 * and the server's next step (D53) follows every move.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWith, makeApp, pesos, resetDb } from "./helpers";

const { app, db } = makeApp();
let ctx: Awaited<ReturnType<typeof eventWith>>;
let edgeId = "";

beforeAll(async () => {
  await resetDb(db);
  ctx = await eventWith(app, ["Mark", "Ana"], "Breakfast trip");
  const P = ctx.people;
  const { receiptId } = await app.receipts.create(P.Mark.actorId, ctx.eventId, {
    label: "Breakfast",
    payerMemberId: P.Mark.memberId,
    payable: pesos(1397),
    equalSplit: true,
    lines: [
      { label: "Silog", quantity: 2, amount: pesos(900), mode: "SHARED" },
      { label: "Coffee", quantity: 2, amount: pesos(497), mode: "SHARED" },
    ],
    adjustments: [],
  });
  for (const n of ["Mark", "Ana"]) {
    const v = await app.queries.view(P[n].actorId, ctx.eventId);
    await app.receipts.saveClaims(P[n].actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true });
  }
});
afterAll(async () => db.$disconnect());

const view = (name: string) => app.queries.view(ctx.people[name].actorId, ctx.eventId);

describe("the screen after “2 of 2 confirmed”", () => {
  it("organizer is asked to close joining; Ana is asked if she paid for anything else", async () => {
    const mark = await view("Mark");
    expect(mark.event.phase).toBe("COLLECTING");
    expect(mark.next).toMatchObject({ kind: "doneAdding" });
    const ana = await view("Ana");
    expect(ana.next).toMatchObject({ kind: "doneAdding" });
    await app.events.updateMe(ctx.people.Mark.actorId, ctx.eventId, { entryComplete: true });
    expect((await view("Mark")).next).toMatchObject({ kind: "everyoneHere" });
    await app.events.updateMe(ctx.people.Ana.actorId, ctx.eventId, { entryComplete: true });
    const waiting = await view("Ana");
    expect(waiting.next).toMatchObject({ kind: "waiting", step: "claim", on: [{ memberId: ctx.people.Mark.memberId, task: { kind: "everyoneHere" } }] });
    expect(waiting.group.members.find((g) => g.memberId === ctx.people.Mark.memberId)!.tasks).toEqual([{ kind: "everyoneHere" }]);
  });

  it("Everyone's here freezes the bill by itself; Ana owes ₱698.50", async () => {
    await app.events.lockRoster(ctx.people.Mark.actorId, ctx.eventId);
    const ana = await view("Ana");
    expect(ana.event.phase).toBe("SETTLING");
    const edge = ana.settlement!.edges[0];
    edgeId = edge.id;
    expect(edge.amount).toBe(pesos(698.5));
    expect(ana.next).toEqual({ kind: "pay", transferId: edgeId, toId: ctx.people.Mark.memberId, amount: pesos(698.5), received: "0" });
    // Mark hasn't shared how to be paid yet.
    expect((await view("Mark")).next).toEqual({ kind: "shareDetails" });
    await app.payments.setInstructions(ctx.people.Mark.actorId, ctx.eventId, { acceptsCash: true, keepQr: false });
    expect((await view("Mark")).next).toMatchObject({ kind: "waiting", step: "pay", incoming: { transferId: edgeId, fromId: ctx.people.Ana.memberId, amount: pesos(698.5) } });
  });
});

describe("partial payment, didn't arrive, record again", () => {
  it("₱400 sent stays pending and changes no balance until Mark confirms", async () => {
    const { reportId } = await app.payments.report(ctx.people.Ana.actorId, edgeId, { amount: pesos(400), method: "CASH", idempotencyKey: "pf-400-abcdef" });
    const ana = await view("Ana");
    const edge = ana.settlement!.edges[0];
    expect(edge.pending).toBe(pesos(400));
    expect(edge.verified).toBe("0");
    expect(ana.settlement!.positions.find((p) => p.memberId === ctx.people.Ana.memberId)!.remaining).toBe(`-${pesos(698.5)}`);
    expect(ana.next).toMatchObject({ kind: "waiting", sent: { transferId: edgeId, amount: pesos(400), left: pesos(298.5) } });
    const mark = await view("Mark");
    expect(mark.next).toMatchObject({ kind: "confirmReceived", reportId, fromId: ctx.people.Ana.memberId, amount: pesos(400) });
    // Only the recipient can confirm.
    await expect(app.payments.verify(ctx.people.Ana.actorId, reportId, { expectedVersion: 1 })).rejects.toThrow();
    await app.payments.verify(ctx.people.Mark.actorId, reportId, { expectedVersion: 1 });
  });

  it("after Mark confirms ₱400, Ana's next step is the ₱298.50 left", async () => {
    const ana = await view("Ana");
    const edge = ana.settlement!.edges[0];
    expect(edge.verified).toBe(pesos(400));
    expect(edge.outstanding).toBe(pesos(298.5));
    expect(ana.next).toEqual({ kind: "pay", transferId: edgeId, toId: ctx.people.Mark.memberId, amount: pesos(298.5), received: pesos(400) });
  });

  it("“It didn't arrive” opens a dispute both must answer; agreeing to record it again settles it", async () => {
    const P = ctx.people;
    const second = await app.payments.report(P.Ana.actorId, edgeId, { amount: pesos(298.5), method: "CASH", idempotencyKey: "pf-298-abcdef" });
    const { disputeId } = await app.payments.reject(P.Mark.actorId, second.reportId, { reason: "Nothing came into my GCash", expectedVersion: 1 });
    expect((await view("Ana")).next).toMatchObject({ kind: "sortOut", withId: P.Mark.memberId, recordAgain: false });
    expect((await view("Mark")).next).toMatchObject({ kind: "sortOut", withId: P.Ana.memberId, recordAgain: false });
    await app.payments.chooseResolution(P.Ana.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 1 });
    expect((await view("Ana")).next).toMatchObject({ kind: "waiting", on: [{ memberId: P.Mark.memberId, task: { kind: "sortOut" } }] });
    await app.payments.chooseResolution(P.Mark.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 2 });
    expect((await view("Ana")).next).toMatchObject({ kind: "sortOut", recordAgain: true });
    const again = await app.payments.report(P.Ana.actorId, edgeId, { amount: pesos(298.5), method: "CASH", idempotencyKey: "pf-298-again1", replacesReportId: second.reportId });
    const mark = await view("Mark");
    expect(mark.next).toMatchObject({ kind: "confirmReceived", reportId: again.reportId, amount: pesos(298.5) });
    await app.payments.verify(P.Mark.actorId, again.reportId, { expectedVersion: 1 });
    const done = await view("Ana");
    expect(done.settlement!.edges[0].settled).toBe(true);
    expect(done.gates.done!.ready).toBe(true);
    expect(done.next).toEqual({ kind: "allPaid" });
    expect((await view("Mark")).next).toEqual({ kind: "allPaid" });
  });

  it("nothing about the payment needed an upload: no receipt or proof images were stored", async () => {
    expect(await db.asset.count({ where: { eventId: ctx.eventId } })).toBe(0);
  });
});
