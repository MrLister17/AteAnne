import { describe, expect, it } from "vitest";
import { GuestPolicy, type RosterMember } from "@/domain/event/GuestPolicy";

const m = (id: string, patch: Partial<RosterMember> = {}): RosterMember => ({ id, active: true, managed: false, isAdmin: false, ...patch });
const owner = m("owner");
const admin = m("admin", { isAdmin: true });
const friend = m("friend");
const guest = m("guest", { managed: true });
const policy = new GuestPolicy("owner");

describe("GuestPolicy", () => {
  it("only the organizer and admins manage guests", () => {
    expect(policy.canManageGuests(owner)).toBe(true);
    expect(policy.canManageGuests(admin)).toBe(true);
    expect(policy.canManageGuests(friend)).toBe(false);
    expect(policy.canManageGuests(m("x", { isAdmin: true, active: false }))).toBe(false);
  });

  it("managers can act only for guests", () => {
    expect(() => policy.assertCanActFor(owner, guest)).not.toThrow();
    expect(() => policy.assertCanActFor(admin, guest)).not.toThrow();
    expect(() => policy.assertCanActFor(owner, friend)).toThrow(/without a phone/);
    expect(() => policy.assertCanActFor(friend, guest)).toThrow(/organizer or an admin/);
    expect(() => policy.assertCanActFor(owner, m("g2", { managed: true, active: false }))).toThrow(/no longer/);
    expect(() => policy.assertCanActFor(friend, friend)).not.toThrow();
  });

  it("a manager can't answer for a guest when they are the other side of the money", () => {
    expect(() => policy.assertNoConflict(admin, guest, "admin")).toThrow(/other person/);
    expect(() => policy.assertNoConflict(admin, guest, "friend")).not.toThrow();
    expect(() => policy.assertNoConflict(friend, friend, "friend")).not.toThrow(); // acting as yourself is not "for" anyone
  });

  it("only the organizer appoints admins, never a guest or themselves", () => {
    expect(() => policy.assertCanSetAdmin(owner, friend)).not.toThrow();
    expect(() => policy.assertCanSetAdmin(admin, friend)).toThrow(/Only the organizer/);
    expect(() => policy.assertCanSetAdmin(owner, guest)).toThrow(/without a phone/);
    expect(() => policy.assertCanSetAdmin(owner, owner)).toThrow(/already/);
  });
});
