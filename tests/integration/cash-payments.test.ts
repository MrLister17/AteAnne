/**
 * D64: running event payments and credit (docs/running-event-payments.md).
 * The spec's example: a THB event where Sam owes THB 1,734.48 and Maya is due
 * THB 6,353.56; Sam hands Maya THB 2,000.00 in cash. Synthetic data.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppContainer } from "@/server/container";
import { createPrisma } from "@/server/db";
import { LocalDiskStorage } from "@/server/storage/PrivateStorage";
import { FakeRateProvider } from "@/server/fx/RateProvider";
import { manilaDay } from "@/domain/money/Currency";
import { TEST_KEY, newActor, resetDb } from "./helpers";

const db = createPrisma(process.env.TEST_DATABASE_URL!);
const app = new AppContainer(db, new LocalDiskStorage(mkdtempSync(path.join(os.tmpdir(), "ateanne-cash-"))), TEST_KEY, undefined, null, new FakeRateProvider());
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

type Person = { actorId: string; memberId: string };
let keySeq = 0;
const key = () => `cash-key-${++keySeq}-${Date.now()}`;

async function trio(currency = "THB") {
  const mayaActor = await newActor(app);
  const created = await app.events.create(mayaActor, { title: "Chiang Mai", displayName: "Maya", intent: "PAID_EXPENSE", currency });
  const people: Record<"maya" | "sam" | "tess", Person> = { maya: { actorId: mayaActor, memberId: created.memberId }, sam: null!, tess: null! };
  for (const [k, displayName] of [["sam", "Sam"], ["tess", "Tess"]] as const) {
    const a = await newActor(app);
    const j = await app.events.join(a, { code: created.joinCode, displayName }, "ip");
    people[k] = { actorId: a, memberId: j.memberId };
  }
  return { eventId: created.eventId, ...people };
}

const view = (p: Person, eventId: string) => app.queries.view(p.actorId, eventId);
const balance = async (p: Person, eventId: string, who: Person = p) => (await view(p, eventId)).balances.find((b) => b.memberId === who.memberId)!;

/** Maya paid THB 7,353.56: Sam had 1,734.48, Tess 4,619.08, Maya 1,000.00 → Maya due 6,353.56, Sam owes 1,734.48. */
async function dinner(t: Awaited<ReturnType<typeof trio>>, everyoneDone = true) {
  const r = await app.receipts.create(t.maya.actorId, t.eventId, {
    label: "Khantoke dinner", payerMemberId: t.maya.memberId, payable: "735356",
    lines: [
      { label: "Sam set", amount: "173448", quantity: 1, mode: "SHARED" },
      { label: "Tess set", amount: "461908", quantity: 1, mode: "SHARED" },
      { label: "Maya set", amount: "100000", quantity: 1, mode: "SHARED" },
    ],
    adjustments: [],
  });
  const lines = (await view(t.maya, t.eventId)).receipts[0].lines;
  for (const [p, label] of [[t.sam, "Sam set"], [t.tess, "Tess set"], [t.maya, "Maya set"]] as const) {
    const v = await view(p, t.eventId);
    await app.receipts.saveClaims(p.actorId, r.receiptId, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [{ lineId: lines.find((l) => l.label === label)!.id, units: 1 }] });
    if (everyoneDone) await app.events.updateMe(p.actorId, t.eventId, { entryComplete: true });
  }
  return r.receiptId;
}

const handOver = (from: Person, to: Person, eventId: string, amount: string, extra: Record<string, unknown> = {}) =>
  app.cash.report(from.actorId, eventId, { recipientMemberId: to.memberId, amount, idempotencyKey: key(), ...extra });

