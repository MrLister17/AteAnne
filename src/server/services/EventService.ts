import { z } from "zod";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import type { Phase } from "@/domain/event/PhaseMachine";
import type { Db, Tx } from "../db";
import { GoneError, NotFoundError } from "../http/HttpError";
import { JoinCodeCodec, SecretGenerator } from "../security/Crypto";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { MAX_MEMBERS, POLICY_VERSION } from "../aggregate/EventAggregate";
import { addGuestSchema, createEventSchema, joinSchema, setAdminSchema, transitionSchema, updateMeSchema } from "../validation";
import { BaseService, Caller } from "./BaseService";

export const JOIN_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface Credentials {
  eventId: string;
  memberId: string;
  /** Shown once. Only its hash is stored. */
  recoveryKey: string;
}

/**
 * Event lifecycle: creation, joining by code, roster, phase transitions,
 * freezing the settlement snapshot, cancellation and completion.
 */
export class EventService extends BaseService {
  constructor(
    db: Db,
    private readonly codes: JoinCodeCodec,
    private readonly limiter: RateLimiter,
    private readonly secrets = new SecretGenerator(),
  ) {
    super(db);
  }

  newRecoveryKey(): { key: string; hash: string; expiresAt: Date } {
    const key = `AA-${this.secrets.token()}`;
    return { key, hash: this.secrets.sha256(key), expiresAt: new Date(Date.now() + RECOVERY_TTL_MS) };
  }

  private newJoinCode() {
    const code = this.codes.generate();
    return {
      code,
      data: { joinCodeHash: this.codes.hash(code), joinCodeCiphertext: this.codes.encrypt(code), joinCodeExpiresAt: new Date(Date.now() + JOIN_CODE_TTL_MS) },
    };
  }

  async create(actorId: string, input: z.input<typeof createEventSchema>): Promise<Credentials & { joinCode: string }> {
    const data = createEventSchema.parse(input);
    const recovery = this.newRecoveryKey();
    const join = this.newJoinCode();
    return this.db.$transaction(async (tx) => {
      const event = await tx.event.create({ data: { title: data.title, note: data.note, nextMemberSeq: 2, ...join.data } });
      const member = await tx.member.create({
        data: { eventId: event.id, seq: 1, actorId, displayName: data.displayName, intent: data.intent, recoveryHash: recovery.hash, recoveryExpiresAt: recovery.expiresAt },
      });
      await tx.event.update({ where: { id: event.id }, data: { ownerMemberId: member.id } });
      await this.audit(tx, event.id, member.id, "event.created", { title: data.title });
      return { eventId: event.id, memberId: member.id, recoveryKey: recovery.key, joinCode: join.code };
    });
  }

