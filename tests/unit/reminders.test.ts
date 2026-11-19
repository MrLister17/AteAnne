import { describe, expect, it } from "vitest";
import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { NextActions, toWire, type NextActionInput } from "@/domain/event/NextAction";
import { reminderMessage, remindersFor } from "@/ui/event/reminders";

type Transfer = NextActionInput["transfers"][number];

/**
 * Reminders read the server's task list (D53). These synthetic views carry
 * only the fields the reminder projection reads, with `group` built by the
 * same NextActions class the server uses.
 */
function view(phase: NextActionInput["phase"], extra: Partial<NextActionInput> = {}, cancelled = false): EventView {
  const input: NextActionInput = {
    phase,
    cancelled,
    rosterLocked: true,
    autoFreeze: true,
    freezeReady: false,
    doneReady: false,
    ownerId: "a",
    members: [
      { id: "a", active: true, entryComplete: true },
      { id: "b", active: true, entryComplete: false },
      { id: "c", active: false, entryComplete: false },
    ],
    receipts: [
      {
        id: "r",
        label: "Cafe",
        authorId: "a",
        payerId: "a",
        payable: 10_001n,
        equalSplit: false,
        fundingAcknowledged: false,
        reconciled: true,
        answers: [
          { memberId: "a", kind: "FINISHED", stale: false },
          { memberId: "b", kind: "NONE", stale: true },
        ],
      },
    ],
    transfers: [],
    withPaymentDetails: ["a"],
    freezeBlockers: [],
    ...extra,
  };
  return {
    event: { id: "event", title: "Dinner", phase, financialVersion: 4, cancelled },
    members: [
      { id: "a", displayName: "Mark", active: true },
      { id: "b", displayName: "Juan", active: true },
      { id: "c", displayName: "Inactive", active: false },
    ],
    group: { members: toWire(new NextActions(input).group()), reasons: [] },
  } as unknown as EventView;
}

const edge = (over: Partial<Transfer> = {}): Transfer => ({ id: "t", from: "b", to: "a", amount: 5_001n, verified: 0n, pending: 0n, capacity: 5_001n, settled: false, disputed: false, dispute: null, pendingReports: [], ...over });

describe("manual Messenger reminders", () => {
  it("asks only active people for their unfinished work, with exact amounts", () => {
    const rows = remindersFor(view("COLLECTING"));
    expect(rows.map((r) => r.memberId)).toEqual(["a", "b"]);
    expect(rows[0].tasks.join(" ")).toContain("PHP 100.01");
    expect(rows[1].tasks.join(" ")).toContain("even if you paid nothing");
  });

  it("asks for receipts, claims and done-adding together in Add & claim; changed answers count as unfinished", () => {
    const rows = remindersFor(view("COLLECTING"));
    expect(rows[0].tasks).toHaveLength(1); // Mark: only the payment confirmation; his claim is current
    expect(rows[1].tasks.join(" ")).toContain("or say you had nothing");
    const paid = view("ALLOCATING", {
      receipts: [{ id: "r", label: "Cafe", authorId: "a", payerId: "a", payable: 10_001n, equalSplit: false, fundingAcknowledged: true, reconciled: true, answers: [{ memberId: "a", kind: "FINISHED", stale: false }, { memberId: "b", kind: "NONE", stale: true }] }],
    });
    expect(remindersFor(paid).map((r) => r.memberId)).toEqual(["b"]);
    expect(remindersFor(paid)[0].tasks[0]).toContain("or say you had nothing");
  });

  it("never asks anyone to approve: claiming is the agreement (D50)", () => {
    const rows = remindersFor(view("REVIEWING"));
    expect(rows.flatMap((r) => r.tasks).join(" ")).not.toMatch(/approve/i);
  });

  it("does not ask a sender for another transfer while their report is pending", () => {
    const rows = remindersFor(view("SETTLING", { transfers: [edge({ pending: 1_000n, capacity: 4_001n, pendingReports: [{ id: "p", amount: 1_000n, version: 1 }] })] }));
    expect(rows.map((r) => r.memberId)).toEqual(["a"]);
    expect(rows[0].tasks[0]).toContain("confirm or reject");
  });

  it("uses exact server capacity and warns against sending money twice", () => {
    const rows = remindersFor(view("SETTLING", { transfers: [edge()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].tasks[0]).toContain("PHP 50.01 to Mark");
    expect(rows[0].tasks[0]).toContain("do not send it again");
  });

  it("directs both parties to a dispute instead of asking them to pay", () => {
    const rows = remindersFor(view("SETTLING", { transfers: [edge({ disputed: true, dispute: { status: "OPEN", senderChoice: null, recipientChoice: null } })] }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tasks[0].startsWith("Resolve the disputed payment"))).toBe(true);
  });

  it("offers nothing for cancelled or completed events", () => {
    expect(remindersFor(view("DONE"))).toEqual([]);
    expect(remindersFor(view("COLLECTING", {}, true))).toEqual([]);
  });

  it("includes a private-access event URL and manual-refresh caveat, without join/recovery credentials", () => {
    const v = view("REVIEWING");
    (v.event as { joinCode?: string }).joinCode = "SECRET";
    const message = reminderMessage(v, remindersFor(v), "https://example.test/e/event");
    expect(message).toContain("https://example.test/e/event");
    expect(message).toContain("not a payment confirmation");
    expect(message).not.toContain("SECRET");
    expect(message).not.toContain("AA-");
  });
});
