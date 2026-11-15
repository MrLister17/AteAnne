import { ReceiptCalculator } from "../receipt/ReceiptCalculator";
import { CalculationIssue, MemberReceiptShare, ReceiptInput } from "../receipt/types";
import { SettlementPlanner, TransferEdge } from "../settlement/SettlementPlanner";

export interface MemberPosition {
  memberId: string;
  /** Fᵢ — money actually paid to merchants. */
  funding: bigint;
  /** Cᵢ — allocated items − discounts + charges. */
  cost: bigint;
  /** Nᵢ = Fᵢ − Cᵢ (positive = net to receive). */
  net: bigint;
}

export interface ReceiptStatement {
  receiptId: string;
  label: string;
  payerId: string;
  payable: bigint;
  shares: Map<string, MemberReceiptShare>;
}

export type EventCalculation =
  | { ok: true; positions: MemberPosition[]; receipts: ReceiptStatement[]; edges: TransferEdge[] }
  | { ok: false; issues: CalculationIssue[] };

/**
 * Aggregates every receipt in an event into per-member funding, cost and net,
 * checks conservation (Σ funding = Σ cost, Σ net = 0) and proposes the
 * deterministic transfer edges.
 */
export class EventLedger {
  constructor(
    private readonly calculator = new ReceiptCalculator(),
    private readonly planner = new SettlementPlanner(),
  ) {}

  calculate(receipts: readonly ReceiptInput[], memberOrder: readonly string[]): EventCalculation {
    const issues: CalculationIssue[] = [];
    const statements: ReceiptStatement[] = [];
    for (const receipt of receipts) {
      const result = this.calculator.calculate(receipt, memberOrder);
      if (!result.ok) issues.push(...result.issues);
      else statements.push({ receiptId: receipt.id, label: receipt.label, payerId: receipt.payerId, payable: receipt.payable, shares: result.shares });
    }
    if (issues.length) return { ok: false, issues };

    const positions = new Map<string, MemberPosition>(memberOrder.map((id) => [id, { memberId: id, funding: 0n, cost: 0n, net: 0n }]));
    for (const st of statements) {
      const payer = positions.get(st.payerId);
      if (!payer) throw new Error(`Receipt ${st.receiptId} payer is not on the roster`);
      payer.funding += st.payable;
      for (const share of st.shares.values()) {
        const p = positions.get(share.memberId);
        if (!p) throw new Error(`Receipt ${st.receiptId} allocates to a non-roster member`);
        p.cost += share.total;
      }
    }
    let funding = 0n;
    let cost = 0n;
    for (const p of positions.values()) {
      p.net = p.funding - p.cost;
      funding += p.funding;
      cost += p.cost;
    }
    if (funding !== cost) throw new Error("Invariant violated: funding ≠ cost");
    const ordered = memberOrder.map((id) => positions.get(id)!);
    const edges = this.planner.plan(ordered.map((p) => [p.memberId, p.net] as const));
    return { ok: true, positions: ordered, receipts: statements, edges };
  }
}
