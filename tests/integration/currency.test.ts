/**
 * S10 (D58–D62): receipts in any currency converted at the rate of the day
 * they were bought, one settle-up currency per event, paying a transfer in
 * another currency at the day's rate, and the rules for changing currencies.
 * Rates come from a fake ECB table; days are real Manila days.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppContainer } from "@/server/container";
import { createPrisma } from "@/server/db";
import { LocalDiskStorage } from "@/server/storage/PrivateStorage";
import { FAKE_PER_EUR, FakeRateProvider } from "@/server/fx/RateProvider";
import { addDays, manilaDay } from "@/domain/money/Currency";
import { TEST_KEY, newActor, resetDb } from "./helpers";

const today = manilaDay();
const yesterday = addDays(today, -1);

// Yesterday: 1 THB = 1.625 PHP (the plan's example). Today: 1 THB = 1.63 PHP.
let outage = false;
const provider = new FakeRateProvider((day) => (outage ? null : day === today ? { ...FAKE_PER_EUR, PHP: "65.2" } : FAKE_PER_EUR));
const db = createPrisma(process.env.TEST_DATABASE_URL!);
const app = new AppContainer(db, new LocalDiskStorage(mkdtempSync(path.join(os.tmpdir(), "ateanne-fx-"))), TEST_KEY, undefined, null, provider);

beforeEach(async () => {
  outage = false;
  await resetDb(db);
});
afterAll(() => db.$disconnect());

async function trip(currency = "PHP") {
  const markActor = await newActor(app);
  const created = await app.events.create(markActor, { title: "Bangkok", displayName: "Mark", intent: "PAID_EXPENSE", currency });
  const anaActor = await newActor(app);
  const ana = await app.events.join(anaActor, { code: created.joinCode, displayName: "Ana" }, "ip");
  return { eventId: created.eventId, mark: { actorId: markActor, memberId: created.memberId }, ana: { actorId: anaActor, memberId: ana.memberId } };
}

/** Airport snacks PHP 600 paid by Ana; Breakfast THB 1,397 (equal) paid by Mark yesterday. Everyone answers; roster closes. */
async function frozenTrip() {
  const t = await trip();
  const snacks = await app.receipts.create(t.ana.actorId, t.eventId, {
    label: "Airport snacks", payerMemberId: t.ana.memberId, payable: "60000", lines: [{ label: "Snacks", amount: "60000", quantity: 1, mode: "SHARED" }], adjustments: [],
  });
  const breakfast = await app.receipts.create(t.mark.actorId, t.eventId, {
    label: "Breakfast", payerMemberId: t.mark.memberId, currency: "THB", purchasedOn: yesterday, payable: "139700", equalSplit: true,
    lines: [{ label: "Set", amount: "139700", quantity: 1, mode: "SHARED" }], adjustments: [],
  });
  for (const p of [t.mark, t.ana]) {
    let v = await app.queries.view(p.actorId, t.eventId);
    const snackLine = v.receipts.find((r) => r.id === snacks.receiptId)!.lines[0].id;
    await app.receipts.saveClaims(p.actorId, snacks.receiptId, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [{ lineId: snackLine, units: 1 }] });
    v = await app.queries.view(p.actorId, t.eventId);
    await app.receipts.saveClaims(p.actorId, breakfast.receiptId, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true });
    await app.events.updateMe(p.actorId, t.eventId, { entryComplete: true });
  }
  return { ...t, snacks: snacks.receiptId, breakfast: breakfast.receiptId };
}

