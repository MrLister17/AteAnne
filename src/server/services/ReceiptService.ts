import { z } from "zod";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import type { Db, Tx } from "../db";
import { NotFoundError } from "../http/HttpError";
import { EventAggregate, MAX_LINES, MAX_RECEIPTS, MemberRecord } from "../aggregate/EventAggregate";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { claimsSchema, fundingAckSchema, receiptSchema, updateReceiptSchema } from "../validation";
import { BaseService } from "./BaseService";

type ReceiptPayload = z.output<typeof receiptSchema>;

/**
 * Receipts (Collecting) and claims (Allocating).
 *
 * Receipt edits bump the receipt version — older claims and acknowledgements
 * become stale drafts that must be re-confirmed — and the event financial
 * version, which invalidates every review approval.
 */
export class ReceiptService extends BaseService {
  constructor(
    db: Db,
    private readonly limiter: RateLimiter,
  ) {
    super(db);
  }

  async eventIdForReceipt(receiptId: string): Promise<string> {
    const r = await this.db.receipt.findUnique({ where: { id: receiptId }, select: { eventId: true } });
    if (!r) throw new NotFoundError("Receipt not found");
    return r.eventId;
  }

  private assertCanEdit(agg: EventAggregate, me: MemberRecord) {
    agg.machine.assertIn("COLLECTING");
    agg.assertNotCancelled();
    void me;
  }

  private validatePayload(agg: EventAggregate, data: ReceiptPayload) {
    const payer = agg.record.members.find((m) => m.id === data.payerMemberId && m.active);
    if (!payer) throw new ValidationError("bad_payer", "The actual payer must be someone on this event's roster");
    if (data.lines.length > MAX_LINES) throw new ValidationError("too_many_lines", `At most ${MAX_LINES} lines per receipt`);
    for (const adj of data.adjustments) {
      for (const i of adj.eligibleLineIndexes ?? []) {
        if (i >= data.lines.length) throw new ValidationError("bad_scope", `"${adj.label}" refers to a line that does not exist`);
      }
      if (adj.eligibleLineIndexes && adj.eligibleLineIndexes.length === 0) {
        throw new ValidationError("empty_scope", `"${adj.label}" must apply to at least one line`);
      }
    }
  }

