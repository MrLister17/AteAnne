import type { Db } from "../db";
import { EventRepository } from "../aggregate/EventRepository";
import { EventViewBuilder } from "../readmodels/EventViewBuilder";
import { Caller, callerParts } from "./BaseService";
import { RateService, receiptDay } from "../fx/RateService";

/** Read side: authorised event view and authenticated statement export. */
export class QueryService {
  constructor(
    private readonly db: Db,
    private readonly views: EventViewBuilder,
    private readonly rates: RateService | null = null,
    private readonly repo = new EventRepository(),
  ) {}

  /** The event as `me` sees it; a manager acting for a guest sees it as the guest. */
  async view(caller: Caller, eventId: string) {
    const { actorId, asMemberId } = callerParts(caller);
    await this.prefetchRates(eventId);
    const agg = await this.repo.load(this.db, eventId);
    const by = agg.memberForActor(actorId); // 404 for non-members: no existence leak
    const me = agg.subjectFor(by, asMemberId);
    return this.views.build(agg, me, by);
  }

  /**
   * Multi-currency events keep today's rate (for "Show totals in" and paying
   * in another currency) and their receipts' purchase-day rates fresh. One
   * small query for peso-only events; never inside a lock.
   */
  private async prefetchRates(eventId: string) {
    if (!this.rates) return;
    const e = await this.db.event.findUnique({
      where: { id: eventId },
      select: { currency: true, phase: true, receipts: { select: { currency: true, purchasedOn: true, createdAt: true } }, members: { select: { instructions: { where: { current: true }, select: { acceptedCurrencies: true } } } } },
    });
    if (!e) return;
    // A frozen or Done bill keeps its rates in the statement; only today's (for the totals switch) can still change.
    const foreign = e.phase === "COLLECTING" || e.phase === "ALLOCATING" || e.phase === "REVIEWING" ? e.receipts.filter((r) => r.currency !== e.currency) : [];
    const acceptsOther = e.members.some((m) => m.instructions.some((i) => i.acceptedCurrencies.some((c) => c !== e.currency)));
    const mixed = e.receipts.some((r) => r.currency !== e.currency);
    if (!mixed && !acceptsOther && e.currency === "PHP") return;
    await this.rates.ensureDays([this.rates.today(), ...foreign.map(receiptDay)]);
  }

