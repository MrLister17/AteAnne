/**
 * Guests: people without a phone, managed by the organizer or an admin.
 * Mark (organizer) and Juan (has a phone) eat with Lola (no phone) and
 * Tito (no phone). Mark makes Juan an admin. Managers act for guests through
 * every step, and every such action is audited with both names.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWith, makeApp, newActor, pesos, resetDb } from "./helpers";

const { app, db } = makeApp();
let ctx: Awaited<ReturnType<typeof eventWith>>;
const P = () => ctx.people;
const ids: Record<string, string> = {};
const as = (name: string, guest: string) => ({ actorId: P()[name].actorId, asMemberId: ids[guest] });

beforeAll(async () => {
  await resetDb(db);
  ctx = await eventWith(app, ["Mark", "Juan", "Paolo"]);
});
afterAll(async () => db.$disconnect());

describe("adding guests and admins", () => {
  it("only the organizer or an admin can add a guest", async () => {
    await expect(app.events.addGuest(P().Juan.actorId, ctx.eventId, { displayName: "Lola" })).rejects.toThrow(/organizer or an admin/);
    ids.lola = (await app.events.addGuest(P().Mark.actorId, ctx.eventId, { displayName: "Lola" })).memberId;
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const lola = view.members.find((m) => m.id === ids.lola)!;
    expect(lola.isGuest).toBe(true);
    expect(view.me.canManageGuests).toBe(true);
    expect(view.audit.some((a) => a.type === "member.guest_added")).toBe(true);
  });

  it("the organizer appoints an admin, who can then add guests", async () => {
    await expect(app.events.setAdmin(P().Juan.actorId, ctx.eventId, P().Paolo.memberId, { isAdmin: true })).rejects.toThrow(/Only the organizer/);
    await expect(app.events.setAdmin(P().Mark.actorId, ctx.eventId, ids.lola, { isAdmin: true })).rejects.toThrow(/without a phone/);
    await app.events.setAdmin(P().Mark.actorId, ctx.eventId, P().Juan.memberId, { isAdmin: true });
    ids.tito = (await app.events.addGuest(P().Juan.actorId, ctx.eventId, { displayName: "Tito" })).memberId;
    const juan = await app.queries.view(P().Juan.actorId, ctx.eventId);
    expect(juan.me.isAdmin).toBe(true);
    expect(juan.me.canManageGuests).toBe(true);
  });

  it("nobody can act for a person who has their own phone", async () => {
    await expect(app.queries.view({ actorId: P().Mark.actorId, asMemberId: P().Paolo.memberId }, ctx.eventId)).rejects.toThrow(/added without a phone/);
    await expect(app.events.updateMe({ actorId: P().Mark.actorId, asMemberId: P().Juan.memberId }, ctx.eventId, { entryComplete: true })).rejects.toThrow(/added without a phone/);
  });

  it("a non-manager cannot act for a guest", async () => {
    await expect(app.queries.view(as("Paolo", "lola"), ctx.eventId)).rejects.toThrow(/organizer or an admin/);
  });

  it("acting for a guest shows the event as the guest, and the audit names both", async () => {
    const view = await app.queries.view(as("Mark", "lola"), ctx.eventId);
    expect(view.me.memberId).toBe(ids.lola);
    expect(view.me.isGuest).toBe(true);
    expect(view.me.isOwner).toBe(false);
    expect(view.me.canManageGuests).toBe(false);
    expect(view.actingFor).toEqual({ byMemberId: P().Mark.memberId, byName: "Mark" });
    expect(view.event.joinCode).toBeNull(); // organizer-only data is not shown in the guest's view
    await app.events.updateMe(as("Mark", "lola"), ctx.eventId, { displayName: "Lola Nena" });
    const after = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const rename = after.audit.find((a) => a.type === "member.renamed")!;
    expect(rename.actorMemberId).toBe(P().Mark.memberId);
    expect(rename.onBehalfOf).toBe(ids.lola);
  });
});

describe("a guest through the whole hatian", () => {
  it("a guest can be the payer; a manager confirms the funding for them", async () => {
    // Mark bought the cake; Lola paid the whole dinner in cash. Mark enters both as himself.
    ids.cake = (
      await app.receipts.create(P().Mark.actorId, ctx.eventId, {
        label: "Cake",
        payerMemberId: P().Mark.memberId,
        payable: pesos(600),
        lines: [{ label: "Ube cake", quantity: 1, amount: pesos(600), mode: "SHARED" }],
        adjustments: [],
      })
    ).receiptId;
    ids.dinner = (
      await app.receipts.create(P().Mark.actorId, ctx.eventId, {
        label: "Dinner",
        payerMemberId: ids.lola,
        payable: pesos(1000),
        lines: [
          { label: "Pancit", quantity: 1, amount: pesos(400), mode: "SHARED" },
          { label: "Lechon kawali", quantity: 4, amount: pesos(600), mode: "UNITS" },
        ],
        adjustments: [],
      })
    ).receiptId;
    // Only the named payer confirms funding: Mark can't do it as himself for Lola's receipt.
    const before = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const d = before.receipts.find((r) => r.id === ids.dinner)!;
    await expect(app.receipts.acknowledgeFunding(P().Mark.actorId, ids.dinner, { receiptVersion: d.version, amount: d.payable })).rejects.toThrow(/named payer/);
    const view = await app.queries.view(P().Mark.actorId, ctx.eventId);
    for (const r of view.receipts) {
      if (r.payerId === ids.lola) await app.receipts.acknowledgeFunding(as("Mark", "lola"), r.id, { receiptVersion: r.version, amount: r.payable });
      else await app.receipts.acknowledgeFunding(P().Mark.actorId, r.id, { receiptVersion: r.version, amount: r.payable });
    }
    const after = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(after.receipts.every((r) => r.fundingAcknowledged)).toBe(true);
    for (const n of ["Mark", "Juan", "Paolo"]) await app.events.updateMe(P()[n].actorId, ctx.eventId, { entryComplete: true });
    // Guests start with entry marked complete, so they never hold up the freeze.
    expect(after.members.filter((m) => m.isGuest).every((m) => m.entryComplete)).toBe(true);
    // "Everyone's here": nobody has claimed yet, so nothing freezes.
    expect((await app.events.lockRoster(P().Mark.actorId, ctx.eventId)).phase).toBe("COLLECTING");
  });

  it("guests can no longer be added once the roster is locked", async () => {
    await expect(app.events.addGuest(P().Mark.actorId, ctx.eventId, { displayName: "Late" })).rejects.toThrow();
  });

  it("managers claim for guests; people with phones claim for themselves; the last claim freezes the bill", async () => {
    const claim = async (caller: string | { actorId: string; asMemberId?: string }, receiptId: string, pick: Record<string, number> | "none") => {
      const v = await app.queries.view(caller, ctx.eventId);
      const r = v.receipts.find((x) => x.id === receiptId)!;
      const claims = pick === "none" ? [] : r.lines.filter((l) => l.label in pick).map((l) => ({ lineId: l.id, units: pick[l.label] }));
      return app.receipts.saveClaims(caller, receiptId, { receiptVersion: r.version, expectedClaimVersion: v.me.claimVersion, status: pick === "none" ? "none" : "finish", claims });
    };
    for (const caller of [P().Mark.actorId, P().Juan.actorId, P().Paolo.actorId, as("Mark", "lola"), as("Juan", "tito")]) await claim(caller, ids.cake, { "Ube cake": 1 });
    await claim(P().Mark.actorId, ids.dinner, { Pancit: 1, "Lechon kawali": 1 });
    await claim(P().Juan.actorId, ids.dinner, { Pancit: 1, "Lechon kawali": 1 });
    await claim(P().Paolo.actorId, ids.dinner, { Pancit: 1 });
    await claim(as("Juan", "lola"), ids.dinner, { Pancit: 1, "Lechon kawali": 2 }); // an admin can act for any guest
    await claim(as("Mark", "tito"), ids.dinner, "none");
    const v = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const saved = v.audit.filter((a) => a.type === "claims.saved" && a.onBehalfOf === ids.lola);
    expect(saved.map((a) => a.actorMemberId).sort()).toEqual([P().Mark.memberId, P().Juan.memberId].sort());
    // Tito's answer (made by Mark for him) was the last one: the app froze the bill itself.
    expect(v.event.phase).toBe("SETTLING");
    const frozen = v.audit.find((a) => a.type === "snapshot.frozen");
    expect(frozen?.actorMemberId).toBeNull();
    expect(frozen?.onBehalfOf).toBeNull();
    expect(v.settlement).not.toBeNull();
    const total = v.settlement!.positions.reduce((a, p) => a + BigInt(p.net), 0n);
    expect(total).toBe(0n);
  });

  it("settling: a guest's money moves through managers, but never with a conflict of interest", async () => {
    // Costs: Mark 370, Juan 370, Paolo 220, Lola 520, Tito 120. Paid: Mark 600, Lola 1000.
    // Nets in join order → Juan→Mark 230, Juan→Lola 140, Paolo→Lola 220, Tito→Lola 120.
    const v = await app.queries.view(P().Mark.actorId, ctx.eventId);
    const name = (id: string) => v.members.find((m) => m.id === id)!.displayName;
    expect(v.settlement!.edges.map((e) => `${name(e.from)}→${name(e.to)} ${e.amount}`)).toEqual([
      "Juan→Mark 23000",
      "Juan→Lola Nena 14000",
      "Paolo→Lola Nena 22000",
      "Tito→Lola Nena 12000",
    ]);
    const [juanMark, juanLola, paoloLola, titoLola] = v.settlement!.edges;

    const r1 = await app.payments.report(P().Juan.actorId, juanMark.id, { amount: juanMark.amount, method: "CASH", idempotencyKey: "juan-mark-abcdef" });
    await app.payments.verify(P().Mark.actorId, r1.reportId);

    // Juan (an admin) paid Lola: Juan must not confirm it for her. Mark (not involved) can.
    const r2 = await app.payments.report(P().Juan.actorId, juanLola.id, { amount: juanLola.amount, method: "CASH", idempotencyKey: "juan-lola-abcdef" });
    await expect(app.payments.verify(as("Juan", "lola"), r2.reportId)).rejects.toThrow(/other person in this payment/);
    await app.payments.verify(as("Mark", "lola"), r2.reportId);

    // Someone with a phone pays a guest: a manager confirms after seeing the cash handed over.
    const r3 = await app.payments.report(P().Paolo.actorId, paoloLola.id, { amount: paoloLola.amount, method: "CASH", idempotencyKey: "paolo-lola-abcdef" });
    await app.payments.verify(as("Juan", "lola"), r3.reportId);

    // Guest pays guest: one manager records Tito's payment, a manager confirms for Lola.
    const r4 = await app.payments.report(as("Mark", "tito"), titoLola.id, { amount: titoLola.amount, method: "CASH", idempotencyKey: "tito-lola-abcdef" });
    await app.payments.verify(as("Mark", "lola"), r4.reportId);

    const done = await app.queries.view(P().Mark.actorId, ctx.eventId);
    expect(done.gates.done!.ready).toBe(true);
    const verified = done.audit.filter((a) => a.type === "payment.verified" && a.onBehalfOf === ids.lola);
    expect(verified).toHaveLength(3);
  });
});

describe("handing a guest their own phone", () => {
  it("a manager creates a key; the guest redeems it and stops being a guest", async () => {
    await expect(app.events.guestAccessKey(P().Paolo.actorId, ctx.eventId, ids.tito)).rejects.toThrow(/organizer or an admin/);
    await expect(app.events.guestAccessKey(P().Mark.actorId, ctx.eventId, P().Paolo.memberId)).rejects.toThrow(/own phone/);
    const { recoveryKey } = await app.events.guestAccessKey(P().Mark.actorId, ctx.eventId, ids.tito);
    // The admin's own phone can't become Tito (identities are never merged).
    await expect(app.recovery.redeem(P().Juan.actorId, { key: recoveryKey }, "ip")).rejects.toThrow(/already/);
    const titoPhone = await newActor(app);
    // Pasted with a line break and spaces from a chat: still accepted.
    const pasted = ` ${recoveryKey.slice(0, 20)}\n${recoveryKey.slice(20)} `;
    const res = await app.recovery.redeem(titoPhone, { key: pasted }, "ip");
    expect(res.memberId).toBe(ids.tito);
    const view = await app.queries.view(titoPhone, ctx.eventId);
    expect(view.me.isGuest).toBe(false);
    // Nobody can act for Tito any more.
    await expect(app.queries.view(as("Mark", "tito"), ctx.eventId)).rejects.toThrow(/added without a phone/);
    expect(view.audit.some((a) => a.type === "member.guest_took_over")).toBe(true);
  });
});
