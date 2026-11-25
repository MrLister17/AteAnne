"use client";

import { Icon } from "../components/Icon";
import { Avatar, BalanceBanner, Card, Disclosure, Notice, SectionTitle, balanceLabel } from "../components/ui";
import { shortDay } from "@/domain/money/Currency";
import { useEvent } from "./EventContext";
import { signed } from "../format";
import { SettlementSection } from "./SettlementSection";
import { NextCard } from "./NextCard";
import { CurrencySwitch } from "./CurrencySwitch";
import { CashPayments } from "./CashPayments";

type ShareLike = { memberId: string; lines: Record<string, string>; discounts: Record<string, string>; charges: Record<string, string>; itemsGross: string; discountTotal: string; chargeTotal: string; total: string };
/** `currency` is the receipt's own (absent in statements frozen before v0.9: the event's); `settleShares` in the settle-up currency. */
type ReceiptLike = {
  id: string;
  label: string;
  payerId: string;
  payable: string;
  currency?: string;
  purchasedOn?: string;
  rate?: { base: string; quote: string; rate: string; date: string } | null;
  settlePayable?: string | null;
  settleShares?: Record<string, string>;
  lines: { id: string; label: string; quantity: number; amount: string; mode: string }[];
  adjustments: { id: string; kind: string; label: string; amount: string; scopeAll: boolean }[];
};

export function MoneyTab() {
  const { view, me, shown, moneyAbs, viewRate } = useEvent();
  const frozen = view.settlement;

  if (!frozen && !view.calculation.ok) {
    return (
      <div className="space-y-3">
        <Header />
        <Notice tone="info" title="No split yet">
          Your share appears once everyone has claimed what they had. The bill freezes by itself once everyone is done.
        </Notice>
        <PaymentHistory />
        <PolicyNote />
      </div>
    );
  }

  if (frozen) {
    const facts = frozen.facts as { currency?: string; receipts: (ReceiptLike & { shares: ShareLike[] })[] };
    return (
      <div className="space-y-3">
        <Header />
        <CurrencySwitch />
        {(frozen.facts as { revision?: { reason: string } }).revision && (
          <Notice tone="info" title={(frozen.facts as { revision: { reason: string } }).revision.reason === "cash_reversed" ? "Payment plan updated" : "Cash payment included"}>
            {(frozen.facts as { revision: { reason: string } }).revision.reason === "cash_reversed" ? "A cash confirmation was undone, so the remaining transfers were updated." : "Confirmed cash was included and the remaining transfers were updated."}
          </Notice>
        )}
        <NextCard where="pay" />
        <SettlementSection />
        <CashPayments where={view.event.phase === "DONE" ? "done" : "pay"} />
        <Everyone positions={frozen.positions} />
        <Disclosure summary="Your share" icon="receipt" className="card px-4 py-0">
          <Breakdown receipts={facts.receipts} sharesFor={(rid) => facts.receipts.find((r) => r.id === rid)?.shares ?? []} />
        </Disclosure>
        <PaymentHistory />
        <PolicyNote />
      </div>
    );
  }

  // Still in "Add & claim": an estimate that can change until everyone is done (no approval round, D50).
  const pos = view.calculation.positions.find((p) => p.memberId === me.memberId)!;
  const receipts: ReceiptLike[] = view.receipts.map((r) => {
    const st = view.calculation.receipts.find((x) => x.receiptId === r.id);
    return { id: r.id, label: r.label, payerId: r.payerId, payable: r.payable, currency: r.currency, purchasedOn: r.purchasedOn, rate: st?.rate ?? r.rate, settlePayable: st?.settlePayable ?? r.settlePayable, settleShares: st?.settleShares, lines: r.lines, adjustments: r.adjustments };
  });
  return (
    <div className="space-y-3">
      <Header />
      <BalanceBanner
        net={pos.remaining}
        estimate
        display={shown(pos.remaining, { abs: true })}
        exact={viewRate ? moneyAbs(pos.remaining) : undefined}
      />
      <CurrencySwitch />
      <Everyone positions={view.calculation.positions} />
      <Disclosure summary="Your share" icon="receipt" className="card px-4 py-0">
        <Breakdown receipts={receipts} sharesFor={(rid) => view.calculation.receipts.find((x) => x.receiptId === rid)?.shares ?? []} />
      </Disclosure>
      <ProposedTransfers />
      <PaymentHistory />
      <PolicyNote />
    </div>
  );
}

function Header() {
  const { view } = useEvent();
  return (
    <div className="flex items-center gap-3 px-1">
      <h2 className="text-[22px] font-bold">{view.event.phase === "SETTLING" ? "Pay" : "Summary"}</h2>
      {view.settlement && (
        <span className="inline-flex items-center gap-1 text-[13px] text-muted">
          <Icon name="lock" size={14} /> Frozen
        </span>
      )}
      {view.paymentHistory.length > 0 && <span className="ml-auto text-right text-[13px] text-muted">Earlier payments are included</span>}
    </div>
  );
}

