import { z } from "zod";
import { ConflictError } from "@/domain/errors";
import { RecoveryPolicy } from "@/domain/event/RecoveryPolicy";
import type { Db } from "../db";
import { GoneError, NotFoundError } from "../http/HttpError";
import { SecretGenerator } from "../security/Crypto";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { recoverSchema } from "../validation";
import { RECOVERY_TTL_MS } from "./EventService";
import type { ActorSource } from "./EventService";
import { BaseService } from "./BaseService";

export const ASSISTED_RECOVERY_TTL_MS = 15 * 60 * 1000;
export const reissueRecoverySchema = z.object({ identityConfirmed: z.literal(true) }).strict();

/**
 * Lost-device recovery. A personal recovery key re-binds the SAME stable
 * member (same ID, funding, claims, instructions, payments) to the current
 * browser, rotates the key and revokes the previous browser's access to that
 * event. Nothing financial is erased or reassigned. The same path lets a
 * guest (added without a phone) take over their own identity from a key a
 * manager handed them.
 */
export class RecoveryService extends BaseService {
  constructor(
    db: Db,
    private readonly limiter: RateLimiter,
    private readonly secrets = new SecretGenerator(),
  ) {
    super(db);
  }

  /**
   * Organizer checks the person in front of them, then hands over a short-lived
   * single-use key. The existing phone stays bound until that key is redeemed.
   * No manager may act as the member, and no financial identity is recreated.
   */
  async reissue(actorId: string, eventId: string, memberId: string, input: z.input<typeof reissueRecoverySchema>): Promise<{ recoveryKey: string; expiresAt: string }> {
    reissueRecoverySchema.parse(input);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      const target = agg.member(memberId);
      new RecoveryPolicy(agg.record.ownerMemberId).assertCanReissue(me, target);
      const recoveryKey = `AA-${this.secrets.token()}`;
      const expiresAt = new Date(Date.now() + ASSISTED_RECOVERY_TTL_MS);
      await tx.member.update({ where: { id: target.id }, data: { recoveryHash: this.secrets.sha256(recoveryKey), recoveryExpiresAt: expiresAt } });
      await this.audit(tx, eventId, me.id, "member.access_reissued", { memberId: target.id, displayName: target.displayName, identityConfirmed: true, expiresAt: expiresAt.toISOString() });
      return { recoveryKey, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * `actor` may create a browser identity lazily: it runs only after the IP
   * check passes and the key exists, so wrong keys never create rows (D57).
   */
  async redeem(actor: ActorSource, input: z.input<typeof recoverSchema>, ipHash: string): Promise<{ eventId: string; memberId: string; recoveryKey: string }> {
    const { key } = recoverSchema.parse(input);
    await this.limiter.check(RATE_RULES.recoveryPerIp, ipHash);
    const hash = this.secrets.sha256(key);
    // A cheap look before any identity is created; re-checked under the event lock below.
    if (!(await this.db.member.findUnique({ where: { recoveryHash: hash }, select: { id: true } }))) {
      await this.limiter.hit(RATE_RULES.recoveryPerIp, ipHash);
      throw new NotFoundError("That recovery key is not valid");
    }
    const actorId = typeof actor === "string" ? actor : await actor();
    return this.db.$transaction(async (tx) => {
      // Find the event, then follow the same event → children lock order as all
      // member/financial writes. Re-read the hash after the lock: another
      // redemption or organizer reissue may already have consumed this key.
      const candidate = await tx.member.findUnique({ where: { recoveryHash: hash }, select: { eventId: true } });
      if (!candidate) {
        await this.limiter.hit(RATE_RULES.recoveryPerIp, ipHash);
        throw new NotFoundError("That recovery key is not valid");
      }
      await this.repo.lock(tx, candidate.eventId);
      const member = await tx.member.findUnique({ where: { recoveryHash: hash } });
      if (!member) throw new NotFoundError("That recovery key is not valid");
      if (!member.active) throw new GoneError("member_inactive", "This membership was deactivated");
      if (member.recoveryExpiresAt.getTime() <= Date.now()) throw new GoneError("recovery_expired", "This recovery key has expired");
      const other = await tx.member.findFirst({ where: { eventId: member.eventId, actorId, NOT: { id: member.id } } });
      if (other) {
        throw new ConflictError("browser_has_other_member", `This browser is already "${other.displayName}" in that event. Use a different browser profile; identities are never merged.`);
      }
      const recoveryKey = `AA-${this.secrets.token()}`;
      await tx.member.update({
        where: { id: member.id },
        // A guest who redeems the key a manager handed them now has their own phone.
        data: { actorId, managed: false, recoveryHash: this.secrets.sha256(recoveryKey), recoveryExpiresAt: new Date(Date.now() + RECOVERY_TTL_MS) },
      });
      await tx.auditEvent.create({
        data: { eventId: member.eventId, actorMemberId: member.id, type: member.managed ? "member.guest_took_over" : "member.recovered", detail: { sameActor: member.actorId === actorId } },
      });
      return { eventId: member.eventId, memberId: member.id, recoveryKey };
    });
  }

  /** Rotate my own key (e.g. if I think it leaked). */
  async rotate(actorId: string, eventId: string): Promise<{ recoveryKey: string }> {
    return this.inEvent(actorId, eventId, async ({ tx, me }) => {
      const recoveryKey = `AA-${this.secrets.token()}`;
      await tx.member.update({ where: { id: me.id }, data: { recoveryHash: this.secrets.sha256(recoveryKey), recoveryExpiresAt: new Date(Date.now() + RECOVERY_TTL_MS) } });
      await this.audit(tx, eventId, me.id, "member.recovery_rotated");
      return { recoveryKey };
    });
  }
}
