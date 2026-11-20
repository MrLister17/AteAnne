/**
 * NextActions (D53): the single source of "what's next" for Home, Claim, Pay,
 * the tab dot, the guest list and copied reminders. Synthetic events only.
 */
import { describe, expect, it } from "vitest";
import { NextActions, toWire, type NextActionInput } from "@/domain/event/NextAction";

type Receipt = NextActionInput["receipts"][number];
type Transfer = NextActionInput["transfers"][number];

const MARK = "mark";
const ANA = "ana";
const JUAN = "juan";

function receipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: "breakfast",
    label: "Breakfast",
    authorId: MARK,
    payerId: MARK,
    payable: 139_700n,
    currency: "PHP",
    equalSplit: true,
    fundingAcknowledged: true,
    reconciled: true,
    answers: [
      { memberId: MARK, kind: "FINISHED", stale: false },
      { memberId: ANA, kind: "FINISHED", stale: false },
    ],
    ...over,
  };
}

function transfer(over: Partial<Transfer> = {}): Transfer {
  return { id: "t1", from: ANA, to: MARK, amount: 69_850n, verified: 0n, pending: 0n, capacity: 69_850n, settled: false, disputed: false, dispute: null, pendingReports: [], ...over };
}

function input(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    phase: "COLLECTING",
    cancelled: false,
    rosterLocked: false,
    autoFreeze: true,
    freezeReady: false,
    doneReady: false,
    ownerId: MARK,
    members: [
      { id: MARK, active: true, entryComplete: true },
      { id: ANA, active: true, entryComplete: true },
    ],
    receipts: [receipt()],
    transfers: [],
    withPaymentDetails: [MARK],
    freezeBlockers: ["The organizer hasn’t tapped “Everyone’s here” yet."],
    ...over,
  };
}

const next = (i: NextActionInput, who: string) => new NextActions(i).nextFor(who);

describe("step 1: the screen after “2 of 2 confirmed”", () => {
  it("organizer whose own tasks are done is asked “Is everyone here?”", () => {
    expect(next(input(), MARK)).toEqual({ kind: "everyoneHere" });
  });

  it("someone who's done waits for the organizer, by name and reason", () => {
    const n = next(input(), ANA);
    expect(n).toMatchObject({ kind: "waiting", step: "claim", on: [{ memberId: MARK, task: { kind: "everyoneHere" } }] });
  });

  it("someone not done adding receipts gets that before anything else at group level", () => {
    const i = input({ members: [{ id: MARK, active: true, entryComplete: true }, { id: ANA, active: true, entryComplete: false }] });
    expect(next(i, ANA)).toEqual({ kind: "doneAdding" });
    // Mark (organizer) still sees Everyone's here; Ana's tick doesn't block that.
    expect(next(i, MARK)).toEqual({ kind: "everyoneHere" });
  });

  it("another unanswered receipt comes before done adding", () => {
    const lunch = receipt({ id: "lunch", label: "Lunch", equalSplit: false, answers: [{ memberId: MARK, kind: "FINISHED", stale: false }, { memberId: ANA, kind: null, stale: false }] });
    const i = input({ receipts: [receipt(), lunch], members: [{ id: MARK, active: true, entryComplete: true }, { id: ANA, active: true, entryComplete: false }] });
    expect(next(i, ANA)).toEqual({ kind: "claim", receiptId: "lunch", label: "Lunch" });
    expect(new NextActions(i).tasksFor(ANA).map((t) => t.kind)).toEqual(["claim", "doneAdding"]);
  });

  it("a receipt someone else entered for you asks you to confirm paying it", () => {
    const snacks = receipt({ id: "snacks", label: "Snacks", authorId: MARK, payerId: ANA, payable: 50_000n, fundingAcknowledged: false });
    expect(next(input({ receipts: [receipt(), snacks] }), ANA)).toEqual({ kind: "confirmPaid", receiptId: "snacks", label: "Snacks", amount: 50_000n, currency: "PHP" });
  });

  it("a changed receipt asks you to check it again first", () => {
    const changed = receipt({ answers: [{ memberId: MARK, kind: "FINISHED", stale: false }, { memberId: ANA, kind: "FINISHED", stale: true }] });
    const i = input({ receipts: [changed], members: [{ id: MARK, active: true, entryComplete: true }, { id: ANA, active: true, entryComplete: false }] });
    expect(next(i, ANA)).toEqual({ kind: "recheck", receiptId: "breakfast", label: "Breakfast" });
  });

  it("a receipt that doesn't add up is its author's to fix; others wait for it by name of the receipt", () => {
    const broken = receipt({ reconciled: false, fundingAcknowledged: false });
    const i = input({ receipts: [broken], rosterLocked: true });
    expect(next(i, MARK)).toEqual({ kind: "fixReceipt", receiptId: "breakfast", label: "Breakfast", reason: "doesntAddUp" });
    expect(next(i, ANA)).toMatchObject({ kind: "waiting", on: [{ memberId: MARK, task: { kind: "fixReceipt", reason: "doesntAddUp" } }] });
  });

  it("an equal split someone disagreed with goes to the organizer", () => {
    const disputed = receipt({ authorId: ANA, answers: [{ memberId: MARK, kind: "FINISHED", stale: false }, { memberId: ANA, kind: "NONE", stale: false }] });
    const i = input({ receipts: [disputed], rosterLocked: true });
    expect(next(i, MARK)).toEqual({ kind: "fixReceipt", receiptId: "breakfast", label: "Breakfast", reason: "disagreed" });
  });

  it("after a correction the organizer freezes by hand once everyone is done", () => {
    const i = input({ rosterLocked: true, autoFreeze: false, freezeReady: true, freezeBlockers: [] });
    expect(next(i, MARK)).toEqual({ kind: "freeze", corrected: true });
    expect(next(i, ANA)).toMatchObject({ kind: "waiting", on: [{ memberId: MARK, task: { kind: "freeze", corrected: true } }] });
  });

  it("legacy Allocating/Reviewing events: organizer freezes, no claims while Reviewing", () => {
    expect(next(input({ phase: "ALLOCATING", rosterLocked: true, freezeReady: true, freezeBlockers: [] }), MARK)).toEqual({ kind: "freeze", corrected: false });
    const reviewing = input({ phase: "REVIEWING", rosterLocked: true, receipts: [receipt({ answers: [{ memberId: MARK, kind: null, stale: false }, { memberId: ANA, kind: null, stale: false }] })] });
    expect(new NextActions(reviewing).tasksFor(ANA)).toEqual([]);
  });

  it("no receipts and everyone done: the wait names the reason instead of a person", () => {
    const i = input({ receipts: [], rosterLocked: true, freezeBlockers: ["Add at least one receipt."] });
    expect(next(i, ANA)).toEqual({ kind: "waiting", step: "claim", on: [], reasons: ["Add at least one receipt."] });
  });

  it("inactive people and cancelled events get nothing to do", () => {
    const i = input({ members: [{ id: MARK, active: true, entryComplete: true }, { id: ANA, active: false, entryComplete: false }] });
    expect(new NextActions(i).tasksFor(ANA)).toEqual([]);
    expect(next(input({ cancelled: true }), MARK)).toEqual({ kind: "cancelled" });
  });
});

