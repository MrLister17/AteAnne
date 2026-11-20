import type { Prisma } from "@/generated/prisma/client";
import { EventCalculation, EventLedger } from "@/domain/event/EventLedger";
import { Phase, PhaseMachine } from "@/domain/event/PhaseMachine";
import { LedgerDispute, LedgerReport, PaymentLedger } from "@/domain/payments/PaymentLedger";
import { ReconciliationResult, ReceiptReconciler } from "@/domain/receipt/ReceiptReconciler";
import type { ReceiptInput } from "@/domain/receipt/types";
import { PermissionError } from "@/domain/errors";
import { GuestPolicy } from "@/domain/event/GuestPolicy";
import { CorrectionLedger } from "@/domain/settlement/CorrectionLedger";
import { formatMinor } from "@/domain/money/Currency";
import { DayRates, ExchangeRate, rateFromDay } from "@/domain/fx/ExchangeRate";
import { receiptDay } from "../fx/RateService";
import { NotFoundError } from "../http/HttpError";
import type { EVENT_INCLUDE } from "./EventRepository";

type LoadedEvent = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;
export type CashRecord = Prisma.CashReportGetPayload<{ include: { reversal: true; dispute: true } }>;
/** One event as `EventRepository.load` returns it (cash reports carry their reversal and dispute). */
export type EventRecord = Omit<LoadedEvent, "cashReports"> & { cashReports: CashRecord[] };
export type MemberRecord = EventRecord["members"][number];
export type ReceiptRecord = EventRecord["receipts"][number];
export type SnapshotRecord = EventRecord["snapshots"][number];

/** A confirmed transfer, traceable to the report that confirmed it (D64: carried into statements exactly once). */
export interface SourcedTransfer {
  from: string;
  to: string;
  amount: bigint;
  source: "edge" | "cash";
  reportId: string;
}

export interface Gate {
  ready: boolean;
  blockers: string[];
}

export const MAX_MEMBERS = 20;
export const MAX_RECEIPTS = 25;
export const MAX_LINES = 50;
export const POLICY_VERSION = "ateanne-allocation-v2";
/** Frozen bills with at least one receipt converted from another currency (D58/D61). */
export const POLICY_VERSION_FX = "ateanne-allocation-v3";

/**
 * Aggregate root for one event. Wraps the loaded records and answers every
 * domain question about them — current claims, reconciliation, live
 * calculation, phase gates and settlement state — without touching the DB.
 */
export class EventAggregate {
  private readonly reconciler = new ReceiptReconciler();
  private readonly ledger = new EventLedger();
  private calcCache?: EventCalculation;

  /** `rates`: cached daily ECB tables for the days this event's foreign receipts were bought. */
  constructor(
    public readonly record: EventRecord,
    private readonly rates: ReadonlyMap<string, DayRates> = new Map(),
  ) {}

  get id(): string {
    return this.record.id;
  }

  /** Every share, balance and transfer is in this currency (D58). */
  get currency(): string {
    return this.record.currency;
  }

  /** The day a receipt was bought (its rate day, D61). */
  receiptDay(r: ReceiptRecord): string {
    return receiptDay(r);
  }

  /** Rate from a receipt's currency to the settle-up currency, for its purchase day; null when the same currency or not cached yet. */
  receiptRate(r: ReceiptRecord): ExchangeRate | null {
    if (r.currency === this.currency) return null;
    return rateFromDay(this.rates.get(this.receiptDay(r)), r.currency, this.currency);
  }

  /** Every currency used by a receipt here, settle-up currency first. */
  currenciesUsed(): string[] {
    return [...new Set([this.currency, ...this.record.receipts.map((r) => r.currency)])];
  }

  /**
   * Currencies a receiver takes (D58): what they ticked, or by default the
   * settle-up currency plus every receipt currency. The settle-up currency is
   * always accepted: it's the transfer's own currency.
   */
  acceptedCurrencies(ticked: readonly string[]): string[] {
    return ticked.length ? [...new Set([this.currency, ...ticked])] : this.currenciesUsed();
  }

  /** True once any receipt is converted (the frozen bill then uses policy v3). */
  hasForeignReceipts(): boolean {
    return this.record.receipts.some((r) => r.currency !== this.currency);
  }
  get phase(): Phase {
    return this.record.phase;
  }
  get machine(): PhaseMachine {
    return new PhaseMachine(this.record.phase);
  }

  // ---- membership & authority -------------------------------------------

  activeMembers(): MemberRecord[] {
    return this.record.members.filter((m) => m.active);
  }

  /** Stable participant order (join sequence) for ties and netting. */
  memberOrder(): string[] {
    return this.record.members.map((m) => m.id);
  }