  async create(actorId: string, eventId: string, input: z.input<typeof receiptSchema>): Promise<{ receiptId: string }> {
    const data = receiptSchema.parse(input);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      await this.limiter.hit(RATE_RULES.financialSavesPerMember, me.id);
      this.assertCanEdit(agg, me);
      if (agg.record.receipts.length >= MAX_RECEIPTS) throw new ConflictError("too_many_receipts", `At most ${MAX_RECEIPTS} receipts per event`);
      this.validatePayload(agg, data);
      const position = Math.max(-1, ...agg.record.receipts.map((r) => r.position)) + 1;
      const receipt = await tx.receipt.create({
        data: { eventId, authorMemberId: me.id, payerMemberId: data.payerMemberId, label: data.label, payableCentavos: data.payable, position },
      });
      await this.writeLinesAndAdjustments(tx, receipt.id, [], data);
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "receipt.created", { receiptId: receipt.id, label: data.label, payable: data.payable.toString() });
      return { receiptId: receipt.id };
    });
  }

  async update(actorId: string, receiptId: string, input: z.input<typeof updateReceiptSchema>): Promise<{ version: number }> {
    const data = updateReceiptSchema.parse(input);
    const eventId = await this.eventIdForReceipt(receiptId);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      await this.limiter.hit(RATE_RULES.financialSavesPerMember, me.id);
      this.assertCanEdit(agg, me);
      const receipt = agg.receipt(receiptId);
      const isAuthor = receipt.authorMemberId === me.id;
      if (!isAuthor && !agg.isOwner(me.id)) throw new PermissionError("not_author", "Only the person who entered this receipt, or the organizer, can correct it");
      if (receipt.version !== data.expectedVersion) throw new ConflictError("stale_receipt", "Someone else changed this receipt. Reload it and re-apply your edit.");
      this.validatePayload(agg, data);
      await tx.receipt.update({
        where: { id: receiptId },
        data: { label: data.label, payerMemberId: data.payerMemberId, payableCentavos: data.payable, version: { increment: 1 } },
      });
      await this.writeLinesAndAdjustments(tx, receiptId, receipt.lines.map((l) => l.id), data);
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, isAuthor ? "receipt.updated" : "receipt.organizer_correction", { receiptId, label: data.label, fromVersion: receipt.version });
      return { version: receipt.version + 1 };
    });
  }

  /** Keep IDs of existing lines that were resubmitted (their claims become stale drafts). */
  private async writeLinesAndAdjustments(tx: Tx, receiptId: string, existingLineIds: string[], data: ReceiptPayload) {
    const keep = new Set(data.lines.map((l) => l.id).filter((x): x is string => Boolean(x && existingLineIds.includes(x))));
    await tx.receiptLine.deleteMany({ where: { receiptId, id: { notIn: [...keep] } } });
    await tx.adjustment.deleteMany({ where: { receiptId } });
    const ids: string[] = [];
    for (const [position, l] of data.lines.entries()) {
      const fields = { position, label: l.label, quantity: l.quantity, amountCentavos: l.amount, unitPriceCentavos: l.unitPrice ?? null, mode: l.mode };
      if (l.id && keep.has(l.id)) {
        await tx.receiptLine.update({ where: { id: l.id }, data: fields });
        ids.push(l.id);
      } else {
        ids.push((await tx.receiptLine.create({ data: { receiptId, ...fields } })).id);
      }
    }
    for (const [position, a] of data.adjustments.entries()) {
      await tx.adjustment.create({
        data: {
          receiptId,
          position,
          kind: a.kind,
          label: a.label,
          amountCentavos: a.amount,
          scopeAll: a.eligibleLineIndexes === null,
          eligibleLineIds: (a.eligibleLineIndexes ?? []).map((i) => ids[i]),
        },
      });
    }
  }

  async remove(actorId: string, receiptId: string): Promise<void> {
    const eventId = await this.eventIdForReceipt(receiptId);
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      this.assertCanEdit(agg, me);
      const receipt = agg.receipt(receiptId);
      if (receipt.authorMemberId !== me.id && !agg.isOwner(me.id)) throw new PermissionError("not_author", "Only the author or organizer can delete this receipt");
      await tx.receipt.delete({ where: { id: receiptId } });
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "receipt.deleted", { receiptId, label: receipt.label });
    });
  }

  /** The named payer signs that they paid exactly this amount for this receipt version. */
  async acknowledgeFunding(actorId: string, receiptId: string, input: z.input<typeof fundingAckSchema>): Promise<void> {
    const data = fundingAckSchema.parse(input);
    const eventId = await this.eventIdForReceipt(receiptId);
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.machine.assertIn("COLLECTING");
      agg.assertNotCancelled();
      const receipt = agg.receipt(receiptId);
      if (receipt.payerMemberId !== me.id) throw new PermissionError("not_payer", "Only the named payer can confirm this funding");
      if (receipt.version !== data.receiptVersion || receipt.payableCentavos !== data.amount) {
        throw new ConflictError("stale_receipt", "The receipt changed. Review the new amount before confirming.");
      }
      if (agg.fundingAcknowledged(receipt)) return;
      await tx.fundingAck.create({ data: { receiptId, memberId: me.id, receiptVersion: receipt.version, amountCentavos: receipt.payableCentavos } });
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "funding.acknowledged", { receiptId, amount: receipt.payableCentavos.toString(), version: receipt.version });
    });
  }

  /**
   * Save the caller's OWN claims on one receipt. Units over-claims are
   * rejected with 409 inside the event lock, so concurrent saves can never
   * allocate more units than exist.
   */
  async saveClaims(actorId: string, receiptId: string, input: z.input<typeof claimsSchema>): Promise<{ claimVersion: number }> {
    const data = claimsSchema.parse(input);
    const eventId = await this.eventIdForReceipt(receiptId);
    return this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      await this.limiter.hit(RATE_RULES.financialSavesPerMember, me.id);
      agg.machine.assertIn("ALLOCATING");
      agg.assertNotCancelled();
      const receipt = agg.receipt(receiptId);
      if (receipt.version !== data.receiptVersion) throw new ConflictError("stale_receipt", "This receipt was corrected. Review the new version and claim again.");
      if (me.claimVersion !== data.expectedClaimVersion) throw new ConflictError("stale_claims", "Your claims were changed from another tab or device. Reload to see them.");
      if (data.status === "none" && data.claims.length) throw new ValidationError("none_with_claims", "Remove your items to say you got nothing from this receipt");
      if (data.status === "finish" && !data.claims.length) throw new ValidationError("finish_without_claims", "Pick your items, or choose “I got nothing from this receipt”");

      const lines = new Map(receipt.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      for (const c of data.claims) {
        const line = lines.get(c.lineId);
        if (!line) throw new ValidationError("bad_line", "Claim refers to a line on another receipt");
        if (seen.has(c.lineId)) throw new ValidationError("duplicate_line", "Each line can be claimed once");
        seen.add(c.lineId);
        if (line.mode === "SHARED" && c.units !== 1) throw new ValidationError("shared_units", `"${line.label}" is shared equally; claim it once`);
        if (line.mode === "UNITS") {
          const others = line.claims.filter((x) => x.memberId !== me.id && x.receiptVersion === receipt.version).reduce((a, x) => a + x.units, 0);
          if (others + c.units > line.quantity) {
            throw new ConflictError("over_claim", `Only ${line.quantity - others} of ${line.quantity} "${line.label}" units are left. Your change was not saved.`, {
              lineId: line.id,
              available: line.quantity - others,
            });
          }
        }
      }

      await tx.claim.deleteMany({ where: { memberId: me.id, lineId: { in: [...lines.keys()] } } });
      if (data.claims.length) {
        await tx.claim.createMany({ data: data.claims.map((c) => ({ memberId: me.id, lineId: c.lineId, units: c.units, receiptVersion: receipt.version })) });
      }
      if (data.status === "draft") {
        await tx.receiptAck.deleteMany({ where: { memberId: me.id, receiptId } });
      } else {
        const kind = data.status === "none" ? "NONE" : "FINISHED";
        await tx.receiptAck.upsert({
          where: { memberId_receiptId: { memberId: me.id, receiptId } },
          create: { memberId: me.id, receiptId, kind, receiptVersion: receipt.version },
          update: { kind, receiptVersion: receipt.version },
        });
      }
      const updated = await tx.member.update({ where: { id: me.id }, data: { claimVersion: { increment: 1 } } });
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "claims.saved", { receiptId, status: data.status, lines: data.claims.length });
      return { claimVersion: updated.claimVersion };
    });
  }

  /** Self-only approval of the exact current financial version. */
  async approveReview(actorId: string, eventId: string, financialVersion: number): Promise<void> {
    await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
      agg.machine.assertIn("REVIEWING");
      agg.assertNotCancelled();
      if (agg.record.financialVersion !== financialVersion) throw new ConflictError("stale_version", "The split changed. Review the new version before approving.");
      const gate = agg.reviewGate();
      if (!gate.ready) throw new ConflictError("gate_blocked", "There are unresolved blockers", { blockers: gate.blockers });
      await tx.reviewApproval.upsert({
        where: { memberId_financialVersion: { memberId: me.id, financialVersion } },
        create: { eventId, memberId: me.id, financialVersion },
        update: {},
      });
      await this.audit(tx, eventId, me.id, "review.approved", { financialVersion });
    });
  }
}
