import { PermissionError } from "../errors";

/** The few member facts the guest rules need (no ORM types in the domain). */
export interface RosterMember {
  id: string;
  active: boolean;
  /** No phone of their own; the organizer or an admin acts for them. */
  managed: boolean;
  isAdmin: boolean;
}

/**
 * Who may act for whom.
 *
 * Some people at the table have no phone, no data, or aren't comfortable with
 * apps. They are added as *guests*. A guest's claims, approval and payment
 * confirmations are made by a *manager* (the organizer or an admin the
 * organizer appointed) while the guest is shown the screen, and every such
 * action is audited with both names.
 *
 * Acting for someone is only ever allowed for a guest. A manager can never
 * act for a person who has their own phone, so nobody with the app can have
 * their claims or confirmations made for them.
 */
export class GuestPolicy {
  constructor(private readonly ownerId: string | null) {}

  isOwner(m: RosterMember): boolean {
    return m.id === this.ownerId;
  }

  /** The organizer, or an admin with their own phone. */
  canManageGuests(m: RosterMember): boolean {
    return m.active && !m.managed && (this.isOwner(m) || m.isAdmin);
  }

  assertCanManageGuests(m: RosterMember): void {
    if (!this.canManageGuests(m)) throw new PermissionError("not_manager", "Only the organizer or an admin can manage people without a phone");
  }

  /** `by` acts as `subject`. Acting as yourself is always fine. */
  assertCanActFor(by: RosterMember, subject: RosterMember): void {
    if (by.id === subject.id) return;
    this.assertCanManageGuests(by);
    if (!subject.managed) throw new PermissionError("not_guest", "You can only act for people who were added without a phone");
    if (!subject.active) throw new PermissionError("member_inactive", "That person is no longer on the roster");
  }

  /**
   * A manager acting for a guest must never decide something where they are
   * the other side of the money: e.g. confirm, as the guest, that they
   * themselves paid the guest. Another manager (or the guest with their own
   * phone) has to do it. This keeps "only the receiver confirms" meaningful.
   */
  assertNoConflict(by: RosterMember, subject: RosterMember, counterpartyId: string): void {
    if (by.id !== subject.id && counterpartyId === by.id) {
      throw new PermissionError("conflict_of_interest", "You’re the other person in this payment, so ask another admin to answer it for them, or make someone an admin in People");
    }
  }

  /** Only the organizer appoints admins, and only people with their own phone. */
  assertCanSetAdmin(by: RosterMember, target: RosterMember): void {
    if (!this.isOwner(by)) throw new PermissionError("owner_only", "Only the organizer can make someone an admin");
    if (this.isOwner(target)) throw new PermissionError("owner_is_admin", "The organizer already has every admin power");
    if (target.managed) throw new PermissionError("guest_not_admin", "A person without a phone can’t be an admin");
    if (!target.active) throw new PermissionError("member_inactive", "That person is no longer on the roster");
  }
}
