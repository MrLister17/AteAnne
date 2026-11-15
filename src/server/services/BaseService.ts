import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "../db";
import { EventAggregate, MemberRecord } from "../aggregate/EventAggregate";
import { EventRepository } from "../aggregate/EventRepository";

export interface LockedContext {
  tx: Tx;
  agg: EventAggregate;
  me: MemberRecord;
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

  protected async inEvent<T>(actorId: string, eventId: string, fn: (ctx: LockedContext) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await this.repo.lock(tx, eventId);
        const agg = await this.repo.load(tx, eventId);
        const me = agg.memberForActor(actorId);
        return fn({ tx, agg, me });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  }

  protected audit(tx: Tx, eventId: string, actorMemberId: string | null, type: string, detail: Record<string, unknown> = {}) {
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
