import { z } from "zod";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import { Decimal, ExchangeRate, rateFromDay } from "@/domain/fx/ExchangeRate";
import { formatMinor, manilaDay } from "@/domain/money/Currency";
import type { Db, Tx } from "../db";
import { NotFoundError } from "../http/HttpError";
import type { CashRecord, EventAggregate } from "../aggregate/EventAggregate";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { RateService } from "../fx/RateService";
import { cashReportSchema, decisionSchema, disputeChoiceSchema, rejectSchema, reverseSchema } from "../validation";
import { BaseService, Caller, callerParts } from "./BaseService";

const STEP_ONE = ["COLLECTING", "ALLOCATING", "REVIEWING"] as const;

/**
 * Running event payments (D64): cash one member already handed another,
 * recorded at any point during Add & claim or Pay, independent of the frozen
 * transfer plan. Only the named recipient confirms. A confirmed, non-reversed
 * handoff counts as a confirmed transfer everywhere (`confirmedTransfers`):
 * live balances, the freeze, corrections and Done. The app records handoffs;
 * it never holds or moves money.
 *
 * During Pay, a confirmation or its undo supersedes the statement and plans
 * the remaining transfers again in the same transaction (`replanStatement`).
 */
export class CashPaymentService extends BaseService {
  constructor(
    db: Db,
    private readonly limiter: RateLimiter,
    private readonly rates: RateService | null = null,
  ) {
    super(db);
  }

  private today(): string {
    return this.rates?.today() ?? manilaDay();
  }

  async eventIdForReport(reportId: string): Promise<string> {
    const r = await this.db.cashReport.findUnique({ where: { id: reportId }, select: { eventId: true } });
    if (!r) throw new NotFoundError("Payment not found");
    return r.eventId;
  }

  async eventIdForDispute(disputeId: string): Promise<string> {
    const d = await this.db.cashDispute.findUnique({ where: { id: disputeId }, select: { eventId: true } });
    if (!d) throw new NotFoundError("Dispute not found");
    return d.eventId;
  }

  /** Pay-phase rule: one cash question at a time, and only once edge payments are settled down (spec "Confirming a cash payment during Pay"). */
  private assertPayPhaseCalm(agg: EventAggregate, ignoreReportId?: string) {
    const snap = agg.activeSnapshot();
    for (const edge of snap?.edges ?? []) {
      if (edge.reports.some((r) => r.status === "REPORTED")) throw new ConflictError("edge_payment_pending", "Someone is waiting to confirm a payment. Confirm or cancel it first.");
      if (edge.disputes.some((d) => d.status !== "RESOLVED")) throw new ConflictError("edge_payment_disputed", "A payment is being sorted out. Finish that first.");
    }
    const { pending, disputed } = agg.cashOutstanding();
    if ([...pending, ...disputed].some((c) => c.id !== ignoreReportId)) {
      throw new ConflictError("cash_outstanding", "Another cash payment is waiting for a decision. Finish that first.");
    }
  }

