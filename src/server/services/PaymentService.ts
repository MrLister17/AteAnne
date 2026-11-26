import { z } from "zod";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import { PaymentLedger } from "@/domain/payments/PaymentLedger";
import type { Db } from "../db";
import { NotFoundError } from "../http/HttpError";
import type { EventAggregate } from "../aggregate/EventAggregate";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { decisionSchema, disputeChoiceSchema, instructionsSchema, rejectSchema, reportSchema, reverseSchema } from "../validation";
import { BaseService, Caller, callerParts } from "./BaseService";
import { Decimal, ExchangeRate, rateFromDay } from "@/domain/fx/ExchangeRate";
import { formatMinor, manilaDay } from "@/domain/money/Currency";
import { ForeignPayment } from "@/domain/payments/ForeignPayment";
import { RateService } from "../fx/RateService";

/**
 * Settlement phase: payment instructions, sender reports, recipient-only
 * verification/rejection/reversal and two-sided dispute resolution.
 *
 * Every write locks the event, re-derives edge state from immutable history
 * and checks capacity, so double clicks and concurrent requests can never
 * over-report or double-credit.
 */
export class PaymentService extends BaseService {
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

  private findEdge(agg: EventAggregate, edgeId: string) {
    const snap = agg.activeSnapshot();
    const edge = snap?.edges.find((e) => e.id === edgeId);
    if (!snap || !edge) {
      // A transfer from a statement that was re-planned (a confirmed cash payment, D64) or corrected.
      if (agg.record.snapshots.some((s) => s.edges.some((e) => e.id === edgeId))) {
        throw new ConflictError("stale_transfer", "The payment plan changed, so refresh to see what's left to pay");
      }
      throw new NotFoundError("Transfer not found");
    }
    return { snap, edge };
  }

  private findReport(agg: EventAggregate, reportId: string) {
    for (const snap of agg.record.snapshots) {
      for (const edge of snap.edges) {
        const report = edge.reports.find((r) => r.id === reportId);
        if (report) return { snap, edge, report };
      }
    }
    throw new NotFoundError("Payment report not found");
  }

  async eventIdForEdge(edgeId: string): Promise<string> {
    const e = await this.db.settlementEdge.findUnique({ where: { id: edgeId }, select: { snapshot: { select: { eventId: true } } } });
    if (!e) throw new NotFoundError("Transfer not found");
    return e.snapshot.eventId;
  }

  async eventIdForReport(reportId: string): Promise<string> {
    const r = await this.db.paymentReport.findUnique({ where: { id: reportId }, select: { edge: { select: { snapshot: { select: { eventId: true } } } } } });
    if (!r) throw new NotFoundError("Payment report not found");
    return r.edge.snapshot.eventId;
  }

  async eventIdForDispute(disputeId: string): Promise<string> {
    const d = await this.db.dispute.findUnique({ where: { id: disputeId }, select: { edge: { select: { snapshot: { select: { eventId: true } } } } } });
    if (!d) throw new NotFoundError("Dispute not found");
    return d.edge.snapshot.eventId;
  }

