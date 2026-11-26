import type { ExchangeRate } from "../fx/ExchangeRate";
import { shortDay } from "../money/Currency";
import { ReceiptCalculator } from "../receipt/ReceiptCalculator";
import { ReceiptConverter } from "../receipt/ReceiptConverter";
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
  /** In the receipt's own currency. */
  payable: bigint;
  /** In the receipt's own currency. */
  shares: Map<string, MemberReceiptShare>;
  /** The rate used to reach the settle-up currency; null when the receipt is already in it. */
  rate: ExchangeRate | null;
  /** Payable in the settle-up currency (= payable when rate is null). */
  settlePayable: bigint;
  /** Each person's total share in the settle-up currency; Σ = settlePayable. */
  settleShares: Map<string, bigint>;
}

export type EventCalculation =
  | { ok: true; positions: MemberPosition[]; receipts: ReceiptStatement[]; edges: TransferEdge[] }
  | { ok: false; issues: CalculationIssue[] };

/**
 * Aggregates every receipt in an event into per-member funding, cost and net
 * (in the settle-up currency: receipts in other currencies are converted at
 * the rate of the day they were bought, D61),
 * checks conservation (Σ funding = Σ cost, Σ net = 0) and proposes the
 * deterministic transfer edges.
 */
export class EventLedger {
  constructor(
    private readonly calculator = new ReceiptCalculator(),
    private readonly planner = new SettlementPlanner(),
    private readonly converter = new ReceiptConverter(),
  ) {}

  calculate(receipts: readonly ReceiptInput[], memberOrder: readonly string[]): EventCalculation {
    const issues: CalculationIssue[] = [];
    const statements: ReceiptStatement[] = [];
    for (const receipt of receipts) {
      const result = this.calculator.calculate(receipt, memberOrder);
      if (!result.ok) {
        issues.push(...result.issues);
        continue;
      }
      const conversion = receipt.conversion;
      if (conversion && !conversion.rate) {
        issues.push({ code: "RATE_UNAVAILABLE", receiptId: receipt.id, message: `Waiting for the ${shortDay(conversion.day)} ${conversion.currency} exchange rate` });
        continue;
      }
      const rate = conversion?.rate ?? null;
      const settle = this.converter.convert(receipt.payable, result.shares, memberOrder, rate);
      statements.push({
        receiptId: receipt.id,
        label: receipt.label,
        payerId: receipt.payerId,
        payable: receipt.payable,
        shares: result.shares,
        rate,
        settlePayable: settle.payable,
        settleShares: settle.shares,
      });
    }
    if (issues.length) return { ok: false, issues };

    const positions = new Map<string, MemberPosition>(memberOrder.map((id) => [id, { memberId: id, funding: 0n, cost: 0n, net: 0n }]));
    for (const st of statements) {
      const payer = positions.get(st.payerId);
      if (!payer) throw new Error(`Receipt ${st.receiptId} payer is not on the roster`);
      payer.funding += st.settlePayable;
      for (const [memberId, total] of st.settleShares) {
        const p = positions.get(memberId);
        if (!p) throw new Error(`Receipt ${st.receiptId} allocates to a non-roster member`);
        p.cost += total;
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