describe("receipts in another currency", () => {
  it("convert at the rate of the day they were bought and freeze with that rate (plan §2)", async () => {
    const t = await frozenTrip();
    let view = await app.queries.view(t.mark.actorId, t.eventId);
    const breakfast = view.receipts.find((r) => r.id === t.breakfast)!;
    expect(breakfast).toMatchObject({ currency: "THB", purchasedOn: yesterday, payable: "139700", settlePayable: "227013", rateMissing: false });
    expect(breakfast.rate).toMatchObject({ base: "THB", quote: "PHP", rate: "1.625", date: yesterday, source: "fake" });
    expect(view.fx.used).toEqual(["PHP", "THB"]);
    expect(view.calculation.positions.find((p) => p.memberId === t.ana.memberId)!.net).toBe("-83506");

    expect((await app.events.lockRoster(t.mark.actorId, t.eventId)).phase).toBe("SETTLING");
    view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.settlement!.policyVersion).toBe("ateanne-allocation-v3");
    expect(view.settlement!.edges).toHaveLength(1);
    expect(view.settlement!.edges[0]).toMatchObject({ from: t.ana.memberId, to: t.mark.memberId, amount: "83506" });
    const facts = view.settlement!.facts as { currency: string; receipts: { label: string; currency: string; purchasedOn: string; rate: { rate: string; date: string } | null; settlePayable: string; settleShares: Record<string, string> }[] };
    expect(facts.currency).toBe("PHP");
    const frozen = facts.receipts.find((r) => r.label === "Breakfast")!;
    expect(frozen).toMatchObject({ currency: "THB", purchasedOn: yesterday, settlePayable: "227013" });
    expect(frozen.rate).toMatchObject({ rate: "1.625", date: yesterday });
    expect(frozen.settleShares).toEqual({ [t.mark.memberId]: "113507", [t.ana.memberId]: "113506" });
    expect(facts.receipts.find((r) => r.label === "Airport snacks")!.rate).toBeNull();
  });

  it("refuse a purchase date in the future", async () => {
    const t = await trip();
    await expect(
      app.receipts.create(t.mark.actorId, t.eventId, { label: "Later", payerMemberId: t.mark.memberId, currency: "THB", purchasedOn: addDays(today, 1), payable: "100", lines: [{ label: "x", amount: "100", quantity: 1, mode: "SHARED" }] }),
    ).rejects.toThrow(/after today/);
  });

  it("wait for a missing rate, never guess, and freeze in the daily job once it arrives", async () => {
    outage = true;
    const t = await frozenTrip();
    let view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.receipts.find((r) => r.id === t.breakfast)!).toMatchObject({ rateMissing: true, settlePayable: null, rate: null });
    expect(view.calculation.ok).toBe(false);
    expect((await app.events.lockRoster(t.mark.actorId, t.eventId)).phase).toBe("COLLECTING");
    view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.gates.freeze!.blockers.join(" ")).toMatch(/Waiting for the .* THB exchange rate/);
    expect(view.group.reasons.join(" ")).toMatch(/exchange rate/);

    outage = false;
    const run = await app.cleanup.run();
    expect(run.frozenEvents).toBe(1);
    view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.event.phase).toBe("SETTLING");
    expect(view.settlement!.edges[0].amount).toBe("83506");
  });

  it("keep peso-only events exactly as before (v2 policy, no rates fetched)", async () => {
    const calls = provider.calls;
    const t = await trip();
    await app.receipts.create(t.mark.actorId, t.eventId, { label: "Lunch", payerMemberId: t.mark.memberId, payable: "10000", lines: [{ label: "x", amount: "10000", quantity: 1, mode: "SHARED" }] });
    const view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.receipts[0]).toMatchObject({ currency: "PHP", rate: null, rateMissing: false, settlePayable: "10000" });
    expect(provider.calls).toBe(calls);
  });
});