describe("step 2: Pay", () => {
  const pay = (over: Partial<NextActionInput> = {}) => input({ phase: "SETTLING", rosterLocked: true, freezeBlockers: [], transfers: [transfer()], ...over });

  it("the person who owes gets “Pay Mark”; Mark waits for Ana", () => {
    expect(next(pay(), ANA)).toEqual({ kind: "pay", transferId: "t1", toId: MARK, amount: 69_850n, received: 0n });
    expect(next(pay(), MARK)).toMatchObject({ kind: "waiting", step: "pay", incoming: { transferId: "t1", fromId: ANA, amount: 69_850n } });
  });

  it("someone owed money without payment details is asked to share them", () => {
    expect(next(pay({ withPaymentDetails: [] }), MARK)).toEqual({ kind: "shareDetails" });
  });

  it("partial payment: sent ₱400 waits, never a second nudge while it's pending", () => {
    const t = transfer({ pending: 40_000n, capacity: 29_850n, pendingReports: [{ id: "r1", amount: 40_000n, version: 1 }] });
    const n = next(pay({ transfers: [t] }), ANA);
    expect(n).toMatchObject({ kind: "waiting", sent: { transferId: "t1", toId: MARK, amount: 40_000n, left: 29_850n } });
    expect(next(pay({ transfers: [t] }), MARK)).toEqual({ kind: "confirmReceived", transferId: "t1", reportId: "r1", reportVersion: 1, fromId: ANA, amount: 40_000n });
  });

  it("after Mark confirms ₱400, Ana pays the ₱298.50 left", () => {
    const t = transfer({ verified: 40_000n, capacity: 29_850n });
    expect(next(pay({ transfers: [t] }), ANA)).toEqual({ kind: "pay", transferId: "t1", toId: MARK, amount: 29_850n, received: 40_000n });
  });

  it("a dispute comes first for both people until they agree", () => {
    const open = transfer({ disputed: true, dispute: { status: "OPEN", senderChoice: null, recipientChoice: null } });
    expect(next(pay({ transfers: [open] }), ANA)).toMatchObject({ kind: "sortOut", withId: MARK, recordAgain: false });
    expect(next(pay({ transfers: [open] }), MARK)).toMatchObject({ kind: "sortOut", withId: ANA, recordAgain: false });
    const answered = transfer({ disputed: true, dispute: { status: "OPEN", senderChoice: "REPLACEMENT", recipientChoice: null } });
    expect(next(pay({ transfers: [answered] }), ANA)).toMatchObject({ kind: "waiting", on: [{ memberId: MARK, task: { kind: "sortOut" } }] });
    const agreed = transfer({ disputed: true, dispute: { status: "AWAITING_REPLACEMENT", senderChoice: "REPLACEMENT", recipientChoice: "REPLACEMENT" } });
    expect(next(pay({ transfers: [agreed] }), ANA)).toMatchObject({ kind: "sortOut", recordAgain: true });
    expect(new NextActions(pay({ transfers: [agreed] })).tasksFor(ANA).some((t) => t.kind === "pay")).toBe(false);
  });

  it("everyone paid, then closed", () => {
    const done = pay({ transfers: [transfer({ verified: 69_850n, capacity: 0n, settled: true })], doneReady: true });
    expect(next(done, ANA)).toEqual({ kind: "allPaid" });
    expect(next(done, MARK)).toEqual({ kind: "allPaid" });
    expect(next(input({ phase: "DONE" }), MARK)).toEqual({ kind: "closed" });
  });

  it("someone with nothing to do waits for the people who still do", () => {
    const three = pay({ members: [{ id: MARK, active: true, entryComplete: true }, { id: ANA, active: true, entryComplete: true }, { id: JUAN, active: true, entryComplete: true }] });
    expect(next(three, JUAN)).toMatchObject({ kind: "waiting", on: [{ memberId: ANA, task: { kind: "pay" } }] });
  });
});