  memberForActor(actorId: string): MemberRecord {
    const m = this.record.members.find((x) => x.actorId === actorId && x.active);
    if (!m) throw new NotFoundError("Event not found");
    return m;
  }

  member(memberId: string): MemberRecord {
    const m = this.record.members.find((x) => x.id === memberId);
    if (!m) throw new NotFoundError("Member not found");
    return m;
  }

  isOwner(memberId: string): boolean {
    return this.record.ownerMemberId === memberId;
  }

  get guests(): GuestPolicy {
    return new GuestPolicy(this.record.ownerMemberId);
  }

  /** Organizer, or an admin: may add guests and act for them. */
  canManageGuests(memberId: string): boolean {
    return this.guests.canManageGuests(this.member(memberId));
  }

  /**
   * The member a request acts as. Normally the caller; a manager may name a
   * guest instead. Throws unless that is allowed (see GuestPolicy).
   */
  subjectFor(by: MemberRecord, asMemberId: string | undefined): MemberRecord {
    if (!asMemberId || asMemberId === by.id) return by;
    const subject = this.record.members.find((x) => x.id === asMemberId);
    if (!subject) throw new NotFoundError("Member not found");
    this.guests.assertCanActFor(by, subject);
    return subject;
  }

  assertOwner(memberId: string): void {
    if (!this.isOwner(memberId)) throw new PermissionError("owner_only", "Only the organizer can do this");
  }

  assertNotCancelled(): void {
    if (this.record.cancelled) throw new PermissionError("event_cancelled", "This event was cancelled; expense and claim edits are closed");
  }

  receipt(receiptId: string): ReceiptRecord {
    const r = this.record.receipts.find((x) => x.id === receiptId);
    if (!r) throw new NotFoundError("Receipt not found");
    return r;
  }

  // ---- receipts ----------------------------------------------------------

  /** Domain input for a receipt, counting only claims for its current version. */
  receiptInput(r: ReceiptRecord): ReceiptInput {
    return {
      id: r.id,
      label: r.label,
      payerId: r.payerMemberId,
      payable: r.payableCentavos,
      ...(r.currency !== this.currency ? { conversion: { currency: r.currency, day: this.receiptDay(r), rate: this.receiptRate(r) } } : {}),
      ...(r.equalSplit ? { equalSplit: { memberIds: this.activeMembers().map((m) => m.id) } } : {}),
      lines: r.lines.map((l) => ({
        id: l.id,
        position: l.position,
        label: l.label,
        quantity: l.quantity,
        amount: l.amountCentavos,
        mode: l.mode,
        claims: l.claims.filter((c) => c.receiptVersion === r.version).map((c) => ({ memberId: c.memberId, units: c.units })),
      })),
      adjustments: r.adjustments.map((a) => ({
        id: a.id,
        position: a.position,
        kind: a.kind,
        label: a.label,
        amount: a.amountCentavos,
        eligibleLineIds: a.scopeAll ? "ALL" : a.eligibleLineIds,
      })),
    };
  }

  reconciliation(r: ReceiptRecord): ReconciliationResult {
    return this.reconciler.reconcile(this.receiptInput(r));
  }

  fundingAcknowledged(r: ReceiptRecord): boolean {
    return r.fundingAcks.some((f) => f.receiptVersion === r.version && f.amountCentavos === r.payableCentavos && f.memberId === r.payerMemberId);
  }

  currentAck(r: ReceiptRecord, memberId: string) {
    const ack = r.receiptAcks.find((a) => a.memberId === memberId);
    return ack && ack.receiptVersion === r.version ? ack : null;
  }

  /** True once the member has any financial reference (blocks hard removal). */
  memberReferenced(memberId: string): boolean {
    return this.record.receipts.some(
      (r) =>
        r.authorMemberId === memberId ||
        r.payerMemberId === memberId ||
        r.fundingAcks.some((f) => f.memberId === memberId) ||
        r.lines.some((l) => l.claims.some((c) => c.memberId === memberId)),
    ) || this.record.snapshots.length > 0
      || this.record.cashReports.some((c) => c.senderMemberId === memberId || c.recipientMemberId === memberId);
  }

  // ---- calculation -------------------------------------------------------

  calculation(): EventCalculation {
    if (!this.calcCache) {
      this.calcCache = this.ledger.calculate(this.record.receipts.map((r) => this.receiptInput(r)), this.memberOrder());
    }
    return this.calcCache;
  }

  // ---- phase gates -------------------------------------------------------

