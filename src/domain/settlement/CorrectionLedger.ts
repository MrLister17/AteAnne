import { SettlementPlanner } from "./SettlementPlanner";

export interface ConfirmedTransfer {
  from: string;
  to: string;
  amount: bigint;
}

/** Carry actual confirmed money into a revised bill, without rewriting its history. */
export class CorrectionLedger {
  remaining(balances: ReadonlyArray<readonly [string, bigint]>, transfers: readonly ConfirmedTransfer[]): Map<string, bigint> {
    const remaining = new Map(balances);
    for (const transfer of transfers) {
      if (!remaining.has(transfer.from) || !remaining.has(transfer.to)) throw new Error("Confirmed payment references someone outside the roster");
      if (transfer.amount <= 0n) throw new Error("Confirmed payment amount must be positive");
      remaining.set(transfer.from, remaining.get(transfer.from)! + transfer.amount);
      remaining.set(transfer.to, remaining.get(transfer.to)! - transfer.amount);
    }
    if ([...remaining.values()].reduce((a, n) => a + n, 0n) !== 0n) throw new Error("Corrected balances must conserve money");
    return remaining;
  }

  plan(balances: ReadonlyArray<readonly [string, bigint]>, transfers: readonly ConfirmedTransfer[]) {
    return new SettlementPlanner().plan([...this.remaining(balances, transfers)]);
  }
}
