import { z } from "zod";
import { ConflictError } from "@/domain/errors";
import type { Db } from "../db";
import { GoneError, NotFoundError } from "../http/HttpError";
import { SecretGenerator } from "../security/Crypto";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { recoverSchema } from "../validation";
import { RECOVERY_TTL_MS } from "./EventService";

/**
 * Lost-device recovery. A personal recovery key re-binds the SAME stable
 * member (same ID, funding, claims, instructions, payments) to the current
 * browser, rotates the key and revokes the previous browser's access to that
 * event. Nothing financial is erased or reassigned.
 */
export class RecoveryService {
  constructor(
    private readonly db: Db,
    private readonly limiter: RateLimiter,
    private readonly secrets = new SecretGenerator(),
  ) {}

  async redeem(actorId: string, input: z.input<typeof recoverSchema>, ipHash: string): Promise<{ eventId: string; memberId: string; recoveryKey: string }> {
    const { key } = recoverSchema.parse(input);
    await this.limiter.check(RATE_RULES.recoveryPerIp, ipHash);
    const hash = this.secrets.sha256(key.trim());
    return this.db.$transaction(async (tx) => {
      // Lock the member row: two simultaneous redemptions cannot both win.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Member" WHERE "recoveryHash" = ${hash} FOR UPDATE`;
      if (rows.length === 0) {
        await this.limiter.hit(RATE_RULES.recoveryPerIp, ipHash);
        throw new NotFoundError("That recovery key is not valid");
      }
      const member = await tx.member.findUniqueOrThrow({ where: { id: rows[0].id } });
      if (!member.active) throw new GoneError("member_inactive", "This membership was deactivated");
      if (member.recoveryExpiresAt.getTime() <= Date.now()) throw new GoneError("recovery_expired", "This recovery key has expired");
      const other = await tx.member.findFirst({ where: { eventId: member.eventId, actorId, NOT: { id: member.id } } });
      if (other) {
        throw new ConflictError("browser_has_other_member", `This browser is already "${other.displayName}" in that event. Use a different browser profile; identities are never merged.`);
      }
      const recoveryKey = `AA-${this.secrets.token()}`;
      await tx.member.update({
        where: { id: member.id },
        data: { actorId, recoveryHash: this.secrets.sha256(recoveryKey), recoveryExpiresAt: new Date(Date.now() + RECOVERY_TTL_MS) },
      });
      await tx.auditEvent.create({ data: { eventId: member.eventId, actorMemberId: member.id, type: "member.recovered", detail: { sameActor: member.actorId === actorId } } });
      return { eventId: member.eventId, memberId: member.id, recoveryKey };
    });
  }

  /** Rotate my own key (e.g. if I think it leaked). */
  async rotate(actorId: string, eventId: string): Promise<{ recoveryKey: string }> {
    const member = await this.db.member.findFirst({ where: { eventId, actorId, active: true } });
    if (!member) throw new NotFoundError("Event not found");
    const recoveryKey = `AA-${this.secrets.token()}`;
    await this.db.member.update({ where: { id: member.id }, data: { recoveryHash: this.secrets.sha256(recoveryKey), recoveryExpiresAt: new Date(Date.now() + RECOVERY_TTL_MS) } });
    await this.db.auditEvent.create({ data: { eventId, actorMemberId: member.id, type: "member.recovery_rotated" } });
    return { recoveryKey };
  }
}