  /** Receipts are in: everyone said so, everything reconciles, payers confirmed. Part of freezeGate. */
  allocationGate(): Gate {
    const blockers: string[] = [];
    if (this.record.receipts.length === 0) blockers.push("Add at least one receipt.");
    for (const m of this.activeMembers()) if (!m.entryComplete) blockers.push(`${m.displayName} isn’t done adding receipts yet.`);
    for (const r of this.record.receipts) {
      const rec = this.reconciliation(r);
      for (const issue of rec.issues) blockers.push(`${r.label}: ${issue.message}`);
      const payer = this.member(r.payerMemberId);
      if (!payer.active) blockers.push(`${r.label}: the payer is no longer on the roster.`);
      if (!this.fundingAcknowledged(r)) blockers.push(`${r.label}: ${payer.displayName} has not confirmed paying ${formatMinor(r.payableCentavos, r.currency)}.`);
    }
    return { ready: blockers.length === 0, blockers };
  }

  /** Everyone answered every receipt and the split calculates. Part of freezeGate. */
  reviewGate(): Gate {
    const blockers: string[] = [];
    for (const r of this.record.receipts) {
      for (const m of this.activeMembers()) {
        if (!this.currentAck(r, m.id)) blockers.push(`${m.displayName} hasn’t claimed from “${r.label}” yet.`);
      }
      const stale = r.lines.flatMap((l) => l.claims).filter((c) => c.receiptVersion !== r.version);
      if (stale.length) blockers.push(`${r.label} changed; ${new Set(stale.map((c) => c.memberId)).size} member(s) must re-confirm their claims.`);
    }
    const calc = this.calculation();
    if (!calc.ok) for (const i of calc.issues) blockers.push(`${this.receipt(i.receiptId).label}: ${i.message}`);
    return { ready: blockers.length === 0, blockers };
  }

  approvalsForCurrentVersion(): Set<string> {
    return new Set(this.record.approvals.filter((a) => a.financialVersion === this.record.financialVersion).map((a) => a.memberId));
  }

  /**
   * Add & claim → Pay (freeze), D49/D50: the organizer closed the roster
   * ("Everyone's here") and everyone is done: receipts entered and confirmed by
   * their payers, every receipt answered by every person, the split calculates.
   * Claiming is the agreement; there is no separate approval round.
   */
  freezeGate(): Gate {
    const blockers: string[] = [];
    if (!this.record.rosterLockedAt) blockers.push("The organizer hasn’t tapped “Everyone’s here” yet.");
    blockers.push(...this.allocationGate().blockers, ...this.reviewGate().blockers, ...this.cashGate().blockers);
    const unique = [...new Set(blockers)];
    return { ready: unique.length === 0, blockers: unique };
  }

  // ---- settlement --------------------------------------------------------

  activeSnapshot(): SnapshotRecord | null {
    return this.record.snapshots.find((s) => s.status === "ACTIVE") ?? null;
  }

  /**
   * Every recipient-confirmed, non-reversed transfer: settlement-edge reports
   * across all statements plus event-level cash handoffs (D64). Applied to raw
   * receipt nets, never to an already-adjusted balance, so nothing counts twice.
   */
  confirmedTransfers(): SourcedTransfer[] {
    const edges = this.record.snapshots.flatMap((snap) => snap.edges.flatMap((edge) => edge.reports
      .filter((r) => r.status === "VERIFIED" && !r.reversal)
      .map((r) => ({ from: edge.fromMemberId, to: edge.toMemberId, amount: r.amountCentavos, source: "edge" as const, reportId: r.id }))));
    return [...edges, ...this.effectiveCash()];
  }

  // ---- event-level cash (D64) --------------------------------------------

  /** Confirmed, non-reversed cash handoffs. */
  effectiveCash(): SourcedTransfer[] {
    return this.record.cashReports
      .filter((c) => c.status === "VERIFIED" && !c.reversal)
      .map((c) => ({ from: c.senderMemberId, to: c.recipientMemberId, amount: c.amountCentavos, source: "cash" as const, reportId: c.id }));
  }

  cashReport(reportId: string): CashRecord {
    const c = this.record.cashReports.find((x) => x.id === reportId);
    if (!c) throw new NotFoundError("Payment not found");
    return c;
  }

  /** Cash reports awaiting the recipient, and cash disputes not yet resolved. */
  cashOutstanding(): { pending: CashRecord[]; disputed: CashRecord[] } {
    return {
      pending: this.record.cashReports.filter((c) => c.status === "REPORTED"),
      disputed: this.record.cashReports.filter((c) => c.dispute && c.dispute.status !== "RESOLVED"),
    };
  }

  hasCashOutstanding(): boolean {
    const o = this.cashOutstanding();
    return o.pending.length > 0 || o.disputed.length > 0;
  }

  /** Each member's effective cash sent − received (positive = handed over more than received). */
  cashNets(): Map<string, bigint> {
    const nets = new Map(this.record.members.map((m) => [m.id, 0n]));
    for (const t of this.effectiveCash()) {
      nets.set(t.from, (nets.get(t.from) ?? 0n) + t.amount);
      nets.set(t.to, (nets.get(t.to) ?? 0n) - t.amount);
    }
    return nets;
  }

