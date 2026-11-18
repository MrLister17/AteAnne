import type { Prisma } from "@/generated/prisma/client";
import { AutoAdvance } from "@/domain/event/AutoAdvance";
import type { Phase } from "@/domain/event/PhaseMachine";
import { ConflictError } from "@/domain/errors";
import { SettlementPlanner } from "@/domain/settlement/SettlementPlanner";
import type { Db, Tx } from "../db";
import { EventAggregate, MemberRecord, POLICY_VERSION } from "../aggregate/EventAggregate";
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

  /** Any change that affects money gets a new financial version. */
  protected bumpFinancial(tx: Tx, eventId: string, structural = false) {
    return tx.event.update({
      where: { id: eventId },
      data: { financialVersion: { increment: 1 }, ...(structural ? { structuralVersion: { increment: 1 } } : {}) },
    });
  }

  /**
   * Call at the end of any action that can finish "Add & claim" (D49). Reloads
   * the event inside the same locked transaction and, when AutoAdvance says
   * so, freezes the bill. Credited to the app ("System"), not to whoever
   * happened to finish last. Returns the resulting phase.
   */
  protected async advanceIfReady(tx: Tx, eventId: string): Promise<Phase> {
    const agg = await this.repo.load(tx, eventId);
    const open = agg.phase === "COLLECTING" || agg.phase === "ALLOCATING" || agg.phase === "REVIEWING";
    const target = AutoAdvance.next({
      phase: agg.phase,
      cancelled: agg.record.cancelled,
      rosterLocked: Boolean(agg.record.rosterLockedAt),
      hasStatement: agg.record.snapshots.length > 0,
      freezeReady: open && agg.freezeGate().ready,
    });
    if (target !== "SETTLING") return agg.phase;
    await this.freeze(tx, agg, null);
    await tx.event.update({ where: { id: eventId }, data: { phase: target } });
    await this.audit(tx, eventId, null, "phase.changed", { from: agg.phase, to: target, auto: true });
    return target;
  }

  /** Recompute from the database, check the freeze gate and write the immutable snapshot. */
  protected async freeze(tx: Tx, agg: EventAggregate, actorMemberId: string | null): Promise<void> {
    const gate = agg.freezeGate();
    if (!gate.ready) throw new ConflictError("gate_blocked", "Not everyone is done yet", { blockers: gate.blockers });
    const calc = agg.calculation();
    if (!calc.ok) throw new ConflictError("calculation_failed", "The split cannot be calculated");
    const remaining = agg.remainingNets(calc.positions.map((p) => [p.memberId, p.net] as const));
    const edges = new SettlementPlanner().plan([...remaining]);
    const facts = {
      carriedPayments: agg.confirmedTransfers().map((p) => ({ from: p.from, to: p.to, amount: p.amount.toString() })),
      receipts: agg.record.receipts.map((r) => {
        const st = calc.receipts.find((s) => s.receiptId === r.id)!;
        return {
          id: r.id,
          label: r.label,
          payerId: r.payerMemberId,
          version: r.version,
          payable: r.payableCentavos.toString(),
          equalSplit: r.equalSplit,
          lines: r.lines.map((l) => ({ id: l.id, label: l.label, quantity: l.quantity, amount: l.amountCentavos.toString(), mode: l.mode })),
          adjustments: r.adjustments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, amount: a.amountCentavos.toString(), scopeAll: a.scopeAll, eligibleLineIds: a.eligibleLineIds })),
          shares: [...st.shares.values()]
            .filter((s) => s.total > 0n || s.itemsGross > 0n)
            .map((s) => ({
              memberId: s.memberId,
              lines: Object.fromEntries([...s.lineShares].map(([k, v]) => [k, v.toString()])),
              discounts: Object.fromEntries([...s.discountShares].map(([k, v]) => [k, v.toString()])),
              charges: Object.fromEntries([...s.chargeShares].map(([k, v]) => [k, v.toString()])),
              itemsGross: s.itemsGross.toString(),
              discountTotal: s.discountTotal.toString(),
              chargeTotal: s.chargeTotal.toString(),
              total: s.total.toString(),
            })),
        };
      }),
      members: agg.record.members.map((m) => ({ id: m.id, seq: m.seq, displayName: m.displayName })),
    };
    await tx.snapshot.create({
      data: {
        eventId: agg.id,
        financialVersion: agg.record.financialVersion,
        policyVersion: POLICY_VERSION,
        facts,
        shares: { create: calc.positions.map((p) => ({ memberId: p.memberId, fundingCentavos: p.funding, costCentavos: p.cost, netCentavos: p.net })) },
        edges: { create: edges.map((e, i) => ({ position: i, fromMemberId: e.from, toMemberId: e.to, amountCentavos: e.amount })) },
      },
    });
    await this.audit(tx, agg.id, actorMemberId, "snapshot.frozen", { financialVersion: agg.record.financialVersion, edges: edges.length, auto: actorMemberId === null });
  }
}