  /** Exchange a join code for membership. Returns null recoveryKey if already a member. */
  async join(actorId: string, input: z.input<typeof joinSchema>, ipHash: string): Promise<Omit<Credentials, "recoveryKey"> & { recoveryKey: string | null }> {
    const data = joinSchema.parse(input);
    await this.limiter.check(RATE_RULES.failedCodePerIp, ipHash);
    const normalized = this.codes.normalize(data.code);
    const event = normalized ? await this.db.event.findUnique({ where: { joinCodeHash: this.codes.hash(normalized) } }) : null;
    if (!event) {
      await this.limiter.hit(RATE_RULES.failedCodePerIp, ipHash);
      throw new NotFoundError("That code does not match an open event. Check it with the organizer.");
    }
    if (!event.joinCodeExpiresAt || event.joinCodeExpiresAt.getTime() <= Date.now()) {
      throw new GoneError("code_expired", "This join code has expired. Ask the organizer for a new one.");
    }
    await this.limiter.hit(RATE_RULES.joinsPerEvent, event.id);

    return this.db.$transaction(async (tx) => {
      await this.repo.lock(tx, event.id);
      const fresh = await tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { members: true } });
      const existing = fresh.members.find((m) => m.actorId === actorId);
      if (existing) {
        if (!existing.active) throw new PermissionError("member_inactive", "Your access to this event was deactivated");
        return { eventId: fresh.id, memberId: existing.id, recoveryKey: null };
      }
      if (fresh.phase !== "COLLECTING" || !fresh.joinCodeHash || fresh.cancelled) {
        throw new GoneError("joins_closed", "This event's roster is locked; new people cannot join.");
      }
      if (fresh.members.filter((m) => m.active).length >= MAX_MEMBERS) {
        throw new ConflictError("event_full", `This event already has ${MAX_MEMBERS} people`);
      }
      const recovery = this.newRecoveryKey();
      const member = await tx.member.create({
        data: { eventId: fresh.id, seq: fresh.nextMemberSeq, actorId, displayName: data.displayName, intent: data.intent, recoveryHash: recovery.hash, recoveryExpiresAt: recovery.expiresAt },
      });
      await tx.event.update({ where: { id: fresh.id }, data: { nextMemberSeq: { increment: 1 } } });
      await this.bumpFinancial(tx, fresh.id, true);
      await this.audit(tx, fresh.id, member.id, "member.joined", { displayName: data.displayName });
      return { eventId: fresh.id, memberId: member.id, recoveryKey: recovery.key };
    });
  }

  async rotateCode(actorId: string, eventId: string): Promise<{ joinCode: string }> {
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      agg.machine.assertIn("COLLECTING");
      agg.assertNotCancelled();
      const join = this.newJoinCode();
      await tx.event.update({ where: { id: eventId }, data: join.data });
      await this.audit(tx, eventId, me.id, "code.rotated");
      return { joinCode: join.code };
    });
  }

  async closeJoins(actorId: string, eventId: string): Promise<void> {
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      await tx.event.update({ where: { id: eventId }, data: { joinCodeHash: null, joinCodeCiphertext: null, joinCodeExpiresAt: null } });
      await this.audit(tx, eventId, me.id, "code.closed");
    });
  }

  /** Update my own (or, for a manager acting for a guest, the guest's) name, intent or entry status. */
  async updateMe(caller: Caller, eventId: string, input: z.input<typeof updateMeSchema>): Promise<void> {
    const data = updateMeSchema.parse(input);
    await this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      if (data.entryComplete !== undefined) {
        agg.machine.assertIn("COLLECTING");
        agg.assertNotCancelled();
      }
      await tx.member.update({ where: { id: me.id }, data });
      if (data.entryComplete !== undefined && data.entryComplete !== me.entryComplete) {
        await this.audit(tx, eventId, me.id, data.entryComplete ? "entry.completed" : "entry.reopened");
      }
      if (data.displayName !== undefined && data.displayName !== me.displayName) {
        await this.audit(tx, eventId, me.id, "member.renamed", { from: me.displayName, to: data.displayName });
      }
    });
  }

  /**
   * Add a guest: a person at the table without a phone (or who'd rather not
   * use one). They get a normal stable member identity with no browser; the
   * organizer or an admin acts for them. Only while collecting, like joining.
   */
  async addGuest(actorId: string, eventId: string, input: z.input<typeof addGuestSchema>): Promise<{ memberId: string }> {
    const data = addGuestSchema.parse(input);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.guests.assertCanManageGuests(me);
      agg.machine.assertIn("COLLECTING");
      agg.assertNotCancelled();
      if (agg.activeMembers().length >= MAX_MEMBERS) throw new ConflictError("event_full", `This event already has ${MAX_MEMBERS} people`);
      // The recovery hash is required and unique; a random one nobody knows means "no key yet".
      // A real key is only created when a manager hands the guest their own access.
      const placeholder = this.newRecoveryKey();
      const member = await tx.member.create({
        data: {
          eventId,
          seq: agg.record.nextMemberSeq,
          actorId: null,
          managed: true,
          displayName: data.displayName,
          intent: data.intent,
          // Managers usually add guests after the receipts are known; the payer
          // confirmation still gates anything a guest paid for.
          entryComplete: true,
          recoveryHash: placeholder.hash,
          recoveryExpiresAt: placeholder.expiresAt,
        },
      });
      await tx.event.update({ where: { id: eventId }, data: { nextMemberSeq: { increment: 1 } } });
      await this.bumpFinancial(tx, eventId, true);
      await this.audit(tx, eventId, me.id, "member.guest_added", { memberId: member.id, displayName: data.displayName });
      return { memberId: member.id };
    });
  }

  /** Organizer appoints or removes an admin (someone who can manage guests). */
  async setAdmin(actorId: string, eventId: string, memberId: string, input: z.input<typeof setAdminSchema>): Promise<void> {
    const { isAdmin } = setAdminSchema.parse(input);
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      const target = agg.member(memberId);
      agg.guests.assertCanSetAdmin(me, target);
      if (target.isAdmin === isAdmin) return;
      await tx.member.update({ where: { id: target.id }, data: { isAdmin } });
      await this.audit(tx, eventId, me.id, isAdmin ? "member.admin_added" : "member.admin_removed", { memberId: target.id, displayName: target.displayName });
    });
  }

  /**
   * Give a guest their own access: a one-time recovery key the guest opens on
   * their own phone (Home → "I have a recovery key"). Redeeming it turns the
   * guest into a normal member with the same receipts, claims and payments.
   * Making a new key invalidates any earlier one.
   */
  async guestAccessKey(actorId: string, eventId: string, memberId: string): Promise<{ recoveryKey: string }> {
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.guests.assertCanManageGuests(me);
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      const target = agg.member(memberId);
      if (!target.managed || !target.active) throw new ConflictError("not_guest", `${target.displayName} already uses their own phone`);
      const key = this.newRecoveryKey();
      await tx.member.update({ where: { id: target.id }, data: { recoveryHash: key.hash, recoveryExpiresAt: key.expiresAt } });
      await this.audit(tx, eventId, me.id, "member.guest_key_issued", { memberId: target.id, displayName: target.displayName });
      return { recoveryKey: key.key };
    });
  }

  /**
   * Owner removes an unreferenced roster entry (e.g. a duplicate browser) while
   * collecting. Admins may remove guests (e.g. one added by mistake).
   */
  async removeMember(actorId: string, eventId: string, memberId: string): Promise<void> {
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      const target = agg.member(memberId);
      if (!agg.isOwner(me.id)) {
        agg.guests.assertCanManageGuests(me);
        if (!target.managed) throw new PermissionError("owner_only", "Only the organizer can remove someone who uses their own phone");
      }
      agg.machine.assertIn("COLLECTING");
      if (agg.isOwner(target.id)) throw new ConflictError("cannot_remove_owner", "The organizer cannot be removed");
      if (agg.memberReferenced(target.id)) {
        throw new ConflictError("member_referenced", `${target.displayName} is referenced by receipts or claims and cannot be removed. Edit those first.`);
      }
      await tx.receiptAck.deleteMany({ where: { memberId: target.id } });
      await tx.reviewApproval.deleteMany({ where: { memberId: target.id } });
      await tx.member.delete({ where: { id: target.id } });
      await this.bumpFinancial(tx, eventId, true);
      await this.audit(tx, eventId, me.id, "member.removed", { displayName: target.displayName });
    });
  }

  async transition(actorId: string, eventId: string, input: z.input<typeof transitionSchema>): Promise<{ phase: Phase }> {
    const { target, expectedFinancialVersion } = transitionSchema.parse(input);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (agg.record.financialVersion !== expectedFinancialVersion) {
        throw new ConflictError("stale_version", "The event changed while you were looking. Refresh and check again.");
      }
      agg.machine.assertCanMoveTo(target);
      const from = agg.phase;
      const forward = ["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING", "DONE"].indexOf(target) > ["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING", "DONE"].indexOf(from);
      if (forward && target !== "DONE") agg.assertNotCancelled();

      if (target === "ALLOCATING" && from === "COLLECTING") {
        const gate = agg.allocationGate();
        if (!gate.ready) throw new ConflictError("gate_blocked", "Not ready to start allocating", { blockers: gate.blockers });
        // Lock the explicit roster: joins close for good at this point.
        await tx.event.update({ where: { id: eventId }, data: { rosterLockedAt: new Date(), joinCodeHash: null, joinCodeCiphertext: null, joinCodeExpiresAt: null } });
      } else if (target === "REVIEWING" && from === "ALLOCATING") {
        const gate = agg.reviewGate();
        if (!gate.ready) throw new ConflictError("gate_blocked", "Not ready for review", { blockers: gate.blockers });
      } else if (target === "SETTLING" && from === "REVIEWING") {
        await this.freeze(tx, agg, me.id);
      } else if (target === "REVIEWING" && from === "SETTLING") {
        const snap = agg.activeSnapshot();
        if (!snap) throw new ConflictError("no_snapshot", "No frozen settlement to reopen");
        if (snap.firstReportAt) throw new ConflictError("payments_reported", "A payment has already been reported, so the bill is frozen (v1 rule).");
        await tx.snapshot.update({ where: { id: snap.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
        await this.bumpFinancial(tx, eventId);
      } else if (target === "DONE") {
        const gate = agg.doneGate();
        if (!gate.ready) throw new ConflictError("gate_blocked", "Not everything is settled yet", { blockers: gate.blockers });
        await tx.event.update({ where: { id: eventId }, data: { completedAt: new Date() } });
      } else {
        // Backward correction (Allocating/Reviewing → earlier). New approvals needed.
        await this.bumpFinancial(tx, eventId);
      }

      await tx.event.update({ where: { id: eventId }, data: { phase: target } });
      await this.audit(tx, eventId, me.id, "phase.changed", { from, to: target });
      return { phase: target };
    });
  }

  /** Recompute from the database, check approvals and write the immutable snapshot. */
  private async freeze(tx: Tx, agg: import("../aggregate/EventAggregate").EventAggregate, ownerId: string): Promise<void> {
    const gate = agg.settlementGate();
    if (!gate.ready) throw new ConflictError("gate_blocked", "Not everyone has approved the current version", { blockers: gate.blockers });
    const calc = agg.calculation();
    if (!calc.ok) throw new ConflictError("calculation_failed", "The split cannot be calculated");
    const facts = {
      receipts: agg.record.receipts.map((r) => {
        const st = calc.receipts.find((s) => s.receiptId === r.id)!;
        return {
          id: r.id,
          label: r.label,
          payerId: r.payerMemberId,
          version: r.version,
          payable: r.payableCentavos.toString(),
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
        edges: { create: calc.edges.map((e, i) => ({ position: i, fromMemberId: e.from, toMemberId: e.to, amountCentavos: e.amount })) },
      },
    });
    await this.audit(tx, agg.id, ownerId, "snapshot.frozen", { financialVersion: agg.record.financialVersion, edges: calc.edges.length });
  }

  async setCancelled(actorId: string, eventId: string, cancelled: boolean): Promise<void> {
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      await tx.event.update({ where: { id: eventId }, data: { cancelled, ...(cancelled ? { joinCodeHash: null, joinCodeCiphertext: null, joinCodeExpiresAt: null } : {}) } });
      await this.audit(tx, eventId, me.id, cancelled ? "event.cancelled" : "event.uncancelled");
    });
  }

  /** Whole-event purge. v1: only before any payment report exists. Returns asset keys to delete. */
  async deleteEvent(actorId: string, eventId: string, confirmTitle: string): Promise<string[]> {
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (confirmTitle.trim() !== agg.record.title) throw new ValidationError("confirm_mismatch", "Type the event title exactly to confirm");
      if (agg.record.snapshots.some((s) => s.firstReportAt)) {
        throw new ConflictError("payments_reported", "Payments were reported in this event. Export it instead; deletion after payments needs every member's approval (not in v1).");
      }
      const assets = await tx.asset.findMany({ where: { eventId }, select: { storageKey: true } });
      await this.purge(tx, eventId);
      return assets.map((a) => a.storageKey);
    });
  }

  /** Delete one event's rows in dependency order (Restrict FKs protect the ledger elsewhere). */
  async purge(tx: Tx, eventId: string): Promise<void> {
    const edgeIds = (await tx.settlementEdge.findMany({ where: { snapshot: { eventId } }, select: { id: true } })).map((e) => e.id);
    await tx.dispute.deleteMany({ where: { edgeId: { in: edgeIds } } });
    await tx.paymentReversal.deleteMany({ where: { report: { edgeId: { in: edgeIds } } } });
    await tx.paymentReport.updateMany({ where: { edgeId: { in: edgeIds } }, data: { replacesReportId: null } });
    await tx.paymentReport.deleteMany({ where: { edgeId: { in: edgeIds } } });
    await tx.snapshot.deleteMany({ where: { eventId } });
    await tx.receipt.deleteMany({ where: { eventId } });
    await tx.reviewApproval.deleteMany({ where: { eventId } });
    await tx.paymentInstruction.deleteMany({ where: { member: { eventId } } });
    await tx.asset.deleteMany({ where: { eventId } });
    await tx.event.update({ where: { id: eventId }, data: { ownerMemberId: null } });
    await tx.member.deleteMany({ where: { eventId } });
    await tx.event.delete({ where: { id: eventId } });
  }

  async listForActor(actorId: string) {
    const members = await this.db.member.findMany({
      where: { actorId, active: true },
      include: { event: { select: { id: true, title: true, phase: true, cancelled: true, updatedAt: true, ownerMemberId: true } } },
      orderBy: { event: { updatedAt: "desc" } },
    });
    return members.map((m) => ({
      eventId: m.event.id,
      title: m.event.title,
      phase: m.event.phase,
      cancelled: m.event.cancelled,
      isOwner: m.event.ownerMemberId === m.id,
      isAdmin: m.isAdmin,
      displayName: m.displayName,
      updatedAt: m.event.updatedAt.toISOString(),
    }));
  }

  /** Owner-only view of a still-valid join code. */
  revealCode(record: { joinCodeCiphertext: string | null; joinCodeExpiresAt: Date | null }): string | null {
    if (!record.joinCodeCiphertext || !record.joinCodeExpiresAt || record.joinCodeExpiresAt.getTime() <= Date.now()) return null;
    return this.codes.decrypt(record.joinCodeCiphertext);
  }
}
