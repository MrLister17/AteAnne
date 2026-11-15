import type { Db } from "../db";
import { EventRepository } from "../aggregate/EventRepository";
import { EventViewBuilder } from "../readmodels/EventViewBuilder";

/** Read side: authorised event view and authenticated statement export. */
export class QueryService {
  constructor(
    private readonly db: Db,
    private readonly views: EventViewBuilder,
    private readonly repo = new EventRepository(),
  ) {}

  async view(actorId: string, eventId: string) {
    const agg = await this.repo.load(this.db, eventId);
    const me = agg.memberForActor(actorId); // 404 for non-members: no existence leak
    return this.views.build(agg, me);
  }

  /** Manual-record export (JSON or CSV). Excludes credentials, images and asset URLs. */
  async export(actorId: string, eventId: string, format: "json" | "csv"): Promise<{ body: string; contentType: string; filename: string }> {
    const view = await this.view(actorId, eventId);
    const name = (id: string) => view.members.find((m) => m.id === id)?.displayName ?? id;
    const peso = (c: string) => {
      const v = BigInt(c);
      const a = v < 0n ? -v : v;
      return `${v < 0n ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
    };
    const statement = {
      notice: "AteAnne manual record. Not a bank statement; payments are participant reports confirmed by recipients.",
      exportedAt: new Date().toISOString(),
      event: { title: view.event.title, phase: view.event.phase, cancelled: view.event.cancelled, financialVersion: view.event.financialVersion },
      members: view.members.map((m) => ({ id: m.id, seq: m.seq, displayName: m.displayName, active: m.active })),
      receipts: view.receipts.map((r) => ({
        label: r.label,
        payer: name(r.payerId),
        payablePhp: peso(r.payable),
        lines: r.lines.map((l) => ({ label: l.label, quantity: l.quantity, amountPhp: peso(l.amount), mode: l.mode, consumers: l.claims.filter((c) => !c.stale).map((c) => ({ member: name(c.memberId), units: c.units })) })),
        adjustments: r.adjustments.map((a) => ({ kind: a.kind, label: a.label, amountPhp: peso(a.amount), appliesTo: a.scopeAll ? "all lines" : a.eligibleLineIds.map((id) => r.lines.find((l) => l.id === id)?.label ?? id) })),
      })),
      settlement: view.settlement
        ? {
            snapshotId: view.settlement.snapshotId,
            financialVersion: view.settlement.financialVersion,
            frozenAt: view.settlement.frozenAt,
            positions: view.settlement.positions.map((p) => ({ member: name(p.memberId), fundingPhp: peso(p.funding), costPhp: peso(p.cost), netPhp: peso(p.net), remainingPhp: peso(p.remaining) })),
            transfers: view.settlement.edges.map((x) => ({
              from: name(x.from),
              to: name(x.to),
              amountPhp: peso(x.amount),
              verifiedPhp: peso(x.verified),
              pendingPhp: peso(x.pending),
              reports: x.reports.map((r) => ({ amountPhp: peso(r.amount), method: r.method, status: r.status, reportedAt: r.createdAt, decidedAt: r.decidedAt, reversed: Boolean(r.reversal), reversalReason: r.reversal?.reason ?? null, rejectReason: r.rejectReason })),
            })),
          }
        : null,
    };
    const slug = view.event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "event";
    if (format === "json") return { body: JSON.stringify(statement, null, 2), contentType: "application/json", filename: `ateanne-${slug}.json` };

    const rows: string[][] = [["section", "receipt_or_transfer", "member", "item", "amount_php", "status"]];
    for (const r of statement.receipts) {
      rows.push(["receipt_funding", r.label, r.payer, "", r.payablePhp, "paid to merchant"]);
      for (const l of r.lines) for (const c of l.consumers) rows.push(["consumption_claim", r.label, c.member, `${l.label} (${l.mode === "UNITS" ? `${c.units} unit(s)` : "shared"})`, "", ""]);
    }
    if (view.calculation.ok) {
      for (const st of view.calculation.receipts) {
        const label = view.receipts.find((r) => r.id === st.receiptId)?.label ?? "";
        for (const sh of st.shares) if (sh.total !== "0") rows.push(["receipt_share", label, name(sh.memberId), "items − discounts + charges", peso(sh.total), ""]);
      }
    }
    for (const t of statement.settlement?.transfers ?? []) {
      rows.push(["transfer_edge", `${t.from} → ${t.to}`, t.from, "", t.amountPhp, `verified ${t.verifiedPhp}`]);
      for (const r of t.reports) rows.push(["payment_report", `${t.from} → ${t.to}`, t.from, r.method, r.amountPhp, r.reversed ? "VERIFIED then REVERSED" : r.status]);
    }
    const csv = rows.map((row) => row.map((c) => (/[",\n]/.test(c) || /^[=+\-@]/.test(c) ? `"${c.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    return { body: csv, contentType: "text/csv; charset=utf-8", filename: `ateanne-${slug}.csv` };
  }
}