  /** Manual-record export (JSON or CSV). Excludes credentials, images and asset URLs. */
  async export(actorId: string, eventId: string, format: "json" | "csv"): Promise<{ body: string; contentType: string; filename: string }> {
    const view = await this.view(actorId, eventId);
    const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? id;
    const ccy = view.event.currency;
    const exponent = (code: string) => view.fx.supported.find((c) => c.code === code)?.exponent ?? 2;
    /** Plain decimal text in a currency's own units ("1397.00", "12000"), no separators. */
    const amt = (c: string, code = ccy) => {
      const v = BigInt(c);
      const a = v < 0n ? -v : v;
      const e = exponent(code);
      const unit = 10n ** BigInt(e);
      return `${v < 0n ? "-" : ""}${a / unit}${e ? `.${(a % unit).toString().padStart(e, "0")}` : ""}`;
    };
    const paidOf = (p: { currency: string; amount: string; rate: string; rateDate: string; source: string } | null) =>
      p ? { currency: p.currency, amount: amt(p.amount, p.currency), rate: `1 ${p.currency} = ${p.rate} ${ccy}`, rateDate: p.rateDate, rateSource: p.source } : null;
    const statement = {
      notice: "AteAnne manual record. Not a bank statement; payments are participant reports confirmed by recipients.",
      exportedAt: new Date().toISOString(),
      event: { title: view.event.title, phase: view.event.phase, cancelled: view.event.cancelled, financialVersion: view.event.financialVersion, currency: ccy },
      members: view.members.map((m) => ({ id: m.id, seq: m.seq, displayName: m.displayName, active: m.active })),
      supersededStatements: view.statementHistory,
      priorPaymentHistory: view.paymentHistory.map((r) => ({
        reportId: r.id, snapshotId: r.snapshotId, financialVersion: r.financialVersion,
        from: name(r.from), to: name(r.to), amount: amt(r.amount), currency: ccy, paid: paidOf(r.paid), method: r.method,
        status: r.status, reportedAt: r.createdAt, decidedAt: r.decidedAt,
        reversal: r.reversal, rejectReason: r.rejectReason,
      })),
      receipts: view.receipts.map((r) => ({
        label: r.label,
        equalSplit: r.equalSplit,
        payer: name(r.payerId),
        currency: r.currency,
        purchasedOn: r.purchasedOn,
        payable: amt(r.payable, r.currency),
        /** Purchase-day rate and the converted total, when the receipt isn't in the settle-up currency. */
        conversion: r.rate ? { rate: `1 ${r.rate.base} = ${r.rate.rate} ${r.rate.quote}`, rateDate: r.rate.date, rateSource: r.rate.source, payable: amt(r.settlePayable ?? "0"), currency: ccy } : null,
        lines: r.lines.map((l) => ({ label: l.label, quantity: l.quantity, amount: amt(l.amount, r.currency), mode: l.mode, consumers: l.claims.filter((c) => !c.stale).map((c) => ({ member: name(c.memberId), units: c.units })) })),
        adjustments: r.adjustments.map((a) => ({ kind: a.kind, label: a.label, amount: amt(a.amount, r.currency), appliesTo: a.scopeAll ? "all lines" : a.eligibleLineIds.map((id) => r.lines.find((l) => l.id === id)?.label ?? id) })),
      })),
      settlement: view.settlement
        ? {
            snapshotId: view.settlement.snapshotId,
            financialVersion: view.settlement.financialVersion,
            frozenAt: view.settlement.frozenAt,
            currency: ccy,
            positions: view.settlement.positions.map((p) => ({ member: name(p.memberId), funding: amt(p.funding), cost: amt(p.cost), net: amt(p.net), remaining: amt(p.remaining) })),
            transfers: view.settlement.edges.map((x) => ({
              from: name(x.from),
              to: name(x.to),
              amount: amt(x.amount),
              verified: amt(x.verified),
              pending: amt(x.pending),
              reports: x.reports.map((r) => ({ amount: amt(r.amount), paid: paidOf(r.paid), method: r.method, status: r.status, reportedAt: r.createdAt, decidedAt: r.decidedAt, reversed: Boolean(r.reversal), reversalReason: r.reversal?.reason ?? null, rejectReason: r.rejectReason })),
            })),
          }
        : null,
    };
    const slug = view.event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "event";
    if (format === "json") return { body: JSON.stringify(statement, null, 2), contentType: "application/json", filename: `ateanne-${slug}.json` };

    // amount/currency: what the row is in; settle_amount: the same in the event's settle-up currency.
    const rows: string[][] = [["section", "receipt_or_transfer", "member", "item", "amount", "currency", "settle_amount", "rate", "rate_date", "status"]];
    for (const r of statement.receipts) {
      rows.push(["receipt_funding", r.label, r.payer, r.purchasedOn, r.payable, r.currency, r.conversion?.payable ?? r.payable, r.conversion?.rate ?? "", r.conversion?.rateDate ?? "", "paid to merchant"]);
      for (const l of r.lines) for (const c of l.consumers) rows.push(["consumption_claim", r.label, c.member, `${l.label} (${l.mode === "UNITS" ? `${c.units} unit(s)` : "shared"})`, "", "", "", "", "", ""]);
    }
    if (view.calculation.ok) {
      for (const st of view.calculation.receipts) {
        const receipt = view.receipts.find((r) => r.id === st.receiptId);
        for (const sh of st.shares) {
          if (sh.total === "0") continue;
          rows.push(["receipt_share", receipt?.label ?? "", name(sh.memberId), "items − discounts + charges", amt(sh.total, receipt?.currency ?? ccy), receipt?.currency ?? ccy, amt(st.settleShares[sh.memberId] ?? sh.total), st.rate ? `1 ${st.rate.base} = ${st.rate.rate} ${st.rate.quote}` : "", st.rate?.date ?? "", ""]);
        }
      }
    }
    for (const t of statement.settlement?.transfers ?? []) {
      rows.push(["transfer_edge", `${t.from} → ${t.to}`, t.from, "", t.amount, ccy, t.amount, "", "", `verified ${t.verified}`]);
      for (const r of t.reports) rows.push(["payment_report", `${t.from} → ${t.to}`, t.from, r.method, r.paid?.amount ?? r.amount, r.paid?.currency ?? ccy, r.amount, r.paid?.rate ?? "", r.paid?.rateDate ?? "", r.reversed ? "VERIFIED then REVERSED" : r.status]);
    }
    for (const r of statement.priorPaymentHistory) rows.push(["prior_payment_report", `${r.from} → ${r.to} (version ${r.financialVersion})`, r.from, r.method, r.paid?.amount ?? r.amount, r.paid?.currency ?? ccy, r.amount, r.paid?.rate ?? "", r.paid?.rateDate ?? "", r.reversal ? "VERIFIED then REVERSED" : r.status]);
    const csv = rows.map((row) => row.map((c) => (/[",\n]/.test(c) || /^[=+\-@]/.test(c) ? `"${c.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    return { body: csv, contentType: "text/csv; charset=utf-8", filename: `ateanne-${slug}.csv` };
  }
}
