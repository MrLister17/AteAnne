import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "../db";
import { EventAggregate, MemberRecord } from "../aggregate/EventAggregate";
import { EventRepository } from "../aggregate/EventRepository";

export interface LockedContext {
  tx: Tx;
  agg: EventAggregate;
  /** Whose identity the action is for: the caller, or a guest the caller manages. */
  me: MemberRecord;
  /** The signed-in person who actually made the request. */
  by: MemberRecord;
}

/**
 * Who is calling. A bare actor ID acts as yourself; `asMemberId` asks to act
 * for a guest (someone added without a phone). Only routes that opt in pass
 * the object form, so nothing else can ever be done "as" someone.
 */
export type Caller = string | { actorId: string; asMemberId?: string };

export function callerParts(caller: Caller): { actorId: string; asMemberId?: string } {
  return typeof caller === "string" ? { actorId: caller } : caller;
}

/**
 * Shared plumbing for event-scoped application services: a transaction that
 * locks the event row first (consistent lock order: event → children), loads
 * the aggregate, resolves the caller's membership and writes audit entries.
 */
export abstract class BaseService {
  constructor(
    protected readonly db: Db,
    protected readonly repo = new EventRepository(),
  ) {}

  /** Per-transaction "acting for a guest" record, so audit entries carry both names. */
  private readonly acting = new WeakMap<object, { by: string; subject: string }>();

  protected async inEvent<T>(caller: Caller, eventId: string, fn: (ctx: LockedContext) => Promise<T>): Promise<T> {
    const { actorId, asMemberId } = callerParts(caller);
    return this.db.$transaction(
      async (tx) => {
        await this.repo.lock(tx, eventId);
        const agg = await this.repo.load(tx, eventId);
        const by = agg.memberForActor(actorId);
        const me = agg.subjectFor(by, asMemberId);
        if (me.id !== by.id) this.acting.set(tx, { by: by.id, subject: me.id });
        return fn({ tx, agg, me, by });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  }

  /**
   * Append an audit entry. When the caller is acting for a guest, the entry
   * records the real person as the actor and the guest as `onBehalfOf`.
   */
  protected audit(tx: Tx, eventId: string, actorMemberId: string | null, type: string, detail: Record<string, unknown> = {}) {
    const acting = this.acting.get(tx);
    if (acting && actorMemberId === acting.subject) {
      actorMemberId = acting.by;
      detail = { ...detail, onBehalfOf: acting.subject };
    }
    return tx.auditEvent.create({ data: { eventId, actorMemberId, type, detail: detail as Prisma.InputJsonValue } });
  }

  /** Any change that affects money invalidates every review approval. */
  protected bumpFinancial(tx: Tx, eventId: string, structural = false) {
    return tx.event.update({
      where: { id: eventId },
      data: { financialVersion: { increment: 1 }, ...(structural ? { structuralVersion: { increment: 1 } } : {}) },
    });
  }
}
