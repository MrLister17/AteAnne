import { ConflictError, PermissionError } from "../errors";
import type { RosterMember } from "./GuestPolicy";

/** Trusted-circle recovery: only the organizer may hand a replacement key to a member. */
export class RecoveryPolicy {
  constructor(private readonly ownerId: string | null) {}

  assertCanReissue(by: RosterMember, target: RosterMember): void {
    if (!by.active || by.managed || by.id !== this.ownerId) {
      throw new PermissionError("owner_only", "Only the organizer can reissue access for someone who lost their key");
    }
    if (target.id === by.id) throw new ConflictError("use_own_recovery", "Use New recovery key for your own access");
    if (!target.active) throw new ConflictError("member_inactive", "That person is no longer on the roster");
    if (target.managed) throw new ConflictError("guest_access_required", "Use Give them access for someone without a phone");
  }
}