describe("running event payments during Add & claim", () => {
  it("THB 2,000.00 against THB 1,734.48 owed becomes THB 265.52 credit; a later share uses it, whoever paid", async () => {
    const t = await trio();
    await dinner(t, false);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ expenseNet: "-173448", remaining: "-173448", credit: "0" });
    expect(await balance(t.maya, t.eventId)).toMatchObject({ remaining: "635356" });

    const { reportId } = await handOver(t.sam, t.maya, t.eventId, "200000");
    // Reported: nothing changes until Maya confirms; Maya's next step is to confirm it.
    expect(await balance(t.sam, t.eventId)).toMatchObject({ remaining: "-173448", credit: "0" });
    const mayaView = await view(t.maya, t.eventId);
    expect(mayaView.next).toMatchObject({ kind: "confirmCash", reportId, fromId: t.sam.memberId, amount: "200000" });
    await expect(app.cash.verify(t.tess.actorId, reportId)).rejects.toThrow(/Only the person who got the money/);

    await app.cash.verify(t.maya.actorId, reportId, { expectedVersion: 1 });
    expect(await balance(t.sam, t.eventId)).toMatchObject({ expenseNet: "-173448", paymentNet: "200000", remaining: "26552", credit: "26552", cashSent: "200000" });
    expect(await balance(t.maya, t.eventId)).toMatchObject({ expenseNet: "635356", paymentNet: "-200000", remaining: "435356", credit: "0", cashReceived: "200000" });
    const sums = (await view(t.maya, t.eventId)).balances.reduce((a, b) => a + BigInt(b.remaining!), 0n);
    expect(sums).toBe(0n);

    // Tess pays for snacks; Sam's THB 100.00 share comes out of his credit.
    const snacks = await app.receipts.create(t.tess.actorId, t.eventId, { label: "Snacks", payerMemberId: t.tess.memberId, payable: "10000", lines: [{ label: "Mango sticky rice", amount: "10000", quantity: 1, mode: "SHARED" }] });
    const line = (await view(t.sam, t.eventId)).receipts.find((r) => r.id === snacks.receiptId)!.lines[0].id;
    const sv = await view(t.sam, t.eventId);
    await app.receipts.saveClaims(t.sam.actorId, snacks.receiptId, { receiptVersion: 1, expectedClaimVersion: sv.me.claimVersion, status: "finish", claims: [{ lineId: line, units: 1 }] });
    expect(await balance(t.sam, t.eventId)).toMatchObject({ remaining: "16552", credit: "16552" });
  });

  it("works before any receipt, and the combined balance follows once receipts exist", async () => {
    const t = await trio();
    const { reportId } = await handOver(t.sam, t.maya, t.eventId, "50000", { note: "Taxi money" });
    await app.cash.verify(t.maya.actorId, reportId);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ expenseNet: "0", remaining: "50000", credit: "50000" });
    await dinner(t, false);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ remaining: "-123448", credit: "0" });
  });

  it("a pending payment holds the freeze; confirming it freezes in the same step, carried exactly once, also after a correction", async () => {
    const t = await trio();
    await dinner(t);
    const { reportId } = await handOver(t.sam, t.maya, t.eventId, "200000");
    expect((await app.events.lockRoster(t.maya.actorId, t.eventId)).phase).toBe("COLLECTING");
    expect((await view(t.maya, t.eventId)).gates.freeze!.blockers).toContain("Maya hasn’t confirmed THB 2,000.00 from Sam yet");
    await app.cash.verify(t.maya.actorId, reportId);

    let v = await view(t.maya, t.eventId);
    expect(v.event.phase).toBe("SETTLING");
    const facts = v.settlement!.facts as { carriedPayments: { source: string; reportId: string; amount: string }[] };
    expect(facts.carriedPayments).toEqual([expect.objectContaining({ source: "cash", reportId, amount: "200000" })]);
    // Residual plan: Tess owes everything; Sam is now owed his THB 265.52 credit.
    expect(v.settlement!.edges.map((e) => [e.from, e.to, e.amount])).toEqual([
      [t.tess.memberId, t.maya.memberId, "435356"],
      [t.tess.memberId, t.sam.memberId, "26552"],
    ]);
    expect(v.settlement!.positions.find((p) => p.memberId === t.sam.memberId)).toMatchObject({ net: "-173448", remaining: "26552" });

    // Correct and re-freeze: the cash still counts once.
    await app.events.transition(t.maya.actorId, t.eventId, { target: "COLLECTING", expectedFinancialVersion: v.event.financialVersion, reason: "Check snacks" });
    v = await view(t.maya, t.eventId);
    expect(v.calculation.positions.find((p) => p.memberId === t.sam.memberId)!.remaining).toBe("26552");
    await app.events.transition(t.maya.actorId, t.eventId, { target: "SETTLING", expectedFinancialVersion: v.event.financialVersion });
    v = await view(t.maya, t.eventId);
    expect(v.settlement!.positions.find((p) => p.memberId === t.sam.memberId)!.remaining).toBe("26552");
    expect(v.settlement!.edges.reduce((a, e) => a + BigInt(e.amount), 0n)).toBe(461908n);
  });

  it("retries are idempotent even after the auto-freeze; a reused key with other input conflicts", async () => {
    const t = await trio();
    await dinner(t);
    await app.events.lockRoster(t.maya.actorId, t.eventId);
    const body = { recipientMemberId: t.maya.memberId, amount: "200000", idempotencyKey: "same-key-123" };
    const first = await app.cash.report(t.sam.actorId, t.eventId, body);
    await app.cash.verify(t.maya.actorId, first.reportId);
    expect((await view(t.sam, t.eventId)).event.phase).toBe("SETTLING");
    expect(await app.cash.report(t.sam.actorId, t.eventId, body)).toEqual({ reportId: first.reportId, replayed: true });
    await expect(app.cash.report(t.sam.actorId, t.eventId, { ...body, amount: "200001" })).rejects.toThrow(/already used/);
  });

  it("“didn't arrive”: both agree to re-record the same handoff, or agree nothing was handed over", async () => {
    const t = await trio();
    await dinner(t, false);
    const first = await handOver(t.sam, t.maya, t.eventId, "200000");
    const { disputeId } = await app.cash.reject(t.maya.actorId, first.reportId, { reason: "Not in my wallet", expectedVersion: 1 });
    expect((await view(t.sam, t.eventId)).next).toMatchObject({ kind: "sortOutCash", disputeId, recordAgain: false });
    await app.cash.chooseResolution(t.sam.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 1 });
    await app.cash.chooseResolution(t.maya.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 2 });
    expect((await view(t.sam, t.eventId)).next).toMatchObject({ kind: "sortOutCash", recordAgain: true });
    await expect(handOver(t.sam, t.maya, t.eventId, "150000", { replacesReportId: first.reportId })).rejects.toThrow(/same amount/);
    const again = await handOver(t.sam, t.maya, t.eventId, "200000", { replacesReportId: first.reportId });
    await app.cash.verify(t.maya.actorId, again.reportId);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ credit: "26552" });

    const second = await handOver(t.tess, t.maya, t.eventId, "10000");
    const d2 = await app.cash.reject(t.maya.actorId, second.reportId, { reason: "Never got it" });
    await app.cash.chooseResolution(t.tess.actorId, d2.disputeId, { choice: "NO_TRANSFER", expectedVersion: 1 });
    await app.cash.chooseResolution(t.maya.actorId, d2.disputeId, { choice: "NO_TRANSFER", expectedVersion: 2 });
    expect(await balance(t.tess, t.eventId)).toMatchObject({ paymentNet: "0", remaining: "-461908" });
    expect((await view(t.maya, t.eventId)).gates.freeze!.blockers.join(" ")).not.toMatch(/sort out/);
  });

  it("undo a mistaken confirmation once, with a reason; a real refund is a payment the other way", async () => {
    const t = await trio();
    await dinner(t, false);
    const pay = await handOver(t.sam, t.maya, t.eventId, "200000");
    await app.cash.verify(t.maya.actorId, pay.reportId);
    const refund = await handOver(t.maya, t.sam, t.eventId, "26552", { note: "Change back" });
    await app.cash.verify(t.sam.actorId, refund.reportId);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ remaining: "0", credit: "0" });
    await expect(app.cash.reverse(t.sam.actorId, pay.reportId, { reason: "oops" })).rejects.toThrow(/Only the person who confirmed/);
    await app.cash.reverse(t.sam.actorId, refund.reportId, { reason: "Typed by mistake" });
    await expect(app.cash.reverse(t.sam.actorId, refund.reportId, { reason: "again" })).rejects.toThrow(/once/);
    expect(await balance(t.sam, t.eventId)).toMatchObject({ remaining: "26552" });
    const csv = (await app.queries.export(t.maya.actorId, t.eventId, "csv")).body;
    expect(csv).toContain("cash_payment,Sam → Maya,Sam,CASH,2000.00,THB,2000.00,,,VERIFIED");
    expect(csv).toContain("VERIFIED then REVERSED");
  });

  it("cash in another accepted currency uses the day's locked rate", async () => {
    const t = await trio("PHP");
    await app.receipts.create(t.maya.actorId, t.eventId, { label: "Hotel", payerMemberId: t.maya.memberId, currency: "THB", payable: "100000", lines: [{ label: "Room", amount: "100000", quantity: 1, mode: "SHARED" }] });
    const today = manilaDay();
    await expect(handOver(t.sam, t.maya, t.eventId, "162500", { paid: { currency: "THB", amount: "100000", rateDate: "2020-01-01" } })).rejects.toThrow(/rate changed/);
    await expect(handOver(t.sam, t.maya, t.eventId, "160000", { paid: { currency: "THB", amount: "100000", rateDate: today } })).rejects.toThrow(/counts as PHP 1,625.00/);
    await expect(handOver(t.sam, t.maya, t.eventId, "100", { paid: { currency: "JPY", amount: "250", rateDate: today } })).rejects.toThrow(/doesn't accept JPY/);
    const ok = await handOver(t.sam, t.maya, t.eventId, "162500", { paid: { currency: "THB", amount: "100000", rateDate: today } });
    const report = (await view(t.maya, t.eventId)).cash.reports.find((c) => c.id === ok.reportId)!;
    expect(report).toMatchObject({ amount: "162500", paid: { currency: "THB", amount: "100000", rate: "1.625", rateDate: today } });
  });

  it("locks deletion and the settle-up currency, protects payment parties and only cancels once cash is returned", async () => {
    const t = await trio();
    const fv = async () => (await view(t.maya, t.eventId)).event.financialVersion;
    const pay = await handOver(t.sam, t.maya, t.eventId, "50000");
    await expect(app.events.setCancelled(t.maya.actorId, t.eventId, true)).rejects.toThrow(/before cancelling/);
    await app.cash.verify(t.maya.actorId, pay.reportId);
    await expect(app.events.deleteEvent(t.maya.actorId, t.eventId, "Chiang Mai")).rejects.toThrow(/Payments were reported/);
    await expect(app.events.setCurrency(t.maya.actorId, t.eventId, { currency: "PHP", expectedFinancialVersion: await fv() })).rejects.toThrow(/already reported/);
    await expect(app.events.removeMember(t.maya.actorId, t.eventId, t.sam.memberId)).rejects.toThrow(/referenced/);
    await expect(app.events.setCancelled(t.maya.actorId, t.eventId, true)).rejects.toThrow(/money given back/);
    const back = await handOver(t.maya, t.sam, t.eventId, "50000");
    await app.cash.verify(t.sam.actorId, back.reportId);
    await app.events.setCancelled(t.maya.actorId, t.eventId, true);
    await expect(handOver(t.sam, t.maya, t.eventId, "100")).rejects.toThrow(/cancelled/);
  });
});