  /** Blockers from cash that still needs a decision: they hold the freeze, a correction and Done. */
  cashGate(): Gate {
    const name = (id: string) => this.member(id).displayName;
    const { pending, disputed } = this.cashOutstanding();
    const blockers = [
      ...pending.map((c) => `${name(c.recipientMemberId)} hasn’t confirmed ${formatMinor(c.amountCentavos, this.currency)} from ${name(c.senderMemberId)} yet.`),
      ...disputed.map((c) => `${name(c.senderMemberId)} and ${name(c.recipientMemberId)} need to sort out the ${formatMinor(c.amountCentavos, this.currency)} payment.`),
    ];
    return { ready: blockers.length === 0, blockers };
  }

  /** Revised bill nets after all actual recipient-confirmed transfers, including older statements. */
  remainingNets(balances: ReadonlyArray<readonly [string, bigint]>) {
    return new CorrectionLedger().remaining(balances, this.confirmedTransfers());
  }

  correctionGate(): Gate {
    const blockers: string[] = [];
    for (const snap of this.record.snapshots) for (const edge of snap.edges) {
      if (edge.reports.some((r) => r.status === "REPORTED")) blockers.push("Confirm or cancel every pending payment report before correcting the bill.");
      if (edge.disputes.some((d) => d.status !== "RESOLVED")) blockers.push("Resolve every payment dispute before correcting the bill.");
    }
    if (this.hasCashOutstanding()) blockers.push("Confirm, reject or sort out every cash payment before correcting the bill.");
    return { ready: blockers.length === 0, blockers: [...new Set(blockers)] };
  }

  paymentLedger(snapshot: SnapshotRecord | null = this.activeSnapshot()): PaymentLedger | null {
    if (!snapshot) return null;
    const edges = snapshot.edges.map((e) => ({ id: e.id, from: e.fromMemberId, to: e.toMemberId, amount: e.amountCentavos }));
    const reports: LedgerReport[] = snapshot.edges.flatMap((e) =>
      e.reports.map((r) => ({ id: r.id, edgeId: e.id, amount: r.amountCentavos, status: r.status, reversed: Boolean(r.reversal) })),
    );
    const disputes: LedgerDispute[] = snapshot.edges.flatMap((e) =>
      e.disputes.map((d) => ({ edgeId: e.id, open: d.status !== "RESOLVED", awaitingReplacement: d.status === "AWAITING_REPLACEMENT" })),
    );
    return new PaymentLedger(edges, reports, disputes, this.currency);
  }

  /** Latest money event on the active statement; the daily job closes a paid event a day after it (D49). */
  lastSettlementActivity(): Date | null {
    const snap = this.activeSnapshot();
    if (!snap) return null;
    const times = [snap.createdAt];
    for (const c of this.record.cashReports) {
      times.push(c.createdAt);
      if (c.decidedAt) times.push(c.decidedAt);
      if (c.reversal) times.push(c.reversal.createdAt);
      if (c.dispute?.resolvedAt) times.push(c.dispute.resolvedAt);
    }
    for (const e of snap.edges) {
      for (const r of e.reports) {
        times.push(r.createdAt);
        if (r.decidedAt) times.push(r.decidedAt);
        if (r.reversal) times.push(r.reversal.createdAt);
      }
      for (const d of e.disputes) if (d.resolvedAt) times.push(d.resolvedAt);
    }
    return new Date(Math.max(...times.map((t) => t.getTime())));
  }

  /** Settling → Done. */
  doneGate(): Gate {
    const snapshot = this.activeSnapshot();
    if (!snapshot) return { ready: false, blockers: ["No frozen settlement."] };
    const name = (id: string) => this.member(id).displayName;
    const blockers: string[] = [];
    for (const s of this.paymentLedger(snapshot)!.edgeStates()) {
      const label = `${name(s.edge.from)} → ${name(s.edge.to)}`;
      if (s.pending > 0n) blockers.push(`${label}: ${formatMinor(s.pending, this.currency)} awaiting confirmation.`);
      if (s.disputed) blockers.push(`${label}: a rejected report is unresolved.`);
      if (s.outstanding > 0n) blockers.push(`${label}: ${formatMinor(s.outstanding, this.currency)} not yet confirmed received.`);
    }
    blockers.push(...this.cashGate().blockers);
    const remaining = this.remainingNets(snapshot.shares.map((s) => [s.memberId, s.netCentavos] as const));
    for (const [id, amount] of remaining) if (amount !== 0n) blockers.push(`${name(id)}: a non-zero balance remains.`);
    return { ready: blockers.length === 0, blockers };
  }
}

export function fmt(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(a % 100n).toString().padStart(2, "0")}`;
}
