import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWith, makeApp, resetDb } from "./helpers";

const { app, db } = makeApp();
beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("equal receipt consent", () => {
  it("derives only the caller’s claims and blocks the freeze on disagreement", async () => {
    const e = await eventWith(app, ["Mark", "Juan", "Paolo"]);
    const { receiptId } = await app.receipts.create(e.owner, e.eventId, {
      label: "Shared dinner", payerMemberId: e.people.Mark.memberId, payable: "10000", equalSplit: true,
      lines: [{ label: "Platter", amount: "9999", quantity: 3, mode: "UNITS" }, { label: "Water", amount: "1", quantity: 1, mode: "SHARED" }], adjustments: [],
    });
    let view = await app.queries.view(e.owner, e.eventId);
    expect(view.receipts[0].equalSplit).toBe(true);
    expect(view.receipts[0].lines.every((l) => l.mode === "SHARED" && l.claims.length === 0)).toBe(true);
    expect(view.receipts[0].fundingAcknowledged).toBe(true); // Mark saved it as the payer
    for (const p of Object.values(e.people)) await app.events.updateMe(p.actorId, e.eventId, { entryComplete: true });
    const accept = async (name: string, status: "finish" | "none" = "finish", consent = true) => {
      const person = e.people[name];
      const v = await app.queries.view(person.actorId, e.eventId);
      return app.receipts.saveClaims(person.actorId, receiptId, {
        receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status, claims: [],
        ...(consent && status === "finish" ? { acceptEqualSplit: true } : {}),
      });
    };
    await expect(accept("Mark", "finish", false)).rejects.toThrow(/Confirm your equal share/);
    await accept("Mark");
    view = await app.queries.view(e.owner, e.eventId);
    expect(view.receipts[0].lines.every((l) => l.claims.length === 1 && l.claims[0].memberId === e.people.Mark.memberId)).toBe(true);
    expect(view.gates.freeze!.blockers.join(" ")).toMatch(/Juan hasn’t claimed/);
    await accept("Juan");
    await accept("Paolo", "none");
    view = await app.queries.view(e.owner, e.eventId);
    expect(view.gates.freeze!.blockers.join(" ")).toMatch(/everyone’s confirmation/);
    await accept("Paolo");
    view = await app.queries.view(e.owner, e.eventId);
    expect(view.gates.freeze!.blockers).toEqual(["The organizer hasn’t tapped “Everyone’s here” yet"]);
    expect(view.calculation.positions.map((p) => p.cost)).toEqual(["3334", "3333", "3333"]);
    await expect(app.receipts.saveClaims(e.people.Juan.actorId, receiptId, { receiptVersion: 99, expectedClaimVersion: view.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true })).rejects.toThrow(/corrected/);
    expect((await app.events.lockRoster(e.owner, e.eventId)).phase).toBe("SETTLING");
    view = await app.queries.view(e.owner, e.eventId);
    expect(view.settlement!.positions.map((p) => p.cost)).toEqual(["3334", "3333", "3333"]);
  });
});