  /** New instruction version; old versions stay attached to earlier reports. QR changes never touch approvals. */
  async setInstructions(caller: Caller, eventId: string, input: z.input<typeof instructionsSchema>, newQrAssetId?: string | null): Promise<{ version: number }> {
    const data = instructionsSchema.parse(input);
    return this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
      const current = await tx.paymentInstruction.findFirst({ where: { memberId: me.id, current: true } });
      const qrAssetId = newQrAssetId ?? (data.keepQr ? (current?.qrAssetId ?? null) : null);
      if (qrAssetId) {
        const asset = await tx.asset.findUnique({ where: { id: qrAssetId } });
        if (!asset || asset.ownerMemberId !== me.id || asset.kind !== "QR" || asset.eventId !== eventId) throw new NotFoundError("QR image not found");
      }
      if (!data.acceptsCash && !qrAssetId) throw new ValidationError("no_method", "Accept cash, upload a QR, or both");
      const version = (current?.version ?? 0) + 1;
      await tx.paymentInstruction.updateMany({ where: { memberId: me.id, current: true }, data: { current: false } });
      const acceptedCurrencies = [...new Set(data.acceptedCurrencies)];
      await tx.paymentInstruction.create({
        data: { memberId: me.id, version, acceptsCash: data.acceptsCash, cashNote: data.cashNote, qrAssetId, qrLabel: data.qrLabel, acceptedCurrencies },
      });
      await this.audit(tx, eventId, me.id, "instructions.updated", { version, cash: data.acceptsCash, qr: Boolean(qrAssetId), currencies: acceptedCurrencies });
      void agg;
      return { version };
    });
  }

  async report(caller: Caller, edgeId: string, input: z.input<typeof reportSchema>): Promise<{ reportId: string; replayed: boolean }> {
    const data = reportSchema.parse(input);
    const eventId = await this.eventIdForEdge(edgeId);
    // Counted before the event lock so it never holds a second connection (D57).
    await this.limiter.hit(RATE_RULES.financialSavesPerPerson, `${eventId}:${callerParts(caller).actorId}`);
    // Today's rate is fetched before the lock too; inside, only the cache is read.
    if (data.paid && this.rates) await this.rates.ensureDays([this.today()]);
    return this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      // Sent in the settle-up currency itself: an ordinary report.
      const paid = data.paid && data.paid.currency !== agg.currency ? data.paid : undefined;
      if (data.paid && !paid && data.paid.amount !== data.amount) throw new ValidationError("amount_mismatch", "The amount sent and the amount credited must match");
      // Idempotent replay: same sender + key returns the original record.
      const prior = await tx.paymentReport.findUnique({ where: { senderMemberId_idempotencyKey: { senderMemberId: me.id, idempotencyKey: data.idempotencyKey } } });
      if (prior) {
        if (prior.edgeId !== edgeId || prior.amountCentavos !== data.amount || (prior.paidCurrency ?? null) !== (paid?.currency ?? null) || (prior.paidMinor ?? null) !== (paid?.amount ?? null)) {
          throw new ConflictError("idempotency_mismatch", "This request key was already used for a different payment");
        }
        return { reportId: prior.id, replayed: true };
      }
      agg.machine.assertIn("SETTLING");
      const { snap, edge } = this.findEdge(agg, edgeId);
      // While a cash payment awaits a decision, the plan may change under it: other payments pause (D64).
      if (agg.hasCashOutstanding()) throw new ConflictError("cash_outstanding", "Other payments are paused until the waiting cash payment is confirmed or sorted out");
      const ledger = agg.paymentLedger(snap)!;

      let replaces: string | undefined;
      const openDispute = edge.disputes.find((d) => d.status !== "RESOLVED");
      if (data.replacesReportId) {
        if (!openDispute || openDispute.status !== "AWAITING_REPLACEMENT" || openDispute.rejectedReportId !== data.replacesReportId) {
          throw new ConflictError("no_agreed_replacement", "A replacement record needs both of you to agree first");
        }
        replaces = data.replacesReportId;
      }
      const instruction = await tx.paymentInstruction.findFirst({ where: { memberId: edge.toMemberId, current: true } });
      const foreign = paid ? await this.foreignCredit(tx, agg, edge, ledger.edgeState(edgeId).capacity, paid, instruction?.acceptedCurrencies ?? [], replaces) : null;
      if (foreign && foreign.credit !== data.amount) {
        throw new ConflictError("rate_changed", `At today's rate, ${formatMinor(paid!.amount, paid!.currency)} counts as ${formatMinor(foreign.credit, agg.currency)}, so check the amount again`, { rate: foreign.rate.toWire(), credit: foreign.credit.toString() });
      }
      ledger.assertCanReport(edgeId, me.id, data.amount, { isAgreedReplacement: Boolean(replaces) });
      if (data.method === "QR" && !instruction?.qrAssetId) throw new ValidationError("no_qr", "The recipient has not shared a payment QR");
      const report = await tx.paymentReport.create({
        data: {
          edgeId,
          senderMemberId: me.id,
          recipientMemberId: edge.toMemberId,
          amountCentavos: data.amount,
          ...(foreign
            ? { paidCurrency: paid!.currency, paidMinor: paid!.amount, rate: foreign.rate.rateText(), rateDate: new Date(`${foreign.rate.date}T00:00:00Z`), rateSource: foreign.rate.source }
            : {}),
          method: data.method,
          instructionId: instruction?.id ?? null,
          note: data.note,
          idempotencyKey: data.idempotencyKey,
          replacesReportId: replaces ?? null,
        },
      });
      if (!snap.firstReportAt) await tx.snapshot.update({ where: { id: snap.id }, data: { firstReportAt: new Date() } });
      if (replaces && openDispute) {
        await tx.dispute.update({ where: { id: openDispute.id }, data: { status: "RESOLVED", resolution: "REPLACEMENT", resolvedAt: new Date() } });
      }
      await this.audit(tx, eventId, me.id, "payment.reported", {
        reportId: report.id,
        edgeId,
        amount: data.amount.toString(),
        method: data.method,
        replaces: replaces ?? null,
        ...(foreign ? { paid: { currency: paid!.currency, amount: paid!.amount.toString(), rate: foreign.rate.rateText(), rateDate: foreign.rate.date } } : {}),
      });
      return { reportId: report.id, replayed: false };
    });
  }

  /**
   * Credit for money sent in another currency (rule 8): the receiver must
   * accept that currency, the rate is the one for the day it's sent (an
   * agreed replacement reuses the rejected payment's rate: same money), and
   * the phone must have shown that same rate.
   */
  private async foreignCredit(
    tx: Parameters<Parameters<BaseService["inEvent"]>[2]>[0]["tx"],
    agg: EventAggregate,
    edge: { id: string; toMemberId: string; reports: { id: string; paidCurrency: string | null; rate: string | null; rateDate: Date | null; rateSource: string | null }[] },
    capacity: bigint,
    paid: { currency: string; amount: bigint; rateDate: string },
    accepted: string[],
    replaces: string | undefined,
  ): Promise<{ credit: bigint; rate: ExchangeRate }> {
    if (!agg.acceptedCurrencies(accepted).includes(paid.currency)) {
      throw new ValidationError("currency_not_accepted", `${agg.member(edge.toMemberId).displayName} doesn't accept ${paid.currency}, so pay in ${agg.currency} or ask them`);
    }
    let rate: ExchangeRate | null;
    const rejected = replaces ? edge.reports.find((r) => r.id === replaces) : undefined;
    if (rejected?.paidCurrency) {
      if (rejected.paidCurrency !== paid.currency) throw new ValidationError("replacement_currency", `Record the same money: it was sent in ${rejected.paidCurrency}`);
      rate = new ExchangeRate(paid.currency, agg.currency, Decimal.parse(rejected.rate!), rejected.rateDate!.toISOString().slice(0, 10), rejected.rateSource!);
    } else {
      const today = this.today();
      rate = rateFromDay((await RateService.load(tx, [today])).get(today), paid.currency, agg.currency);
      if (!rate) throw new ConflictError("rate_unavailable", `Today's exchange rate isn't available yet, so pay in ${agg.currency} or try again later`);
    }
    if (rate.date !== paid.rateDate) {
      throw new ConflictError("rate_changed", `The exchange rate changed (now ${rate.date}), so check the new amount`, { rate: rate.toWire() });
    }
    return { credit: new ForeignPayment(rate).creditFor(paid.amount, capacity), rate };
  }

  async cancel(caller: Caller, reportId: string): Promise<void> {
    const eventId = await this.eventIdForReport(reportId);
    await this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      const { snap, report } = this.findReport(agg, reportId);
      if (report.senderMemberId !== me.id) throw new PermissionError("not_sender", "Only the sender can cancel their report");
      if (report.status === "CANCELLED") return;
      if (snap.status !== "ACTIVE") throw new ConflictError("superseded", "This payment belongs to a prior statement and is kept as history");
      agg.machine.assertIn("SETTLING");
      if (report.status !== "REPORTED") throw new ConflictError("not_pending", "Only a pending report can be cancelled; a confirmed payment is corrected by the recipient");
      await tx.paymentReport.update({ where: { id: reportId }, data: { status: "CANCELLED", version: { increment: 1 }, decidedAt: new Date() } });
      await this.audit(tx, eventId, me.id, "payment.cancelled", { reportId });
    });
  }

  async verify(caller: Caller, reportId: string, input: z.input<typeof decisionSchema> = {}): Promise<{ status: string }> {
    const data = decisionSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me, by }) => {
      const { snap, edge, report } = this.findReport(agg, reportId);
      if (report.recipientMemberId !== me.id) throw new PermissionError("not_recipient", "Only the named recipient can confirm this payment");
      agg.guests.assertNoConflict(by, me, report.senderMemberId);
      if (report.status === "VERIFIED") return { status: "VERIFIED" }; // idempotent double-click
      agg.machine.assertIn("SETTLING");
      if (snap.status !== "ACTIVE") throw new ConflictError("superseded", "This settlement was superseded");
      PaymentLedger.assertCanDecide({ recipientId: report.recipientMemberId, status: report.status }, me.id);
      if (data.expectedVersion && data.expectedVersion !== report.version) throw new ConflictError("stale_report", "This report changed, so reload and check again");
      const state = agg.paymentLedger(snap)!.edgeState(edge.id);
      if (state.verified + report.amountCentavos > edge.amountCentavos) throw new ConflictError("over_settle", "Confirming would exceed the transfer amount");
      // Conditional update guards against any concurrent decision.
      const res = await tx.paymentReport.updateMany({ where: { id: reportId, status: "REPORTED" }, data: { status: "VERIFIED", version: { increment: 1 }, decidedAt: new Date() } });
      if (res.count !== 1) throw new ConflictError("not_pending", "This report was already decided");
      await this.audit(tx, eventId, me.id, "payment.verified", { reportId, amount: report.amountCentavos.toString() });
      return { status: "VERIFIED" };
    });
  }

  async reject(caller: Caller, reportId: string, input: z.input<typeof rejectSchema>): Promise<{ disputeId: string }> {
    const data = rejectSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      agg.machine.assertIn("SETTLING");
      const { snap, edge, report } = this.findReport(agg, reportId);
      if (snap.status !== "ACTIVE") throw new ConflictError("superseded", "This payment belongs to a prior statement and is kept as history");
      if (report.status === "REJECTED" && report.recipientMemberId === me.id) {
        const existing = edge.disputes.find((d) => d.rejectedReportId === reportId)!;
        return { disputeId: existing.id };
      }
      PaymentLedger.assertCanDecide({ recipientId: report.recipientMemberId, status: report.status }, me.id);
      if (data.expectedVersion && data.expectedVersion !== report.version) throw new ConflictError("stale_report", "This report changed, so reload and check again");
      const res = await tx.paymentReport.updateMany({
        where: { id: reportId, status: "REPORTED" },
        data: { status: "REJECTED", rejectReason: data.reason, version: { increment: 1 }, decidedAt: new Date() },
      });
      if (res.count !== 1) throw new ConflictError("not_pending", "This report was already decided");
      const dispute = await tx.dispute.create({ data: { edgeId: edge.id, rejectedReportId: reportId } });
      await this.audit(tx, eventId, me.id, "payment.rejected", { reportId, disputeId: dispute.id });
      return { disputeId: dispute.id };
    });
  }

  /** Recipient corrects their own mistaken confirmation, once, with a reason, before Done. */
  async reverse(caller: Caller, reportId: string, input: z.input<typeof reverseSchema>): Promise<void> {
    const data = reverseSchema.parse(input);
    const eventId = await this.eventIdForReport(reportId);
    await this.inEvent(caller, eventId, async ({ tx, agg, me }) => {
      const { snap, report } = this.findReport(agg, reportId);
      PaymentLedger.assertCanReverse({ recipientId: report.recipientMemberId, status: report.status, reversed: Boolean(report.reversal) }, me.id, agg.phase === "DONE", data.reason);
      if (snap.status !== "ACTIVE") throw new ConflictError("superseded", "This confirmation was carried into a revised bill and can't be changed (fix confirmation mistakes before starting a bill correction)");
      agg.machine.assertIn("SETTLING");
      await tx.paymentReversal.create({ data: { reportId, actorMemberId: me.id, reason: data.reason } });
      await this.audit(tx, eventId, me.id, "payment.verification_reversed", { reportId, amount: report.amountCentavos.toString() });
    });
  }

  /** Each counterparty picks a resolution; it takes effect only when both pick the same. */
  async chooseResolution(caller: Caller, disputeId: string, input: z.input<typeof disputeChoiceSchema>): Promise<{ status: string }> {
    const data = disputeChoiceSchema.parse(input);
    const eventId = await this.eventIdForDispute(disputeId);
    return this.inEvent(caller, eventId, async ({ tx, agg, me, by }) => {
      agg.machine.assertIn("SETTLING");
      const dispute = agg.record.snapshots.flatMap((s) => s.edges).flatMap((e) => e.disputes.map((d) => ({ d, e }))).find((x) => x.d.id === disputeId);
      if (!dispute) throw new NotFoundError("Dispute not found");
      const { d, e } = dispute;
      const side = e.fromMemberId === me.id ? "senderChoice" : e.toMemberId === me.id ? "recipientChoice" : null;
      if (!side) throw new PermissionError("not_counterparty", "Only the sender and recipient can resolve this");
      agg.guests.assertNoConflict(by, me, side === "senderChoice" ? e.toMemberId : e.fromMemberId);
      if (d.status !== "OPEN") throw new ConflictError("dispute_closed", "This dispute is no longer open");
      if (d.version !== data.expectedVersion) throw new ConflictError("stale_dispute", "The other person changed their answer, so reload and check");
      const next = { senderChoice: d.senderChoice, recipientChoice: d.recipientChoice, [side]: data.choice };
      const agreed = next.senderChoice && next.senderChoice === next.recipientChoice ? next.senderChoice : null;
      const status = agreed === "NO_TRANSFER" ? "RESOLVED" : agreed === "REPLACEMENT" ? "AWAITING_REPLACEMENT" : "OPEN";
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          [side]: data.choice,
          version: { increment: 1 },
          status,
          resolution: agreed,
          resolvedAt: status === "RESOLVED" ? new Date() : null,
        },
      });
      await this.audit(tx, eventId, me.id, "dispute.choice", { disputeId, choice: data.choice, status });
      return { status };
    });
  }
}
