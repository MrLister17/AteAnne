import { z } from "zod";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import type { Phase } from "@/domain/event/PhaseMachine";
import { AutoAdvance } from "@/domain/event/AutoAdvance";
import type { Db, Tx } from "../db";
import { GoneError, NotFoundError } from "../http/HttpError";
import { JoinCodeCodec, SecretGenerator } from "../security/Crypto";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { MAX_MEMBERS } from "../aggregate/EventAggregate";
import { addGuestSchema, createEventSchema, joinSchema, setAdminSchema, setCurrencySchema, transitionSchema, updateMeSchema } from "../validation";
import { BaseService, Caller } from "./BaseService";
import { RateService, receiptDay } from "../fx/RateService";


/** A browser identity, or a way to create one only when it's actually needed. */
export type ActorSource = string | (() => Promise<string>);

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
    private readonly rates: RateService | null = null,
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
      const event = await tx.event.create({ data: { title: data.title, note: data.note, currency: data.currency, nextMemberSeq: 2, ...join.data } });
      const member = await tx.member.create({
        data: { eventId: event.id, seq: 1, actorId, displayName: data.displayName, intent: data.intent, recoveryHash: recovery.hash, recoveryExpiresAt: recovery.expiresAt },
      });
      await tx.event.update({ where: { id: event.id }, data: { ownerMemberId: member.id } });
      await this.audit(tx, event.id, member.id, "event.created", { title: data.title, currency: data.currency });
      return { eventId: event.id, memberId: member.id, recoveryKey: recovery.key, joinCode: join.code };
    });
  }

  /**
   * Exchange a join code for membership. Returns null recoveryKey if already a member.
   * `actor` may be a function that creates a browser identity: it runs only
   * after the IP check passes and the code matches, so blocked or wrong
   * attempts never create Actor or Session rows (D57).
   */
  async join(actor: ActorSource, input: z.input<typeof joinSchema>, ipHash: string): Promise<Omit<Credentials, "recoveryKey"> & { recoveryKey: string | null }> {
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
    const actorId = typeof actor === "string" ? actor : await actor();

    return this.db.$transaction(async (tx) => {
      await this.repo.lock(tx, event.id);
      const fresh = await tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { members: true } });
      const existing = fresh.members.find((m) => m.actorId === actorId);
      if (existing) {
        if (!existing.active) throw new PermissionError("member_inactive", "Your access to this event was deactivated");
        return { eventId: fresh.id, memberId: existing.id, recoveryKey: null };
      }
      if (fresh.phase !== "COLLECTING" || !fresh.joinCodeHash || fresh.cancelled || fresh.rosterLockedAt) {
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
      if (agg.record.rosterLockedAt) throw new ConflictError("roster_locked", "The roster is locked; correcting receipts does not reopen joining");
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
      if (data.entryComplete) await this.advanceIfReady(tx, eventId);
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
      if (agg.record.rosterLockedAt) throw new ConflictError("roster_locked", "The roster is locked; no new guests can be added during corrections");
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
      if (agg.record.rosterLockedAt) throw new ConflictError("roster_locked", "The roster is locked; correcting a bill cannot remove a participant");
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

  /**
   * "Everyone's here" (D49): the organizer closes the roster for good. Receipts
   * and claims carry on; the bill freezes by itself once everyone is done,
   * possibly right now.
   */
  async lockRoster(actorId: string, eventId: string): Promise<{ phase: Phase }> {
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      agg.machine.assertIn("COLLECTING");
      agg.assertNotCancelled();
      if (!agg.record.rosterLockedAt) {
        await tx.event.update({ where: { id: eventId }, data: { rosterLockedAt: new Date(), joinCodeHash: null, joinCodeCiphertext: null, joinCodeExpiresAt: null } });
        await this.audit(tx, eventId, me.id, "roster.locked");
      }
      return { phase: await this.advanceIfReady(tx, eventId) };
    });
  }

  /**
   * Change the settle-up currency (D59). Organizer only, while receipts can
   * still change (Add & claim, which a reasoned correction returns to), and
   * only while nobody has reported a payment in any statement: confirmed
   * payments are recorded in this currency. Receipts keep their own currency
   * and numbers; only the conversion target changes.
   */
  async setCurrency(actorId: string, eventId: string, input: z.input<typeof setCurrencySchema>): Promise<void> {
    const data = setCurrencySchema.parse(input);
    if (this.rates) {
      const receipts = await this.db.receipt.findMany({ where: { eventId }, select: { currency: true, purchasedOn: true, createdAt: true } });
      await this.rates.ensureDays(receipts.filter((r) => r.currency !== data.currency).map(receiptDay));
    }
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      agg.assertNotCancelled();
      if (agg.record.financialVersion !== data.expectedFinancialVersion) throw new ConflictError("stale_version", "The event changed while you were looking. Refresh and check again.");
      if (agg.phase !== "COLLECTING") {
        throw new ConflictError("currency_locked", agg.phase === "DONE" ? "Done events are read-only" : "The bill is frozen. To change its currency, use Correct the bill first.");
      }
      if (agg.record.snapshots.some((x) => x.firstReportAt) || agg.record.cashReports.length > 0) {
        throw new ConflictError("payments_reported", "Payments were already reported in this currency, so it can't change.");
      }
      if (agg.currency === data.currency) return;
      await tx.event.update({ where: { id: eventId }, data: { currency: data.currency } });
      await this.bumpFinancial(tx, eventId, true);
      await this.audit(tx, eventId, me.id, "event.currency_changed", { from: agg.currency, to: data.currency });
      await this.advanceIfReady(tx, eventId);
    });
  }

  /**
   * Daily job: a bill that was ready except for a missing exchange rate
   * freezes once the rate is cached (nobody else would trigger it). Returns
   * how many froze.
   */
  async freezeWaitingEvents(): Promise<number> {
    const candidates = await this.db.event.findMany({ where: { phase: "COLLECTING", cancelled: false, rosterLockedAt: { not: null }, snapshots: { none: {} } }, select: { id: true } });
    let frozen = 0;
    for (const { id } of candidates) {
      const phase = await this.db.$transaction(async (tx) => {
        await this.repo.lock(tx, id);
        return this.advanceIfReady(tx, id);
      });
      if (phase === "SETTLING") frozen++;
    }
    return frozen;
  }

  /**
   * Daily job (D49): close every event whose payments have all been confirmed
   * for at least a day. Done is read-only, so the day is the window to undo a
   * mistaken "Received". Credited to the app ("System"). Returns how many closed.
   */
  async closeSettledEvents(now = new Date()): Promise<number> {
    const candidates = await this.db.event.findMany({ where: { phase: "SETTLING" }, select: { id: true } });
    let closed = 0;
    for (const { id } of candidates) {
      const did = await this.db.$transaction(async (tx) => {
        await this.repo.lock(tx, id);
        const agg = await this.repo.load(tx, id);
        const last = agg.lastSettlementActivity();
        if (!last || !AutoAdvance.shouldClose({ phase: agg.phase, doneReady: agg.doneGate().ready, lastActivityAt: last, now })) return false;
        await tx.event.update({ where: { id }, data: { phase: "DONE", completedAt: now } });
        await this.audit(tx, id, null, "phase.changed", { from: "SETTLING", to: "DONE", auto: true });
        return true;
      });
      if (did) closed++;
    }
    return closed;
  }

  /**
   * Organizer-only phase moves. Most moves now happen by themselves
   * (advanceIfReady); what remains by hand: freezing a corrected bill (or an
   * event started before v0.7), a reasoned correction, and Done as a fallback.
   */
  async transition(actorId: string, eventId: string, input: z.input<typeof transitionSchema>): Promise<{ phase: Phase }> {
    const { target, expectedFinancialVersion, reason } = transitionSchema.parse(input);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (agg.record.financialVersion !== expectedFinancialVersion) {
        throw new ConflictError("stale_version", "The event changed while you were looking. Refresh and check again.");
      }
      agg.machine.assertCanMoveTo(target);
      const from = agg.phase;

      if (target === "SETTLING") {
        agg.assertNotCancelled();
        await this.freeze(tx, agg, me.id);
      } else if (target === "COLLECTING" && from === "SETTLING") {
        const snap = agg.activeSnapshot();
        if (!snap) throw new ConflictError("no_snapshot", "No frozen settlement to reopen");
        const gate = agg.correctionGate();
        if (!gate.ready) throw new ConflictError("correction_blocked", "Resolve pending reports and disputes before correcting the bill", { blockers: gate.blockers });
        if (!reason) throw new ValidationError("correction_reason", "Explain why the bill needs a correction");
        await tx.snapshot.update({ where: { id: snap.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
        await this.bumpFinancial(tx, eventId);
        await this.audit(tx, eventId, me.id, "bill.correction_started", { snapshotId: snap.id, reason, financialVersion: agg.record.financialVersion });
      } else if (target === "DONE") {
        const gate = agg.doneGate();
        if (!gate.ready) throw new ConflictError("gate_blocked", "Not everything is settled yet", { blockers: gate.blockers });
        await tx.event.update({ where: { id: eventId }, data: { completedAt: new Date() } });
      } else {
        // An event started before v0.7, stepping back from Allocating/Reviewing to fix receipts.
        await this.bumpFinancial(tx, eventId);
      }

      await tx.event.update({ where: { id: eventId }, data: { phase: target } });
      await this.audit(tx, eventId, me.id, "phase.changed", { from, to: target });
      return { phase: target };
    });
  }

  async setCancelled(actorId: string, eventId: string, cancelled: boolean): Promise<void> {
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      if (cancelled && !agg.record.cancelled) {
        // Cancelling never forgives money (D64): cash handed over must be settled or undone first.
        if (agg.hasCashOutstanding()) throw new ConflictError("cash_outstanding", "Confirm, reject or sort out every cash payment before cancelling.");
        if ([...agg.cashNets().values()].some((n) => n !== 0n)) {
          throw new ConflictError("cash_not_returned", "Cash was handed over in this event. Record the money given back (or undo a mistaken confirmation) before cancelling.");
        }
      }
      await tx.event.update({ where: { id: eventId }, data: { cancelled, ...(cancelled ? { joinCodeHash: null, joinCodeCiphertext: null, joinCodeExpiresAt: null } : {}) } });
      await this.audit(tx, eventId, me.id, cancelled ? "event.cancelled" : "event.uncancelled");
    });
  }

  /** Whole-event purge. v1: only before any payment report exists. Returns asset keys to delete. */
  async deleteEvent(actorId: string, eventId: string, confirmTitle: string): Promise<string[]> {
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.assertOwner(me.id);
      if (confirmTitle.trim() !== agg.record.title) throw new ValidationError("confirm_mismatch", "Type the event title exactly to confirm");
      if (agg.record.snapshots.some((s) => s.firstReportAt) || agg.record.cashReports.length > 0) {
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
    await tx.cashDispute.deleteMany({ where: { eventId } });
    await tx.cashReversal.deleteMany({ where: { report: { eventId } } });
    await tx.cashReport.updateMany({ where: { eventId }, data: { replacesReportId: null } });
    await tx.cashReport.deleteMany({ where: { eventId } });
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
      include: { event: { select: { id: true, title: true, phase: true, cancelled: true, updatedAt: true, ownerMemberId: true, currency: true } } },
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
      currency: m.event.currency,
      updatedAt: m.event.updatedAt.toISOString(),
    }));
  }

  /** Owner-only view of a still-valid join code. */
  revealCode(record: { joinCodeCiphertext: string | null; joinCodeExpiresAt: Date | null }): string | null {
    if (!record.joinCodeCiphertext || !record.joinCodeExpiresAt || record.joinCodeExpiresAt.getTime() <= Date.now()) return null;
    return this.codes.decrypt(record.joinCodeCiphertext);
  }
}