describe("paying in another currency", () => {
  it("credits the full transfer exactly at the day's rate, and the receiver confirms what was sent", async () => {
    const t = await frozenTrip();
    await app.events.lockRoster(t.mark.actorId, t.eventId);
    let view = await app.queries.view(t.ana.actorId, t.eventId);
    expect(view.fx.today?.perEur.PHP).toBe("65.2");
    expect(view.defaultAcceptedCurrencies).toEqual(["PHP", "THB"]);
    const edge = view.settlement!.edges[0];

    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-wrong-day", paid: { currency: "THB", amount: "51231", rateDate: yesterday } })).rejects.toThrow(/rate changed/);
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83500", method: "CASH", idempotencyKey: "fx-wrong-amt", paid: { currency: "THB", amount: "51231", rateDate: today } })).rejects.toThrow(/counts as PHP 835.06/);
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-too-much", paid: { currency: "THB", amount: "51232", rateDate: today } })).rejects.toThrow(/At most THB 512.31/);

    const ok = await app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-full-1", paid: { currency: "THB", amount: "51231", rateDate: today } });
    const again = await app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-full-1", paid: { currency: "THB", amount: "51231", rateDate: today } });
    expect(again).toEqual({ reportId: ok.reportId, replayed: true });
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-full-1" })).rejects.toThrow(/already used/);

    view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.next).toMatchObject({ kind: "confirmReceived", amount: "83506", paid: { currency: "THB", amount: "51231" } });
    expect(view.settlement!.edges[0].reports[0].paid).toEqual({ currency: "THB", amount: "51231", rate: "1.63", rateDate: today, source: "fake" });
    await app.payments.verify(t.mark.actorId, ok.reportId, { expectedVersion: 1 });
    view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.settlement!.edges[0].settled).toBe(true);
    expect(view.gates.done!.ready).toBe(true);

    const csv = (await app.queries.export(t.mark.actorId, t.eventId, "csv")).body;
    expect(csv.split("\n")[0]).toBe("section,receipt_or_transfer,member,item,amount,currency,settle_amount,rate,rate_date,status");
    expect(csv).toContain(`receipt_funding,Breakfast,Mark,${yesterday},1397.00,THB,2270.13,1 THB = 1.625 PHP,${yesterday},paid to merchant`);
    expect(csv).toContain(`payment_report,Ana → Mark,Ana,CASH,512.31,THB,835.06,1 THB = 1.63 PHP,${today},VERIFIED`);
    const json = JSON.parse((await app.queries.export(t.mark.actorId, t.eventId, "json")).body);
    expect(json.event.currency).toBe("PHP");
    expect(json.receipts.find((r: { label: string }) => r.label === "Breakfast").conversion).toMatchObject({ payable: "2270.13", rateDate: yesterday });
  });

  it("mixes partial payments in both currencies down to zero", async () => {
    const t = await frozenTrip();
    await app.events.lockRoster(t.mark.actorId, t.eventId);
    const edge = (await app.queries.view(t.ana.actorId, t.eventId)).settlement!.edges[0];
    const a = await app.payments.report(t.ana.actorId, edge.id, { amount: "48900", method: "CASH", idempotencyKey: "fx-part-1", paid: { currency: "THB", amount: "30000", rateDate: today } });
    const b = await app.payments.report(t.ana.actorId, edge.id, { amount: "34606", method: "CASH", idempotencyKey: "fx-part-2" });
    await app.payments.verify(t.mark.actorId, a.reportId, { expectedVersion: 1 });
    await app.payments.verify(t.mark.actorId, b.reportId, { expectedVersion: 1 });
    const view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.settlement!.edges[0]).toMatchObject({ verified: "83506", outstanding: "0", settled: true });
  });

  it("only in currencies the receiver accepts, and only with a rate", async () => {
    const t = await frozenTrip();
    await app.events.lockRoster(t.mark.actorId, t.eventId);
    await app.payments.setInstructions(t.mark.actorId, t.eventId, { acceptsCash: true, acceptedCurrencies: ["JPY"] });
    const edge = (await app.queries.view(t.ana.actorId, t.eventId)).settlement!.edges[0];
    const view = await app.queries.view(t.ana.actorId, t.eventId);
    expect(view.instructions[t.mark.memberId].acceptedCurrencies).toEqual(["PHP", "JPY"]);
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-not-ok", paid: { currency: "THB", amount: "51231", rateDate: today } })).rejects.toThrow(/doesn't accept THB/);
    await db.exchangeRate.deleteMany({ where: { day: new Date(`${today}T00:00:00Z`) } });
    outage = true;
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "4", method: "CASH", idempotencyKey: "fx-no-rate", paid: { currency: "JPY", amount: "1", rateDate: today } })).rejects.toThrow(/isn't available yet/);
    // Paying in the settle-up currency never needs a rate.
    await app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "php-ok-1" });
  });

  it("an agreed replacement re-records the same money at its original rate", async () => {
    const t = await frozenTrip();
    await app.events.lockRoster(t.mark.actorId, t.eventId);
    const edge = (await app.queries.view(t.ana.actorId, t.eventId)).settlement!.edges[0];
    const first = await app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-rep-1", paid: { currency: "THB", amount: "51231", rateDate: today } });
    const { disputeId } = await app.payments.reject(t.mark.actorId, first.reportId, { reason: "Not in my wallet yet", expectedVersion: 1 });
    await app.payments.chooseResolution(t.ana.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 1 });
    await app.payments.chooseResolution(t.mark.actorId, disputeId, { choice: "REPLACEMENT", expectedVersion: 2 });
    await expect(app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-rep-2", replacesReportId: first.reportId, paid: { currency: "JPY", amount: "1", rateDate: today } })).rejects.toThrow();
    const replacement = await app.payments.report(t.ana.actorId, edge.id, { amount: "83506", method: "CASH", idempotencyKey: "fx-rep-3", replacesReportId: first.reportId, paid: { currency: "THB", amount: "51231", rateDate: today } });
    const view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.settlement!.edges[0].reports.find((r) => r.id === replacement.reportId)!.paid).toMatchObject({ currency: "THB", rate: "1.63" });
  });
});

