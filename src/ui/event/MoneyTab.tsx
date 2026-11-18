"use client";

import { api } from "../api";
import { Icon } from "../components/Icon";
import { Avatar, BalanceBanner, Blockers, Button, Card, Notice, SectionTitle, balanceLabel } from "../components/ui";
import { php, phpAbs } from "../format";
import { useAction, useEvent } from "./EventContext";
import { SettlementSection } from "./SettlementSection";

type ShareLike = { memberId: string; lines: Record<string, string>; discounts: Record<string, string>; charges: Record<string, string>; itemsGross: string; discountTotal: string; chargeTotal: string; total: string };
type ReceiptLike = { id: string; label: string; payerId: string; payable: string; lines: { id: string; label: string; quantity: number; amount: string; mode: string }[]; adjustments: { id: string; kind: string; label: string; amount: string; scopeAll: boolean }[] };

export function MoneyTab() {
  const { view, me, event } = useEvent();
  const frozen = view.settlement;

  if (event.phase === "COLLECTING" || (event.phase === "ALLOCATING" && !view.calculation.ok)) {
    return (
      <div className="space-y-3">
        <Header />
        <Notice tone="info" title="No split yet">
          Your share appears once everyone has claimed their items. Nothing here is final until everyone approves and the organizer freezes it.
        </Notice>
        {view.calculation.issues.length > 0 && event.phase === "ALLOCATING" && <Blockers items={view.calculation.issues} title="Waiting on claims" />}
      </div>
    );
  }

  if (frozen) {
    const facts = frozen.facts as { receipts: (ReceiptLike & { shares: ShareLike[] })[] };
    return (
      <div className="space-y-3">
        <Header />
        <SettlementSection />
        <SectionTitle>Where your share came from</SectionTitle>
        <Breakdown receipts={facts.receipts} sharesFor={(rid) => facts.receipts.find((r) => r.id === rid)?.shares ?? []} />
        <Everyone positions={frozen.positions} frozen />
        <PolicyNote />
      </div>
    );
  }

  // Allocating (estimate) or Reviewing (approval).
  const pos = view.calculation.positions.find((p) => p.memberId === me.memberId)!;
  const receipts: ReceiptLike[] = view.receipts.map((r) => ({ id: r.id, label: r.label, payerId: r.payerId, payable: r.payable, lines: r.lines, adjustments: r.adjustments }));
  return (
    <div className="space-y-3">
      <Header />
      <BalanceBanner net={pos.remaining} estimate={event.phase !== "REVIEWING"} caption={`Paid ${php(pos.funding)} − your share ${php(pos.cost)} · confirmed payments included`} />
      {event.phase === "REVIEWING" && <ApprovalCard />}
      <SectionTitle>Your share, line by line</SectionTitle>
      <Breakdown receipts={receipts} sharesFor={(rid) => view.calculation.receipts.find((x) => x.receiptId === rid)?.shares ?? []} />
      <Everyone positions={view.calculation.positions} />
      <ProposedTransfers />
      <PolicyNote />
    </div>
  );
}

function Header() {
  const { view } = useEvent();
  return (
    <div className="px-1">
      <h2 className="text-[22px] font-bold">Money</h2>
      <p className="text-[14px] text-muted">
        {view.settlement ? `Frozen statement · version ${view.settlement.financialVersion}` : `Version ${view.event.financialVersion} · server-calculated, to the centavo`}
      </p>
      {view.paymentHistory.length > 0 && (
        <>
          <Notice tone="info" title="Earlier payments are included">
            Confirmed money carries forward into this bill. Revised transfers can include money to return. Prior statements and reports stay in the history below and in your export.
          </Notice>
          <PaymentHistory />
        </>
      )}
    </div>
  );
}

