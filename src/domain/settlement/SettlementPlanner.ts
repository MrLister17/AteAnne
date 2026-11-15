export interface TransferEdge {
  from: string;
  to: string;
  amount: bigint;
}

/**
 * Deterministic event-wide netting (spec "Reduce transfers without hiding the
 * source"): debtors and creditors are matched in stable participant order,
 * sending min(debt, credit) and advancing whichever side is exhausted.
 *
 * This settles every net exactly; it intentionally does NOT promise the
 * mathematically minimal number of transfers.
 */
export class SettlementPlanner {
  /** `balances` must be in stable participant order; positive = receive. */
  plan(balances: ReadonlyArray<readonly [string, bigint]>): TransferEdge[] {
    const total = balances.reduce((a, [, v]) => a + v, 0n);
    if (total !== 0n) throw new Error(`Invariant violated: nets sum to ${total}, not zero`);
    const debtors = balances.filter(([, v]) => v < 0n).map(([id, v]) => ({ id, left: -v }));
    const creditors = balances.filter(([, v]) => v > 0n).map(([id, v]) => ({ id, left: v }));
    const edges: TransferEdge[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = debtors[i].left < creditors[j].left ? debtors[i].left : creditors[j].left;
      edges.push({ from: debtors[i].id, to: creditors[j].id, amount });
      debtors[i].left -= amount;
      creditors[j].left -= amount;
      if (debtors[i].left === 0n) i++;
      if (creditors[j].left === 0n) j++;
    }
    return edges;
  }
}
