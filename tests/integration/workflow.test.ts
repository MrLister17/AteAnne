/**
 * End-to-end service workflow against real PostgreSQL: the synthetic
 * Mark / Juan / Paolo multi-receipt event from the reference fixtures,
 * through collecting, allocating, review, frozen snapshot, partial payments,
 * rejection + dispute, reversal and Done.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWith, makeApp, pesos, resetDb, version } from "./helpers";

const { app, db } = makeApp();
let ctx: Awaited<ReturnType<typeof eventWith>>;
const P = () => ctx.people;

beforeAll(async () => {
  await resetDb(db);
  ctx = await eventWith(app, ["Mark", "Juan", "Paolo"]);
});
afterAll(async () => db.$disconnect());

async function receipt(author: string, payer: string, label: string, lines: { label: string; amount: number; qty?: number; mode?: "SHARED" | "UNITS" }[]) {
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const { receiptId } = await app.receipts.create(P()[author].actorId, ctx.eventId, {
    label,
    payerMemberId: P()[payer].memberId,
    payable: pesos(total),
    lines: lines.map((l) => ({ label: l.label, quantity: l.qty ?? 1, amount: pesos(l.amount), mode: l.mode ?? "SHARED" })),
    adjustments: [],
  });
  const view = await app.queries.view(P()[payer].actorId, ctx.eventId);
  const r = view.receipts.find((x) => x.id === receiptId)!;
  await app.receipts.acknowledgeFunding(P()[payer].actorId, receiptId, { receiptVersion: r.version, amount: r.payable });
  return receiptId;
}

const ids: Record<string, string> = {};

describe("Collecting", () => {
  it("creates receipts where creator and payer may differ", async () => {
    ids.r1 = await receipt("Mark", "Mark", "R1", [{ label: "Mark meal", amount: 300 }, { label: "Juan meal", amount: 300 }, { label: "Paolo meal", amount: 300 }]);
    ids.r2 = await receipt("Mark", "Juan", "R2", [{ label: "Juan snack", amount: 100 }, { label: "Paolo snack", amount: 500 }]);
    ids.r3 = await receipt("Paolo", "Mark", "R3", [{ label: "Mark drink", amount: 200 }, { label: "Paolo drink", amount: 200 }]);
    ids.r4 = await receipt("Juan", "Juan", "R4", [{ label: "Juan only", amount: 200 }]);
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(view.receipts.every((r) => r.reconciliation.reconciled && r.fundingAcknowledged)).toBe(true);
  });

  it("only the named payer can confirm funding", async () => {
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const r2 = view.receipts.find((r) => r.id === ids.r2)!;
    await expect(app.receipts.acknowledgeFunding(P().Mark.actorId, ids.r2, { receiptVersion: r2.version, amount: r2.payable })).rejects.toThrow(/named payer/);
  });

  it("a guest cannot edit someone else's receipt; the organizer can (visible correction)", async () => {
    const view = await app.queries.view(P().Paolo.actorId, ctx.eventId);
    const r4 = view.receipts.find((r) => r.id === ids.r4)!;
    const body = { label: "R4", payerMemberId: P().Juan.memberId, payable: "20000", lines: [{ id: r4.lines[0].id, label: "Juan only", quantity: 1, amount: "20000", mode: "SHARED" as const }], adjustments: [], expectedVersion: r4.version };
    await expect(app.receipts.update(P().Paolo.actorId, ids.r4, body)).rejects.toThrow(/organizer/);
    const res = await app.receipts.update(P().Mark.actorId, ids.r4, body);
    expect(res.version).toBe(r4.version + 1);
    // Funding ack is now stale → Juan must re-confirm.
    const after = await app.queries.view(P().Juan.actorId, ctx.eventId);
    expect(after.receipts.find((r) => r.id === ids.r4)!.fundingAcknowledged).toBe(false);
    expect(after.audit.some((a) => a.type === "receipt.organizer_correction")).toBe(true);
    await app.receipts.acknowledgeFunding(P().Juan.actorId, ids.r4, { receiptVersion: res.version, amount: "20000" });
    // stale expectedVersion → 409
    await expect(app.receipts.update(P().Mark.actorId, ids.r4, body)).rejects.toThrow(/changed this receipt/);
  });

  it("entry gate blocks until everyone is done, then locks the roster", async () => {
    const v = await version(app, ctx.eventId, P().Mark.actorId);
    await expect(app.events.transition(P().Mark.actorId, ctx.eventId, { target: "ALLOCATING", expectedFinancialVersion: v })).rejects.toThrow(/Not ready/);
    for (const n of ["Mark", "Juan", "Paolo"]) await app.events.updateMe(P()[n].actorId, ctx.eventId, { entryComplete: true });
    await expect(app.events.transition(P().Juan.actorId, ctx.eventId, { target: "ALLOCATING", expectedFinancialVersion: v })).rejects.toThrow(/organizer/);
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "ALLOCATING", expectedFinancialVersion: v });
    // Roster locked: the old code no longer admits anyone.
    const { newActor } = await import("./helpers");
    const late = await newActor(app);
    await expect(app.events.join(late, { code: ctx.joinCode, displayName: "Late" }, "ip2")).rejects.toThrow();
  });
});

async function claim(name: string, receiptId: string, labels: string[] | "none") {
  const view = await app.queries.view(P()[name].actorId, ctx.eventId);
  const r = view.receipts.find((x) => x.id === receiptId)!;
  return app.receipts.saveClaims(P()[name].actorId, receiptId, {
    receiptVersion: r.version,
    expectedClaimVersion: view.me.claimVersion,
    status: labels === "none" ? "none" : "finish",
    claims: labels === "none" ? [] : r.lines.filter((l) => labels.includes(l.label)).map((l) => ({ lineId: l.id, units: 1 })),
  });
}

describe("Allocating", () => {
  it("each member claims own items or explicitly nothing", async () => {
    await claim("Mark", ids.r1, ["Mark meal"]);
    await claim("Juan", ids.r1, ["Juan meal"]);
    await claim("Paolo", ids.r1, ["Paolo meal"]);
    await claim("Mark", ids.r2, "none"); // Mark got nothing from R2
    await claim("Juan", ids.r2, ["Juan snack"]);
    await claim("Paolo", ids.r2, ["Paolo snack"]);
    await claim("Mark", ids.r3, ["Mark drink"]);
    await claim("Juan", ids.r3, "none");
    await claim("Paolo", ids.r3, ["Paolo drink"]);
    await claim("Mark", ids.r4, "none");
    await claim("Juan", ids.r4, ["Juan only"]);
    // Paolo has not answered R4 yet → review blocked; unanswered ≠ zero.
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(view.gates.reviewing!.ready).toBe(false);
    expect(view.gates.reviewing!.blockers.join(" ")).toMatch(/Paolo has not finished "R4"/);
    await claim("Paolo", ids.r4, "none");
  });

  it("matches the reference nets and transfers", async () => {
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(view.calculation.ok).toBe(true);
    const net = Object.fromEntries(view.calculation.positions.map((p) => [view.members.find((m) => m.id === p.memberId)!.displayName, p.net]));
    expect(net).toEqual({ Mark: "80000", Juan: "20000", Paolo: "-100000" });
    expect(view.calculation.edges).toEqual([
      { from: P().Paolo.memberId, to: P().Mark.memberId, amount: "80000" },
      { from: P().Paolo.memberId, to: P().Juan.memberId, amount: "20000" },
    ]);
  });
});

describe("Reviewing and freeze", () => {
  it("everyone approves the same version; owner cannot approve for others", async () => {
    let v = await version(app, ctx.eventId, P().Mark.actorId);
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "REVIEWING", expectedFinancialVersion: v });
    v = await version(app, ctx.eventId, P().Mark.actorId);
    await app.receipts.approveReview(P().Mark.actorId, ctx.eventId, v);
    await app.receipts.approveReview(P().Juan.actorId, ctx.eventId, v);
    await expect(app.events.transition(P().Mark.actorId, ctx.eventId, { target: "SETTLING", expectedFinancialVersion: v })).rejects.toThrow(/approved/);
    await expect(app.receipts.approveReview(P().Paolo.actorId, ctx.eventId, v - 1)).rejects.toThrow(/changed/);
    await app.receipts.approveReview(P().Paolo.actorId, ctx.eventId, v);
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "SETTLING", expectedFinancialVersion: v });
    const view = await app.queries.view(P().Paolo.actorId, ctx.eventId);
    expect(view.event.phase).toBe("SETTLING");
    expect(view.settlement!.edges.map((e) => e.amount)).toEqual(["80000", "20000"]);
  });

  it("can reopen before any report (old snapshot superseded), then re-freeze", async () => {
    let v = await version(app, ctx.eventId, P().Mark.actorId);
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "REVIEWING", expectedFinancialVersion: v });
    v = await version(app, ctx.eventId, P().Mark.actorId);
    for (const n of ["Mark", "Juan", "Paolo"]) await app.receipts.approveReview(P()[n].actorId, ctx.eventId, v);
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "SETTLING", expectedFinancialVersion: v });
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(view.supersededSnapshots).toHaveLength(1);
  });
});

describe("Settling", () => {
  const edge = async (to: string) => (await app.queries.view(P().Paolo.actorId, ctx.eventId)).settlement!.edges.find((e) => e.to === P()[to].memberId)!;

  it("pending reserves capacity without changing verified balance; retries are idempotent", async () => {
    const e = await edge("Mark");
    const first = await app.payments.report(P().Paolo.actorId, e.id, { amount: "30000", method: "CASH", idempotencyKey: "paolo-pay-1-abcdef" });
    const replay = await app.payments.report(P().Paolo.actorId, e.id, { amount: "30000", method: "CASH", idempotencyKey: "paolo-pay-1-abcdef" });
    expect(replay).toEqual({ reportId: first.reportId, replayed: true });
    const after = await edge("Mark");
    expect([after.verified, after.pending, after.outstanding, after.capacity]).toEqual(["0", "30000", "80000", "50000"]);
    await expect(app.payments.report(P().Paolo.actorId, e.id, { amount: "50001", method: "CASH", idempotencyKey: "paolo-over-abcdef" })).rejects.toThrow(/At most/);
    ids.pay1 = first.reportId;
  });

  it("no financial reopen after any report", async () => {
    const v = await version(app, ctx.eventId, P().Mark.actorId);
    await expect(app.events.transition(P().Mark.actorId, ctx.eventId, { target: "REVIEWING", expectedFinancialVersion: v })).rejects.toThrow(/already been reported/);
  });

  it("sender and owner cannot verify; recipient rejects → dispute blocks new reports", async () => {
    await expect(app.payments.verify(P().Paolo.actorId, ids.pay1)).rejects.toThrow(/recipient/);
    await expect(app.payments.verify(P().Juan.actorId, ids.pay1)).rejects.toThrow(/recipient/);
    const { disputeId } = await app.payments.reject(P().Mark.actorId, ids.pay1, { reason: "Not received yet" });
    const e = await edge("Mark");
    expect(e.verified).toBe("0");
    expect(e.pending).toBe("0");
    await expect(app.payments.report(P().Paolo.actorId, e.id, { amount: "100", method: "CASH", idempotencyKey: "blocked-abcdefgh" })).rejects.toThrow(/Resolve this/);
    // Organizer (Mark is owner but also recipient here) — Juan is not a counterparty.
    await expect(app.payments.chooseResolution(P().Juan.actorId, disputeId, { choice: "NO_TRANSFER", expectedVersion: 1 })).rejects.toThrow(/sender and recipient/);
    await app.payments.chooseResolution(P().Paolo.actorId, disputeId, { choice: "NO_TRANSFER", expectedVersion: 1 });
    expect((await edge("Mark")).disputed).toBe(true);
    await app.payments.chooseResolution(P().Mark.actorId, disputeId, { choice: "NO_TRANSFER", expectedVersion: 2 });
    expect((await edge("Mark")).disputed).toBe(false);
  });

  it("verify, double-click verify, reverse once, then settle fully", async () => {
    const e = await edge("Mark");
    const p2 = await app.payments.report(P().Paolo.actorId, e.id, { amount: "30000", method: "CASH", idempotencyKey: "paolo-pay-2-abcdef" });
    await Promise.all([app.payments.verify(P().Mark.actorId, p2.reportId), app.payments.verify(P().Mark.actorId, p2.reportId)]);
    expect((await edge("Mark")).verified).toBe("30000");
    await expect(app.payments.reverse(P().Paolo.actorId, p2.reportId, { reason: "oops" })).rejects.toThrow(/original recipient/);
    await app.payments.reverse(P().Mark.actorId, p2.reportId, { reason: "Counted the wrong envelope" });
    await expect(app.payments.reverse(P().Mark.actorId, p2.reportId, { reason: "again" })).rejects.toThrow(/only once/);
    expect((await edge("Mark")).outstanding).toBe("80000");

    const p3 = await app.payments.report(P().Paolo.actorId, e.id, { amount: "50000", method: "CASH", idempotencyKey: "paolo-pay-3-abcdef" });
    await app.payments.verify(P().Mark.actorId, p3.reportId);
    const p5 = await app.payments.report(P().Paolo.actorId, e.id, { amount: "30000", method: "CASH", idempotencyKey: "paolo-pay-5-abcdef" });
    await app.payments.verify(P().Mark.actorId, p5.reportId);
    const toJuan = await edge("Juan");
    const p4 = await app.payments.report(P().Paolo.actorId, toJuan.id, { amount: "20000", method: "CASH", idempotencyKey: "paolo-pay-4-abcdef" });

    let v = await version(app, ctx.eventId, P().Mark.actorId);
    await expect(app.events.transition(P().Mark.actorId, ctx.eventId, { target: "DONE", expectedFinancialVersion: v })).rejects.toThrow(/Not everything/);
    await app.payments.verify(P().Juan.actorId, p4.reportId);

    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(view.settlement!.positions.map((p) => p.remaining)).toEqual(["0", "0", "0"]);
    v = view.event.financialVersion;
    await app.events.transition(P().Mark.actorId, ctx.eventId, { target: "DONE", expectedFinancialVersion: v });
    await expect(app.payments.reverse(P().Mark.actorId, p5.reportId, { reason: "late change" })).rejects.toThrow(/Done events are immutable/);
    const done = await app.queries.view(P().Paolo.actorId, ctx.eventId);
    expect(done.event.phase).toBe("DONE");
    // Full history retained, including the rejected report and the reversal.
    const reports = done.settlement!.edges.flatMap((x) => x.reports);
    expect(reports.map((r) => r.status).sort()).toEqual(["REJECTED", "VERIFIED", "VERIFIED", "VERIFIED", "VERIFIED"]);
    expect(reports.filter((r) => r.reversal)).toHaveLength(1);
  });
});