function PaymentHistory() {
  const { view, name } = useEvent();
  return (
    <details className="card my-3 text-[14px]">
      <summary className="min-h-11 cursor-pointer font-semibold">Payment history from prior statements</summary>
      <ul className="divide-y divide-line">
        {view.paymentHistory.map((r) => (
          <li key={r.id} className="py-3">
            <p>{name(r.from)} → {name(r.to)} · <b>{php(r.amount)}</b></p>
            <p className="text-muted">Version {r.financialVersion} · {r.reversal ? "Confirmation reversed — not counted" : r.status === "VERIFIED" ? "Confirmed received — included in this bill" : r.status === "CANCELLED" ? "Report cancelled — not counted" : "Rejected — not counted"}</p>
            {r.reversal && <p>Reason: {r.reversal.reason}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ApprovalCard() {
  const { view, event, name } = useEvent();
  const act = useAction();
  const approved = new Set(view.review.approvals);
  const active = view.members.filter((m) => m.active);
  const blockers = view.gates.reviewing?.blockers ?? [];
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-bold">Approve version {event.financialVersion}</p>
        <span className="tnum text-[14px] text-muted">
          {approved.size}/{active.length} approved
        </span>
      </div>
      <p className="text-[14px] text-muted">You are approving the exact amounts below. If anything changes, every approval resets and everyone checks again.</p>
      <Blockers items={blockers} />
      {view.review.approvedByMe ? (
        <Notice tone="receive">You approved this version.</Notice>
      ) : (
        <Button full icon="check" disabled={blockers.length > 0 || event.cancelled} onClick={() => act(() => api.post(`/api/events/${event.id}/review`, { financialVersion: event.financialVersion }), "Approved")}>
          I agree with this split
        </Button>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {active.map((m) => (
          <li key={m.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold ${approved.has(m.id) ? "bg-receive-soft text-receive" : "bg-surface-2 text-muted"}`}>
            {approved.has(m.id) ? <Icon name="check" size={14} /> : <Icon name="clock" size={14} />}
            {name(m.id)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Every peso of my share, explained: item shares, discounts, charge basis. */
function Breakdown({ receipts, sharesFor }: { receipts: ReceiptLike[]; sharesFor: (receiptId: string) => ShareLike[] }) {
  const { me, name } = useEvent();
  return (
    <div className="space-y-2">
      {receipts.map((r) => {
        const shares = sharesFor(r.id);
        const mine = shares.find((s) => s.memberId === me.memberId);
        const paidByMe = r.payerId === me.memberId;
        const myLines = r.lines.filter((l) => mine?.lines[l.id] && mine.lines[l.id] !== "0");
        const basisTotal = shares.reduce((a, s) => a + BigInt(s.itemsGross) - BigInt(s.discountTotal), 0n);
        const myBasis = mine ? BigInt(mine.itemsGross) - BigInt(mine.discountTotal) : 0n;
        return (
          <details key={r.id} className="card group overflow-hidden p-0" open={receipts.length <= 2}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.label}</p>
                <p className="text-[13px] text-muted">
                  {paidByMe ? `You paid ${php(r.payable)}` : `${name(r.payerId)} paid ${php(r.payable)}`}
                </p>
              </div>
              <span className="tnum font-bold">{php(mine?.total ?? "0")}</span>
              <Icon name="chevron" size={18} className="text-muted transition group-open:rotate-90" />
            </summary>
            <div className="border-t border-line px-4 py-3 text-[15px]">
              {!mine || mine.total === "0" ? (
                <p className="text-muted">You had nothing from this receipt — your share is PHP 0.00{paidByMe ? `, and you get back the full ${php(r.payable)} from others` : ""}.</p>
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
            </div>
          </details>
        );
      })}
    </div>
  );
}

function Everyone({ positions, frozen }: { positions: { memberId: string; funding: string; cost: string; net: string; remaining?: string }[]; frozen?: boolean }) {
  const { name, seq, me } = useEvent();
  return (
    <>
      <SectionTitle>Everyone</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {positions.map((p) => {
            const net = p.remaining ?? p.net;
            const b = balanceLabel(net);
            return (
              <li key={p.memberId} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={name(p.memberId)} seq={seq(p.memberId)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {name(p.memberId)}
                    {p.memberId === me.memberId && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  <p className="tnum text-[13px] text-muted">
                    paid {php(p.funding)} · share {php(p.cost)}
                  </p>
                </div>
                <div className={`tnum text-right ${b.tone === "receive" ? "text-receive" : b.tone === "pay" ? "text-pay" : "text-muted"}`}>
                  <p className="font-bold">
                    {b.sign}
                    {phpAbs(net)}
                  </p>
                  <p className="text-[12px]">{frozen ? (b.tone === "neutral" ? "settled" : b.tone === "receive" ? "still to receive" : "still to pay") : b.text.toLowerCase()}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function ProposedTransfers() {
  const { view, name } = useEvent();
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
              <span className="ml-auto font-bold">{php(e.amount)}</span>
            </p>
          ))
        )}
        <p className="text-[13px] text-muted">Debts are combined across all receipts to keep transfers few. A transfer settles the event as a whole, not a specific dish.</p>
      </Card>
    </>
  );
}

function PolicyNote() {
  return (
    <details className="card p-4 text-[14px]">
      <summary className="cursor-pointer font-semibold">How AteAnne splits money</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>Each item is split only among the people who claimed it — equally, or by pieces.</li>
        <li>Discounts reduce only the items they apply to, in proportion to their value.</li>
        <li>Service and other charges follow each person’s item spending after discounts. No spending, no service charge.</li>
        <li>All amounts are whole centavos. Leftover centavos go to the largest remainders (ties by join order), so totals always match exactly.</li>
        <li>Your net = what you paid merchants − your share. Getting money back is reimbursement, not income.</li>
      </ul>
    </details>
  );
}