  async report(caller: Caller, eventId: string, input: z.input<typeof cashReportSchema>): Promise<{ reportId: string; replayed: boolean }> {
    const data = cashReportSchema.parse(input);
    // Counted and rate-fetched before the event lock (D57).
    await this.limiter.hit(RATE_RULES.financialSavesPerPerson, `${eventId}:${callerParts(caller).actorId}`);
    if (data.paid && this.rates) await this.rates.ensureDays([this.today()]);
    return this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      const paid = data.paid && data.paid.currency !== agg.currency ? data.paid : undefined;
      if (data.paid && !paid && data.paid.amount !== data.amount) throw new ValidationError("amount_mismatch", "The amount handed over and the amount counted must match");
      // A retry with the same key and the same input returns the original, whatever happened since (even a freeze).
      const prior = await tx.cashReport.findUnique({ where: { senderMemberId_idempotencyKey: { senderMemberId: me.id, idempotencyKey: data.idempotencyKey } } });
      if (prior) {
        const same = prior.eventId === eventId && prior.recipientMemberId === data.recipientMemberId && prior.amountCentavos === data.amount
          && (prior.paidCurrency ?? null) === (paid?.currency ?? null) && (prior.paidMinor ?? null) === (paid?.amount ?? null);
        if (!same) throw new ConflictError("idempotency_mismatch", "This request key was already used for a different payment");
        return { reportId: prior.id, replayed: true };
      }
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      agg.assertNotCancelled();
      const recipient = agg.member(data.recipientMemberId);
      if (!recipient.active) throw new ValidationError("bad_recipient", "Pick someone on this event's roster");
      if (recipient.id === me.id) throw new ValidationError("self_payment", "Pick the person you gave the money to");
      if (agg.phase === "SETTLING") this.assertPayPhaseCalm(agg);

      let replaces: CashRecord | undefined;
      if (data.replacesReportId) {
        replaces = agg.cashReport(data.replacesReportId);
        if (replaces.senderMemberId !== me.id || replaces.recipientMemberId !== recipient.id || replaces.dispute?.status !== "AWAITING_REPLACEMENT") {
          throw new ConflictError("no_agreed_replacement", "Re-recording needs both of you to agree first");
        }
        if (replaces.amountCentavos !== data.amount || (replaces.paidCurrency ?? null) !== (paid?.currency ?? null) || (replaces.paidMinor ?? null) !== (paid?.amount ?? null)) {
          throw new ValidationError("replacement_mismatch", "Record the same handoff: same amount and currency as before");
        }
      }

      let fx: ExchangeRate | null = null;
      if (paid) {
        const instruction = await tx.paymentInstruction.findFirst({ where: { memberId: recipient.id, current: true } });
        if (!agg.acceptedCurrencies(instruction?.acceptedCurrencies ?? []).includes(paid.currency)) {
          throw new ValidationError("currency_not_accepted", `${recipient.displayName} doesn't accept ${paid.currency}. Use ${agg.currency}, or ask them.`);
        }
        if (replaces?.paidCurrency) {
          fx = new ExchangeRate(paid.currency, agg.currency, Decimal.parse(replaces.rate!), replaces.rateDate!.toISOString().slice(0, 10), replaces.rateSource!);
        } else {
          const today = this.today();
          fx = rateFromDay((await RateService.load(tx, [today])).get(today), paid.currency, agg.currency);
          if (!fx) throw new ConflictError("rate_unavailable", `Today's exchange rate isn't available yet. Use ${agg.currency}, or try again later.`);
        }
        if (fx.date !== paid.rateDate) throw new ConflictError("rate_changed", `The exchange rate changed (now ${fx.date}). Check the new amount.`, { rate: fx.toWire() });
        const credit = fx.convert(paid.amount);
        if (credit <= 0n) throw new ValidationError("amount_too_small", "That amount is too small to count after conversion");
        if (credit !== data.amount) {
          throw new ConflictError("rate_changed", `At today's rate, ${formatMinor(paid.amount, paid.currency)} counts as ${formatMinor(credit, agg.currency)}. Check the amount again.`, { rate: fx.toWire(), credit: credit.toString() });
        }
      }

      const report = await tx.cashReport.create({
        data: {
          eventId,
          senderMemberId: me.id,
          recipientMemberId: recipient.id,
          amountCentavos: data.amount,
          ...(fx && paid ? { paidCurrency: paid.currency, paidMinor: paid.amount, rate: fx.rateText(), rateDate: new Date(`${fx.date}T00:00:00Z`), rateSource: fx.source } : {}),
          method: data.method,
          note: data.note,
          idempotencyKey: data.idempotencyKey,
          replacesReportId: replaces?.id ?? null,
        },
      });
      if (replaces?.dispute) {
        await tx.cashDispute.update({ where: { id: replaces.dispute.id }, data: { status: "RESOLVED", resolution: "REPLACEMENT", resolvedAt: new Date(), version: { increment: 1 } } });
      }
      await this.audit(tx, eventId, me.id, "cash.reported", {
        reportId: report.id,
        to: recipient.id,
        amount: data.amount.toString(),
        method: data.method,
        replaces: replaces?.id ?? null,
        ...(fx && paid ? { paid: { currency: paid.currency, amount: paid.amount.toString(), rate: fx.rateText(), rateDate: fx.date } } : {}),
      });
      return { reportId: report.id, replayed: false };
    });
  }

  /** After a decision that can unblock or change money: freeze if ready (Add & claim) or re-plan (Pay). */
  private async afterChange(tx: Tx, eventId: string, actorMemberId: string | null, detail: { reason: "cash_confirmed" | "cash_reversed"; cashReportId: string } | null) {
    const agg = await this.repo.load(tx, eventId);
    if ((STEP_ONE as readonly string[]).includes(agg.phase)) {
      await this.advanceIfReady(tx, eventId);
    } else if (agg.phase === "SETTLING" && detail) {
      await this.replanStatement(tx, agg, actorMemberId, detail);
    }
  }

  private assertOpenForDecisions(agg: EventAggregate) {
    if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
  }

  async verify(caller: Caller, reportId: string, input: z.input<typeof decisionSchema> = {}): Promise<{ status: string }> {
    const data = decisionSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me, by }) => {
      const report = agg.cashReport(reportId);
      if (report.recipientMemberId !== me.id) throw new PermissionError("not_recipient", "Only the person who got the money can confirm it");
      agg.guests.assertNoConflict(by, me, report.senderMemberId);
      if (report.status === "VERIFIED") return { status: "VERIFIED" }; // idempotent double tap
      this.assertOpenForDecisions(agg);
      if (report.status !== "REPORTED") throw new ConflictError("not_pending", "Only a payment that's waiting can be confirmed");
      if (data.expectedVersion && data.expectedVersion !== report.version) throw new ConflictError("stale_report", "This payment changed. Reload and check again.");
      const res = await tx.cashReport.updateMany({ where: { id: reportId, status: "REPORTED" }, data: { status: "VERIFIED", version: { increment: 1 }, decidedAt: new Date() } });
      if (res.count !== 1) throw new ConflictError("not_pending", "This payment was already decided");
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "cash.verified", { reportId, from: report.senderMemberId, amount: report.amountCentavos.toString() });
      await this.afterChange(tx, eventId, me.id, { reason: "cash_confirmed", cashReportId: reportId });
      return { status: "VERIFIED" };
    });
  }

  async reject(caller: Caller, reportId: string, input: z.input<typeof rejectSchema>): Promise<{ disputeId: string }> {
    const data = rejectSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me, by }) => {
      const report = agg.cashReport(reportId);
      if (report.recipientMemberId !== me.id) throw new PermissionError("not_recipient", "Only the person named as getting the money can say it didn't arrive");
      agg.guests.assertNoConflict(by, me, report.senderMemberId);
      if (report.status === "REJECTED" && report.dispute) return { disputeId: report.dispute.id };
      this.assertOpenForDecisions(agg);
      if (report.status !== "REPORTED") throw new ConflictError("not_pending", "Only a payment that's waiting can be rejected");
      if (data.expectedVersion && data.expectedVersion !== report.version) throw new ConflictError("stale_report", "This payment changed. Reload and check again.");
      const res = await tx.cashReport.updateMany({ where: { id: reportId, status: "REPORTED" }, data: { status: "REJECTED", rejectReason: data.reason, version: { increment: 1 }, decidedAt: new Date() } });
      if (res.count !== 1) throw new ConflictError("not_pending", "This payment was already decided");
      const dispute = await tx.cashDispute.create({ data: { eventId, reportId } });
      await this.audit(tx, eventId, me.id, "cash.rejected", { reportId, disputeId: dispute.id });
      return { disputeId: dispute.id };
    });
  }

  async cancel(caller: Caller, reportId: string): Promise<void> {
    const eventId = await this.eventIdForReport(reportId);
    await this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      const report = agg.cashReport(reportId);
      if (report.senderMemberId !== me.id) throw new PermissionError("not_sender", "Only the person who recorded it can cancel it");
      if (report.status === "CANCELLED") return;
      this.assertOpenForDecisions(agg);
      if (report.status !== "REPORTED") throw new ConflictError("not_pending", "Only a payment that's waiting can be cancelled; a confirmed one is undone by the person who got it");
      await tx.cashReport.update({ where: { id: reportId }, data: { status: "CANCELLED", version: { increment: 1 }, decidedAt: new Date() } });
      await this.audit(tx, eventId, me.id, "cash.cancelled", { reportId });
      // A pending report held the freeze; cancelling may release it.
      await this.afterChange(tx, eventId, me.id, null);
    });
  }

  /** The recipient's single, reasoned undo of a mistaken confirmation. During Pay it re-plans like a confirmation. */
  async reverse(caller: Caller, reportId: string, input: z.input<typeof reverseSchema>): Promise<void> {
    const data = reverseSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    await this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      const report = agg.cashReport(reportId);
      if (report.recipientMemberId !== me.id) throw new PermissionError("not_recipient", "Only the person who confirmed it can undo it");
      this.assertOpenForDecisions(agg);
      agg.assertNotCancelled();
      if (report.status !== "VERIFIED") throw new ConflictError("not_verified", "Only a confirmed payment can be undone");
      if (report.reversal) throw new ConflictError("already_reversed", "A confirmation can be undone only once");
      if (agg.phase === "SETTLING") this.assertPayPhaseCalm(agg);
      await tx.cashReversal.create({ data: { reportId, actorMemberId: me.id, reason: data.reason } });
      await this.bumpFinancial(tx, eventId);
      await this.audit(tx, eventId, me.id, "cash.verification_reversed", { reportId, amount: report.amountCentavos.toString(), reason: data.reason });
      await this.afterChange(tx, eventId, me.id, { reason: "cash_reversed", cashReportId: reportId });
    });
  }

  /** Each side picks "no money was handed over" or "it was: record it again"; it takes effect when both agree. */
  async chooseResolution(caller: Caller, disputeId: string, input: z.input<typeof disputeChoiceSchema>): Promise<{ status: string }> {
    const data = disputeChoiceSchema.parse(input);
    const eventId = await this.eventIdForDispute(disputeId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me, by }) => {
      this.assertOpenForDecisions(agg);
      const report = agg.record.cashReports.find((c) => c.dispute?.id === disputeId);
      if (!report?.dispute) throw new NotFoundError("Dispute not found");
      const d = report.dispute;
      const side = report.senderMemberId === me.id ? "senderChoice" : report.recipientMemberId === me.id ? "recipientChoice" : null;
      if (!side) throw new PermissionError("not_counterparty", "Only the two people involved can sort this out");
      agg.guests.assertNoConflict(by, me, side === "senderChoice" ? report.recipientMemberId : report.senderMemberId);
      if (d.status !== "OPEN") throw new ConflictError("dispute_closed", "This is no longer open");
      if (d.version !== data.expectedVersion) throw new ConflictError("stale_dispute", "The other person changed their answer. Reload and check.");
      const next = { senderChoice: d.senderChoice, recipientChoice: d.recipientChoice, [side]: data.choice };
      const agreed = next.senderChoice && next.senderChoice === next.recipientChoice ? next.senderChoice : null;
      const status = agreed === "NO_TRANSFER" ? "RESOLVED" : agreed === "REPLACEMENT" ? "AWAITING_REPLACEMENT" : "OPEN";
      await tx.cashDispute.update({
        where: { id: disputeId },
        data: { [side]: data.choice, version: { increment: 1 }, status, resolution: agreed, resolvedAt: status === "RESOLVED" ? new Date() : null },
      });
      await this.audit(tx, eventId, me.id, "cash.dispute_choice", { disputeId, reportId: report.id, choice: data.choice, status });
      // "No money was handed over" closes it with no ledger effect; that may release the freeze.
      if (status === "RESOLVED") await this.afterChange(tx, eventId, me.id, null);
      return { status };
    });
  }
}