describe("never an empty wait while the bill can't freeze", () => {
  // Every combination of the step-1 facts for a three-person group; whenever the
  // bill can't freeze, each person gets a task or a wait that names someone or a reason.
  const bools = [false, true];
  const cases: NextActionInput[] = [];
  for (const rosterLocked of bools)
    for (const juanDone of bools)
      for (const funded of bools)
        for (const reconciled of bools)
          for (const juanAnswered of bools)
            for (const anaStale of bools)
              for (const hasReceipt of bools) {
                const r = receipt({
                  fundingAcknowledged: funded,
                  reconciled,
                  answers: [
                    { memberId: MARK, kind: "FINISHED", stale: false },
                    { memberId: ANA, kind: "FINISHED", stale: anaStale },
                    { memberId: JUAN, kind: juanAnswered ? "FINISHED" : null, stale: false },
                  ],
                });
                const ready = rosterLocked && juanDone && funded && reconciled && juanAnswered && !anaStale && hasReceipt;
                cases.push(
                  input({
                    rosterLocked,
                    freezeReady: ready,
                    members: [
                      { id: MARK, active: true, entryComplete: true },
                      { id: ANA, active: true, entryComplete: true },
                      { id: JUAN, active: true, entryComplete: juanDone },
                    ],
                    receipts: hasReceipt ? [r] : [],
                    freezeBlockers: ready ? [] : ["gate"],
                  }),
                );
              }

  it.each(cases.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    if (c.freezeReady && c.rosterLocked && c.autoFreeze) return; // the bill freezes by itself
    for (const who of [MARK, ANA, JUAN]) {
      const n = next(c, who);
      if (n.kind === "waiting") expect(n.on.length + n.reasons.length, `${who} waits on nobody`).toBeGreaterThan(0);
    }
  });
});

describe("wire format", () => {
  it("sends centavos as decimal strings, never numbers", () => {
    const wire = toWire(next(input({ phase: "SETTLING", rosterLocked: true, transfers: [transfer()] }), ANA));
    expect(wire).toEqual({ kind: "pay", transferId: "t1", toId: MARK, amount: "69850", received: "0" });
  });
});

describe("running event payments (D64)", () => {
  const cash = (over: Partial<NonNullable<NextActionInput["cash"]>[number]> = {}) => ({ id: "c1", from: ANA, to: MARK, amount: 200_000n, paid: null, status: "REPORTED" as const, version: 1, dispute: null, ...over });

  it("the recipient confirms cash before anything else, in Add & claim and in Pay", () => {
    expect(next(input({ cash: [cash()] }), MARK)).toEqual({ kind: "confirmCash", reportId: "c1", reportVersion: 1, fromId: ANA, amount: 200_000n });
    const pay = input({ phase: "SETTLING", receipts: [], transfers: [transfer()], cash: [cash()] });
    expect(next(pay, MARK)).toMatchObject({ kind: "confirmCash" });
    // The sender just waits for the recipient, by name.
    expect(next(input({ cash: [cash()] }), ANA)).toMatchObject({ kind: "waiting", on: [{ memberId: MARK, task: { kind: "confirmCash" } }] });
  });

  it("a disagreement asks both until they pick the same answer; agreeing to re-record asks only the sender", () => {
    const open = cash({ status: "REJECTED", dispute: { id: "d1", status: "OPEN", senderChoice: null, recipientChoice: null, version: 1 } });
    expect(next(input({ cash: [open] }), ANA)).toMatchObject({ kind: "sortOutCash", disputeId: "d1", withId: MARK, recordAgain: false });
    expect(next(input({ cash: [open] }), MARK)).toMatchObject({ kind: "sortOutCash", withId: ANA });
    const agreed = cash({ status: "REJECTED", dispute: { id: "d1", status: "AWAITING_REPLACEMENT", senderChoice: "REPLACEMENT", recipientChoice: "REPLACEMENT", version: 3 } });
    expect(next(input({ cash: [agreed] }), ANA)).toMatchObject({ kind: "sortOutCash", recordAgain: true });
    expect(next(input({ cash: [agreed] }), MARK)).toEqual({ kind: "everyoneHere" });
  });
});