function PaymentHistory() {
  const { view, name, money } = useEvent();
  if (!view.paymentHistory.length) return null;
  return (
    <Disclosure summary={`Earlier payments (${view.paymentHistory.length})`} icon="clock" className="card px-4 py-0 text-[14px]">
      <p className="text-muted">Confirmed payments carry forward into this bill. Revised transfers can include money to return. Prior statements and reports are also available in your export.</p>
      <ul className="divide-y divide-line">
        {view.paymentHistory.map((r) => (
          <li key={r.id} className="py-3">
            <p>
              {name(r.from)} → {name(r.to)} · <b>{money(r.amount)}</b>
              {r.paid && <span className="text-muted"> (sent {money(r.paid.amount, r.paid.currency)})</span>}
            </p>
            <p className="text-muted">Version {r.financialVersion} · {r.reversal ? "Confirmation reversed — not counted" : r.status === "VERIFIED" ? "Confirmed received — included in this bill" : r.status === "CANCELLED" ? "Report cancelled — not counted" : "Rejected — not counted"}</p>
            {r.reversal && <p>Reason: {r.reversal.reason}</p>}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** Every peso of my share, explained: item shares, discounts, charge basis. */
function Breakdown({ receipts, sharesFor }: { receipts: ReceiptLike[]; sharesFor: (receiptId: string) => ShareLike[] }) {
  const { me, name, money, currency, view } = useEvent();
  const frozenCurrency = (view.settlement?.facts as { currency?: string } | undefined)?.currency ?? currency;
  return (
    <div className="space-y-2">
      {receipts.map((r) => {
        const ccy = r.currency ?? frozenCurrency;
        const php = (v: string | bigint) => money(v, ccy);
        const foreign = ccy !== currency;
        const mySettle = foreign ? r.settleShares?.[me.memberId] : undefined;
        const shares = sharesFor(r.id);
        const mine = shares.find((s) => s.memberId === me.memberId);
        const paidByMe = r.payerId === me.memberId;
        const myLines = r.lines.filter((l) => mine?.lines[l.id] && mine.lines[l.id] !== "0");
        const basisTotal = shares.reduce((a, s) => a + BigInt(s.itemsGross) - BigInt(s.discountTotal), 0n);
        const myBasis = mine ? BigInt(mine.itemsGross) - BigInt(mine.discountTotal) : 0n;
        return (
          <details key={r.id} className="card group/receipt p-0">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 font-semibold break-words">{r.label}</span>
              <span className="tnum text-right font-bold">
                {php(mine?.total ?? "0")}
              </span>
              <Icon name="chevron" size={18} className="shrink-0 text-muted transition-transform group-open/receipt:rotate-90" />
            </summary>
            <div className="space-y-2 border-t border-line px-3 py-3 text-[15px]">
              <p className="text-[13px] text-muted">
                {paidByMe ? `You paid ${php(r.payable)}` : `${name(r.payerId)} paid ${php(r.payable)}`}
                {foreign && r.rate && <span className="block">1 {r.rate.base} = {r.rate.rate} {r.rate.quote} ({shortDay(r.rate.date)})</span>}
              </p>
              {!mine || mine.total === "0" ? (
                <p className="text-muted">You had nothing from this receipt — your share is {php(0n)}{paidByMe ? `, and you get back the full ${php(r.payable)} from others` : ""}.</p>
              ) : (
                <ul className="tnum space-y-1.5">
                  {myLines.map((l) => {
                    const sharedWith = shares.filter((s) => s.lines[l.id] && s.lines[l.id] !== "0").length;
                    return (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          {l.label}
                          <span className="block text-[13px] text-muted">{sharedWith > 1 ? `${php(l.amount)} ${l.mode === "UNITS" ? "by pieces" : `÷ ${sharedWith} people`}` : "just you"}</span>
                        </span>
                        <span>{php(mine.lines[l.id])}</span>
                      </li>
                    );
                  })}
                  {r.adjustments.map((a) => {
                    const amt = a.kind === "DISCOUNT" ? mine.discounts[a.id] : mine.charges[a.id];
                    if (!amt || amt === "0") return null;
                    return (
                      <li key={a.id} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          {a.label}
                          {a.kind !== "DISCOUNT" && a.scopeAll && basisTotal > 0n && (
                            <span className="block text-[13px] text-muted">
                              {php(a.amount)} × your {php(myBasis)} ÷ {php(basisTotal)} spending
                            </span>
                          )}
                        </span>
                        <span className={a.kind === "DISCOUNT" ? "text-receive" : ""}>
                          {a.kind === "DISCOUNT" ? "−" : "+"}
                          {php(amt)}
                        </span>
                      </li>
                    );
                  })}
                  <li className="flex justify-between border-t border-line pt-1.5 font-bold">
                    <span>Your share</span>
                    <span>{php(mine.total)}</span>
                  </li>
                </ul>
              )}
              {foreign && mySettle !== undefined && (
                <p className="tnum flex justify-between gap-2 text-[14px] text-muted">
                  <span>Your share in {currency}</span>
                  <span>{money(mySettle)}</span>
                </p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function Everyone({ positions }: { positions: { memberId: string; funding: string; cost: string; net: string; remaining: string }[] }) {
  const { name, seq, me, shown, moneyAbs, viewRate } = useEvent();
  return (
    <>
      <SectionTitle>Everyone</SectionTitle>
      <Card className="!p-0">
        <ul className="divide-y divide-line">
          {positions.map((p) => {
            const b = balanceLabel(p.remaining);
            return (
              <li key={p.memberId}>
                <details className="group">
                  <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-3 py-2 min-[375px]:grid-cols-[auto_minmax(0,1fr)_auto_auto] [&::-webkit-details-marker]:hidden">
                    <span className="row-span-2 min-[375px]:row-span-1">
                      <Avatar name={name(p.memberId)} seq={seq(p.memberId)} size={30} />
                    </span>
                    <span className="min-w-0 font-semibold break-words">
                      {name(p.memberId)}
                      {p.memberId === me.memberId && <span className="font-normal text-muted"> (you)</span>}
                    </span>
                    <span className={`tnum col-start-2 row-start-2 flex flex-wrap items-baseline gap-x-2 min-[375px]:col-start-3 min-[375px]:row-start-1 min-[375px]:block min-[375px]:text-right ${b.tone === "receive" ? "text-receive" : b.tone === "pay" ? "text-pay" : "text-muted"}`}>
                      <span className="block font-bold">{signed(b.sign, shown(p.remaining, { abs: true }))}</span>
                      <span className="block text-[12px]">{b.tone === "neutral" ? "Settled" : b.tone === "receive" ? "To receive" : "To pay"}</span>
                    </span>
                    <Icon name="chevron" size={16} className="col-start-3 row-span-2 row-start-1 text-muted transition-transform group-open:rotate-90 min-[375px]:col-start-4 min-[375px]:row-span-1" />
                  </summary>
                  <dl className="tnum grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-t border-line px-4 py-2 text-[13px] text-muted">
                    <dt>Paid for expenses</dt>
                    <dd className="text-right">{shown(p.funding)}</dd>
                    <dt>Share of expenses</dt>
                    <dd className="text-right">{shown(p.cost)}</dd>
                    {p.net !== p.remaining && (
                      <>
                        <dt>Before payments</dt>
                        <dd className="text-right">{shown(p.net)}</dd>
                      </>
                    )}
                    {viewRate && (
                      <>
                        <dt>Exact balance</dt>
                        <dd className="text-right">{signed(b.sign, moneyAbs(p.remaining))}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function ProposedTransfers() {
  const { view, name, money } = useEvent();
  if (!view.calculation.ok) return null;
  return (
    <>
      <SectionTitle>Proposed transfers</SectionTitle>
      <Card className="space-y-2">
        {view.calculation.edges.length === 0 ? (
          <p className="text-muted">Nobody owes anybody after confirmed payments.</p>
        ) : (
          view.calculation.edges.map((e, i) => (
            <p key={i} className="tnum flex items-center gap-2">
              <b>{name(e.from)}</b> <Icon name="chevron" size={16} className="text-muted" /> <b>{name(e.to)}</b>
              <span className="ml-auto font-bold">{money(e.amount)}</span>
            </p>
          ))
        )}
        <Disclosure summary="How transfers are grouped" icon="info">
          <p className="text-[13px] text-muted">Debts are combined across all receipts to keep transfers few. Each transfer settles part of the event balance.</p>
        </Disclosure>
      </Card>
    </>
  );
}

function PolicyNote() {
  const { view } = useEvent();
  const statementVersion = view.settlement?.financialVersion ?? view.event.financialVersion;
  return (
    <Disclosure summary="How Hatian splits money" icon="info" className="card px-4 py-0 text-[14px]">
      <p className="text-muted">{view.settlement ? "Frozen statement" : "Live estimate"} · Version {statementVersion}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>Each item is split only among the people who claimed it — equally, or by pieces.</li>
        <li>Discounts reduce only the items they apply to, in proportion to their value.</li>
        <li>Service and other charges follow each person’s item spending after discounts. No spending, no service charge.</li>
        <li>Amounts use the currency’s smallest unit. Leftover units go to the largest remainders, with ties settled by join order.</li>
        <li>Your starting balance is what you paid for expenses minus your share. Your balance includes confirmed payments. Money you get back for expenses is reimbursement.</li>
        <li>A receipt in another currency is split in its own currency, then converted once at the ECB rate of the day it was bought and split the same way, so it still adds up exactly. The rates are fixed when the bill freezes.</li>
        <li>Paying in another currency uses the ECB rate on the day you send it, locked into that payment.</li>
      </ul>
    </Disclosure>
  );
}
