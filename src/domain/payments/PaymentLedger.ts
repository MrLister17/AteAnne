import { ConflictError, PermissionError, ValidationError } from "../errors";

export type ReportStatus = "REPORTED" | "VERIFIED" | "REJECTED" | "CANCELLED";

export interface LedgerEdge {
  id: string;
  from: string;
  to: string;
  amount: bigint;
}

export interface LedgerReport {
  id: string;
  edgeId: string;
  amount: bigint;
  status: ReportStatus;
  /** True once the recipient appended a verification reversal. */
  reversed: boolean;
}

export interface LedgerDispute {
  edgeId: string;
  open: boolean;
  /** Replacement for the rejected report agreed by both sides, if any. */
  awaitingReplacement: boolean;
}

export interface EdgeState {
  edge: LedgerEdge;
  /** Recipient-confirmed and not reversed. */
  verified: bigint;
  /** Reported, awaiting the recipient. Reserves capacity, no verified effect. */
  pending: bigint;
  /** edge.amount − verified. */
  outstanding: bigint;
  /** outstanding − pending: the most a new report may claim. */
  capacity: bigint;
  disputed: boolean;
  settled: boolean;
}

/**
 * Read-model and rules for the settlement phase. Pure: given frozen edges and
 * the immutable report history, it derives verified/pending/outstanding per
 * edge and remaining nets, and decides whether an action is allowed.
 *
 * Rᵢ = Nᵢ + confirmed outbound − confirmed inbound (reversals undo one
 * confirmation). Pending, rejected and cancelled reports have no effect.
 */
export class PaymentLedger {
  constructor(
    private readonly edges: readonly LedgerEdge[],
    private readonly reports: readonly LedgerReport[],
    private readonly disputes: readonly LedgerDispute[] = [],
  ) {}

  edgeStates(): EdgeState[] {
    return this.edges.map((edge) => {
      let verified = 0n;
      let pending = 0n;
      for (const r of this.reports) {
        if (r.edgeId !== edge.id) continue;
        if (r.status === "VERIFIED" && !r.reversed) verified += r.amount;
        if (r.status === "REPORTED") pending += r.amount;
      }
      const outstanding = edge.amount - verified;
      if (outstanding < 0n) throw new Error(`Invariant violated: edge ${edge.id} over-settled`);
      const disputed = this.disputes.some((d) => d.edgeId === edge.id && d.open);
      return { edge, verified, pending, outstanding, capacity: outstanding - pending, disputed, settled: outstanding === 0n };
    });
  }

  edgeState(edgeId: string): EdgeState {
    const s = this.edgeStates().find((e) => e.edge.id === edgeId);
    if (!s) throw new ValidationError("unknown_edge", "Unknown transfer");
    return s;
  }

  remainingNets(initial: ReadonlyMap<string, bigint>): Map<string, bigint> {
    const result = new Map(initial);
    for (const s of this.edgeStates()) {
      result.set(s.edge.from, (result.get(s.edge.from) ?? 0n) + s.verified);
      result.set(s.edge.to, (result.get(s.edge.to) ?? 0n) - s.verified);
    }
    let total = 0n;
    for (const v of result.values()) total += v;
    if (total !== 0n) throw new Error("Invariant violated: remaining nets do not sum to zero");
    return result;
  }

  // ---- rules -------------------------------------------------------------

  assertCanReport(edgeId: string, senderId: string, amount: bigint, opts: { isAgreedReplacement?: boolean } = {}): void {
    const s = this.edgeState(edgeId);
    if (s.edge.from !== senderId) throw new PermissionError("not_sender", "Only the named sender can report this transfer");
    if (amount <= 0n) throw new ValidationError("amount_not_positive", "Report a positive amount");
    const dispute = this.disputes.find((d) => d.edgeId === edgeId && d.open);
    if (dispute && !(opts.isAgreedReplacement && dispute.awaitingReplacement)) {
      throw new ConflictError("edge_disputed", "Resolve this before paying again");
    }
    if (amount > s.capacity) {
      throw new ConflictError("over_report", `At most PHP ${fmt(s.capacity)} can be reported on this transfer right now`, {
        capacity: s.capacity.toString(),
      });
    }
  }

  static assertCanDecide(report: { recipientId: string; status: ReportStatus }, actorId: string): "noop" | "proceed" {
    if (report.recipientId !== actorId) throw new PermissionError("not_recipient", "Only the named recipient can confirm or reject");
    if (report.status !== "REPORTED") throw new ConflictError("not_pending", "Only a pending report can be confirmed or rejected");
    return "proceed";
  }

  static assertCanReverse(report: { recipientId: string; status: ReportStatus; reversed: boolean }, actorId: string, eventDone: boolean, reason: string): void {
    if (eventDone) throw new ConflictError("event_done", "Done events are immutable");
    if (report.status !== "VERIFIED") throw new ConflictError("not_verified", "Only verified payment records can be reversed");
    if (report.recipientId !== actorId) throw new PermissionError("not_recipient", "Only the original recipient can authorize reversal");
    if (report.reversed) throw new ConflictError("already_reversed", "A verification can be reversed only once");
    if (reason.trim().length < 3) throw new ValidationError("reason_required", "A reason is required");
  }

  /** Done requires every edge fully verified, nothing pending, no open disputes. */
  completionBlockers(): string[] {
    const blockers: string[] = [];
    for (const s of this.edgeStates()) {
      if (s.outstanding > 0n) blockers.push(`edge:${s.edge.id}:outstanding`);
      if (s.pending > 0n) blockers.push(`edge:${s.edge.id}:pending`);
      if (s.disputed) blockers.push(`edge:${s.edge.id}:disputed`);
    }
    return blockers;
  }
}

function fmt(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${(a / 100n).toLocaleString("en-PH")}.${(a % 100n).toString().padStart(2, "0")}`;
}