describe("changing the settle-up currency (D59)", () => {
  it("organizer only, in Add & claim; after freezing only through a correction and before any payment report", async () => {
    const t = await frozenTrip();
    const v = async () => (await app.queries.view(t.mark.actorId, t.eventId)).event.financialVersion;
    await expect(app.events.setCurrency(t.ana.actorId, t.eventId, { currency: "THB", expectedFinancialVersion: await v() })).rejects.toThrow(/Only the organizer/);

    // Settle in baht instead: the peso snacks now convert (bought today, the receipt's default day).
    await app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "THB", expectedFinancialVersion: await v() });
    let view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.event.currency).toBe("THB");
    const snacks = view.receipts.find((r) => r.id === t.snacks)!;
    expect(snacks.rate).toMatchObject({ base: "PHP", quote: "THB", date: today });
    expect(view.receipts.find((r) => r.id === t.breakfast)!.rate).toBeNull();
    expect(view.audit.some((a) => a.type === "event.currency_changed")).toBe(true);
    await app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "PHP", expectedFinancialVersion: await v() });

    await app.events.lockRoster(t.mark.actorId, t.eventId);
    await expect(app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "THB", expectedFinancialVersion: await v() })).rejects.toThrow(/Correct the bill/);

    await app.events.transition(t.mark.actorId, t.eventId, { target: "COLLECTING", expectedFinancialVersion: await v(), reason: "Wrong currency" });
    await app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "THB", expectedFinancialVersion: await v() });
    await app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "PHP", expectedFinancialVersion: await v() });
    await app.events.transition(t.mark.actorId, t.eventId, { target: "SETTLING", expectedFinancialVersion: await v() });

    view = await app.queries.view(t.ana.actorId, t.eventId);
    await app.payments.report(t.ana.actorId, view.settlement!.edges[0].id, { amount: "100", method: "CASH", idempotencyKey: "php-report-1" });
    await app.payments.cancel(t.ana.actorId, (await app.queries.view(t.ana.actorId, t.eventId)).settlement!.edges[0].reports[0].id);
    await app.events.transition(t.mark.actorId, t.eventId, { target: "COLLECTING", expectedFinancialVersion: await v(), reason: "Again" });
    await expect(app.events.setCurrency(t.mark.actorId, t.eventId, { currency: "THB", expectedFinancialVersion: await v() })).rejects.toThrow(/already reported/);
  });

  it("starts an event in another settle-up currency", async () => {
    const t = await trip("THB");
    const view = await app.queries.view(t.mark.actorId, t.eventId);
    expect(view.event.currency).toBe("THB");
    expect(view.fx.used).toEqual(["THB"]);
    const list = await app.events.listForActor(t.mark.actorId);
    expect(list[0].currency).toBe("THB");
  });
});
