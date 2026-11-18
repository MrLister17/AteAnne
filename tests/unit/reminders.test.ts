import { describe, expect, it } from "vitest";
import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { reminderMessage, remindersFor } from "@/ui/event/reminders";

// Only fields read by the message projection are needed in these synthetic views.
function view(phase: string, extra: Record<string, unknown> = {}): EventView {
  return {
    event: { id: "event", title: "Dinner", phase, financialVersion: 4, cancelled: false },
    members: [
      { id: "a", displayName: "Mark", active: true, entryComplete: true },
      { id: "b", displayName: "Juan", active: true, entryComplete: false },
      { id: "c", displayName: "Inactive", active: false, entryComplete: false },
    ],
    receipts: [{ id: "r", label: "Cafe", payerId: "a", payable: "10001", fundingAcknowledged: false, acks: [{ memberId: "a", kind: "CLAIMED", stale: false }, { memberId: "b", kind: "NOTHING", stale: true }] }],
    review: { approvals: ["a"] },
    settlement: null,
    instructions: {},
    ...extra,
  } as unknown as EventView;
}

const edge = (overrides: Record<string, unknown> = {}) => ({ from: "b", to: "a", settled: false, disputed: false, capacity: "5001", pending: "0", reports: [], ...overrides });

describe("manual Messenger reminders", () => {
  it("asks only active people for their unfinished receipt entry/funding work", () => {
    const rows = remindersFor(view("COLLECTING"));
    expect(rows.map((r) => r.memberId)).toEqual(["a", "b"]);
    expect(rows[0].tasks.join(" ")).toContain("PHP 100.01");
    expect(rows[1].tasks.join(" ")).toContain("even if you paid nothing");
  });

  it("treats stale receipt answers as unfinished", () => {
    expect(remindersFor(view("ALLOCATING")).map((r) => r.memberId)).toEqual(["b"]);
    expect(remindersFor(view("ALLOCATING"))[0].tasks[0]).toContain("or say you had nothing");
  });

  it("asks for the current financial version only when approval is missing", () => {
    const rows = remindersFor(view("REVIEWING"));
    expect(rows.map((r) => r.memberId)).toEqual(["b"]);
    expect(rows[0].tasks[0]).toContain("version 4");
  });

  it("does not ask a sender for another transfer while their report is pending", () => {
    const rows = remindersFor(view("SETTLING", { settlement: { edges: [edge({ pending: "1000", capacity: "4001", reports: [{ status: "REPORTED" }] })] }, instructions: { a: {} } }));
    expect(rows.map((r) => r.memberId)).toEqual(["a"]);
    expect(rows[0].tasks[0]).toContain("confirm or reject");
  });

  it("uses exact server capacity and warns against sending money twice", () => {
    const rows = remindersFor(view("SETTLING", { settlement: { edges: [edge()] }, instructions: { a: {} } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].tasks[0]).toContain("PHP 50.01 to Mark");
    expect(rows[0].tasks[0]).toContain("do not send it again");
  });

  it("directs both parties to a dispute instead of asking them to pay", () => {
    const rows = remindersFor(view("SETTLING", { settlement: { edges: [edge({ disputed: true })] }, instructions: { a: {} } }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tasks[0].startsWith("Resolve the disputed payment"))).toBe(true);
  });

  it("offers nothing for cancelled or completed events", () => {
    expect(remindersFor(view("DONE"))).toEqual([]);
    const cancelled = view("COLLECTING");
    cancelled.event.cancelled = true;
    expect(remindersFor(cancelled)).toEqual([]);
  });

  it("includes a private-access event URL and manual-refresh caveat, without join/recovery credentials", () => {
    const v = view("REVIEWING");
    v.event.joinCode = "SECRET";
    const message = reminderMessage(v, remindersFor(v), "https://example.test/e/event");
    expect(message).toContain("https://example.test/e/event");
    expect(message).toContain("not a payment confirmation");
    expect(message).not.toContain("SECRET");
    expect(message).not.toContain("AA-");
  });
});