describe("running event payments during Pay", () => {
  async function frozen() {
    const t = await trio();
    await dinner(t);
    await app.events.lockRoster(t.maya.actorId, t.eventId);
    return t;
  }

  it("cash above a frozen transfer re-plans the rest; receipts and shares stay; old transfers go stale; Done follows", async () => {
    const t = await frozen();
    let v = await view(t.sam, t.eventId);
    const oldSnapshot = v.settlement!;
    const samEdge = oldSnapshot.edges.find((e) => e.from === t.sam.memberId)!;
    expect(samEdge.amount).toBe("173448");

    const cash = await handOver(t.sam, t.maya, t.eventId, "200000");
    // While it waits: other payments, Done and a correction pause; a second cash report waits too.
    const tessEdge = oldSnapshot.edges.find((e) => e.from === t.tess.memberId)!;
    await expect(app.payments.report(t.tess.actorId, tessEdge.id, { amount: "1000", method: "CASH", idempotencyKey: key() })).rejects.toThrow(/paused/);
    await expect(handOver(t.tess, t.maya, t.eventId, "1000")).rejects.toThrow(/Another cash payment/);
    v = await view(t.maya, t.eventId);
    expect(v.cash.paused).toBe(true);
    expect(v.gates.done!.blockers.join(" ")).toMatch(/hasn’t confirmed THB 2,000.00 from Sam/);
    await expect(app.events.transition(t.maya.actorId, t.eventId, { target: "COLLECTING", expectedFinancialVersion: v.event.financialVersion, reason: "x" })).rejects.toThrow();

    await app.cash.verify(t.maya.actorId, cash.reportId);
    v = await view(t.maya, t.eventId);
    expect(v.event.phase).toBe("SETTLING");
    expect(v.settlement!.snapshotId).not.toBe(oldSnapshot.snapshotId);
    expect(v.supersededSnapshots.map((s) => s.id)).toContain(oldSnapshot.snapshotId);
    const newFacts = v.settlement!.facts as { receipts: unknown; revision: { reason: string; cashReportId: string; previousSnapshotId: string } };
    expect(newFacts.receipts).toEqual((oldSnapshot.facts as { receipts: unknown }).receipts);
    expect(newFacts.revision).toEqual({ reason: "cash_confirmed", cashReportId: cash.reportId, previousSnapshotId: oldSnapshot.snapshotId });
    expect(v.settlement!.positions.map((p) => p.net)).toEqual(oldSnapshot.positions.map((p) => p.net));
    expect(v.settlement!.edges.map((e) => [e.from, e.to, e.amount])).toEqual([
      [t.tess.memberId, t.maya.memberId, "435356"],
      [t.tess.memberId, t.sam.memberId, "26552"],
    ]);
    await expect(app.payments.report(t.sam.actorId, samEdge.id, { amount: "1000", method: "CASH", idempotencyKey: key() })).rejects.toThrow(/plan changed/);

    for (const e of v.settlement!.edges) {
      const r = await app.payments.report(t.tess.actorId, e.id, { amount: e.amount, method: "CASH", idempotencyKey: key() });
      const recipient = e.to === t.maya.memberId ? t.maya : t.sam;
      await app.payments.verify(recipient.actorId, r.reportId, { expectedVersion: 1 });
    }
    v = await view(t.maya, t.eventId);
    expect(v.gates.done!.ready).toBe(true);
    expect(v.balances.every((b) => b.remaining === "0")).toBe(true);
  });

  it("needs edge payments settled down first, and undoing a confirmation re-plans again", async () => {
    const t = await frozen();
    const v0 = await view(t.tess, t.eventId);
    const tessEdge = v0.settlement!.edges.find((e) => e.from === t.tess.memberId)!;
    const pending = await app.payments.report(t.tess.actorId, tessEdge.id, { amount: "1000", method: "CASH", idempotencyKey: key() });
    await expect(handOver(t.sam, t.maya, t.eventId, "200000")).rejects.toThrow(/waiting to confirm a payment/);
    await app.payments.cancel(t.tess.actorId, pending.reportId);

    const cash = await handOver(t.sam, t.maya, t.eventId, "200000");
    await app.cash.verify(t.maya.actorId, cash.reportId);
    await app.cash.reverse(t.maya.actorId, cash.reportId, { reason: "It was for another trip" });
    const v = await view(t.maya, t.eventId);
    expect((v.settlement!.facts as { revision: { reason: string } }).revision.reason).toBe("cash_reversed");
    expect(v.settlement!.edges.map((e) => e.amount).sort()).toEqual(["173448", "461908"]);
    expect(v.supersededSnapshots).toHaveLength(2);
  });
});
