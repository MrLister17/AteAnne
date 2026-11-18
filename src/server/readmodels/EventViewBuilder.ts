import type { EventAggregate, MemberRecord, SnapshotRecord } from "../aggregate/EventAggregate";
import type { Db } from "../db";
import { JoinCodeCodec } from "../security/Crypto";
import type { EventService } from "../services/EventService";
import { RetentionPolicy } from "@/domain/event/RetentionPolicy";
import { SettlementPlanner } from "@/domain/settlement/SettlementPlanner";

const s = (v: bigint) => v.toString();

/**
 * Safe, member-scoped projection of an event for the UI. Never returns raw
 * ORM rows, credential hashes or storage keys; all money is decimal-string
 * centavos; all totals are server-computed.
 */
export class EventViewBuilder {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly retention = new RetentionPolicy(),
    private readonly features: { receiptScan: boolean } = { receiptScan: false },
  ) {}

  /** `me` is whose view this is; `by` is the signed-in person (differs only when acting for a guest). */
  async build(agg: EventAggregate, me: MemberRecord, by: MemberRecord = me) {
    const e = agg.record;
    const isOwner = agg.isOwner(me.id);
    const acting = by.id !== me.id;
    const order = new Map(agg.memberOrder().map((id, i) => [id, i]));
    const activeSnap = agg.activeSnapshot();

    const instructions = await this.db.paymentInstruction.findMany({ where: { member: { eventId: e.id }, current: true } });
    const qrVisibleFor = (ownerId: string) =>
      ownerId === me.id || Boolean(activeSnap?.edges.some((edge) => edge.fromMemberId === me.id && edge.toMemberId === ownerId));
    const audit = await this.db.auditEvent.findMany({ where: { eventId: e.id }, orderBy: { createdAt: "desc" }, take: 40 });

    const calc = agg.calculation();
    const remaining = calc.ok ? agg.remainingNets(calc.positions.map((p) => [p.memberId, p.net] as const)) : new Map<string, bigint>();
    const joinCode = isOwner ? this.events.revealCode(e) : null;

    return {
      features: this.features,
      me: {
        memberId: me.id,
        isOwner,
        isAdmin: me.isAdmin,
        isGuest: me.managed,
        /** Organizer or admin, and not currently acting for someone. */
        canManageGuests: !acting && agg.canManageGuests(me.id),
        displayName: me.displayName,
        intent: me.intent,
        entryComplete: me.entryComplete,
        claimVersion: me.claimVersion,
      },
      /** Set while a manager is acting for a guest: who is really holding the phone. */
      actingFor: acting ? { byMemberId: by.id, byName: by.displayName } : null,
      event: {
        id: e.id,
        title: e.title,
        note: e.note,
        phase: e.phase,
        cancelled: e.cancelled,
        financialVersion: e.financialVersion,
        structuralVersion: e.structuralVersion,
        joinCode: joinCode ? JoinCodeCodec.format(joinCode) : null,
        joinCodeExpiresAt: isOwner && joinCode ? e.joinCodeExpiresAt?.toISOString() ?? null : null,
        joinsOpen: Boolean(e.joinCodeHash) && e.phase === "COLLECTING" && !e.cancelled,
        rosterLockedAt: e.rosterLockedAt?.toISOString() ?? null,
        completedAt: e.completedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        deletesAt: this.retention.deletesAt(e.createdAt).toISOString(),
        retentionDays: this.retention.days,
        daysUntilDeletion: this.retention.daysLeft(e.createdAt),
      },
      members: e.members.map((m) => ({
        id: m.id,
        seq: m.seq,
        displayName: m.displayName,
        intent: m.intent,
        active: m.active,
        entryComplete: m.entryComplete,
        isOwner: agg.isOwner(m.id),
        isAdmin: m.isAdmin,
        /** Added without a phone; the organizer or an admin acts for them. */
        isGuest: m.managed,
        isMe: m.id === me.id,
        referenced: agg.memberReferenced(m.id),
      })),
      receipts: e.receipts.map((r) => {
        const rec = agg.reconciliation(r);
        return {
          id: r.id,
          label: r.label,
          payerId: r.payerMemberId,
          authorId: r.authorMemberId,
          payable: s(r.payableCentavos),
          equalSplit: r.equalSplit,
          version: r.version,
          imageAssetId: r.imageAssetId,
          canEdit: e.phase === "COLLECTING" && !e.cancelled && (r.authorMemberId === me.id || isOwner),
          fundingAcknowledged: agg.fundingAcknowledged(r),
          reconciliation: {
            grossItems: s(rec.grossItems),
            discounts: s(rec.discounts),
            charges: s(rec.charges),
            computedPayable: s(rec.computedPayable),
            difference: s(rec.difference),
            reconciled: rec.reconciled,
            issues: rec.issues.map((i) => i.message),
          },
          lines: r.lines.map((l) => {
            const current = l.claims.filter((c) => c.receiptVersion === r.version);
            return {
              id: l.id,
              position: l.position,
              label: l.label,
              quantity: l.quantity,
              amount: s(l.amountCentavos),
              unitPrice: l.unitPriceCentavos === null ? null : s(l.unitPriceCentavos),
              unitPriceMismatch: l.unitPriceCentavos !== null && l.unitPriceCentavos * BigInt(l.quantity) !== l.amountCentavos,
              mode: l.mode,
              claimedUnits: current.reduce((a, c) => a + c.units, 0),
              claims: l.claims
                .map((c) => ({ memberId: c.memberId, units: c.units, stale: c.receiptVersion !== r.version }))
                .sort((a, b) => (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0)),
            };
          }),
          adjustments: r.adjustments.map((a) => ({
            id: a.id,
            kind: a.kind,
            label: a.label,
            amount: s(a.amountCentavos),
            scopeAll: a.scopeAll,
            eligibleLineIds: a.eligibleLineIds,
          })),
          acks: e.members.map((m) => {
            const ack = r.receiptAcks.find((x) => x.memberId === m.id);
            return { memberId: m.id, kind: ack?.kind ?? null, stale: Boolean(ack && ack.receiptVersion !== r.version) };
          }),
        };
      }),
      gates: {
        allocating: agg.allocationGate(),
        reviewing: e.phase === "ALLOCATING" || e.phase === "REVIEWING" ? agg.reviewGate() : null,
        settling: e.phase === "REVIEWING" ? agg.settlementGate() : null,
        done: e.phase === "SETTLING" ? agg.doneGate() : null,
        correcting: e.phase === "SETTLING" ? agg.correctionGate() : null,
      },
      calculation: calc.ok
        ? {
            ok: true as const,
            issues: [] as string[],
            positions: calc.positions.map((p) => ({ memberId: p.memberId, funding: s(p.funding), cost: s(p.cost), net: s(p.net), remaining: s(remaining.get(p.memberId)!) })),
            edges: new SettlementPlanner().plan([...remaining]).map((x) => ({ from: x.from, to: x.to, amount: s(x.amount) })),
            receipts: calc.receipts.map((st) => ({
              receiptId: st.receiptId,
              shares: [...st.shares.values()].map((sh) => ({
                memberId: sh.memberId,
                lines: Object.fromEntries([...sh.lineShares].map(([k, v]) => [k, s(v)])),
                discounts: Object.fromEntries([...sh.discountShares].map(([k, v]) => [k, s(v)])),
                charges: Object.fromEntries([...sh.chargeShares].map(([k, v]) => [k, s(v)])),
                itemsGross: s(sh.itemsGross),
                discountTotal: s(sh.discountTotal),
                chargeTotal: s(sh.chargeTotal),
                total: s(sh.total),
              })),
            })),
          }
        : { ok: false as const, issues: calc.issues.map((i) => i.message), positions: [], edges: [], receipts: [] },
      review: {
        approvals: [...agg.approvalsForCurrentVersion()],
        approvedByMe: agg.approvalsForCurrentVersion().has(me.id),
      },
      settlement: activeSnap ? this.settlementView(agg, activeSnap, me) : null,
      supersededSnapshots: e.snapshots.filter((x) => x.status === "SUPERSEDED").map((x) => ({ id: x.id, financialVersion: x.financialVersion, supersededAt: x.supersededAt?.toISOString() ?? null })),
      statementHistory: e.snapshots.filter((x) => x.status === "SUPERSEDED").map((x) => ({
        id: x.id, financialVersion: x.financialVersion, policyVersion: x.policyVersion,
        frozenAt: x.createdAt.toISOString(), supersededAt: x.supersededAt?.toISOString() ?? null,
        facts: x.facts,
        positions: x.shares.map((p) => ({ memberId: p.memberId, funding: s(p.fundingCentavos), cost: s(p.costCentavos), net: s(p.netCentavos) })),
        edges: x.edges.map((edge) => ({ id: edge.id, from: edge.fromMemberId, to: edge.toMemberId, amount: s(edge.amountCentavos) })),
      })),
      paymentHistory: e.snapshots.filter((x) => x.status === "SUPERSEDED").flatMap((snap) => snap.edges.flatMap((edge) => edge.reports.map((r) => ({
        id: r.id, snapshotId: snap.id, financialVersion: snap.financialVersion,
        from: edge.fromMemberId, to: edge.toMemberId, amount: s(r.amountCentavos),
        method: r.method, note: r.note, status: r.status, createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        reversal: r.reversal ? { reason: r.reversal.reason, createdAt: r.reversal.createdAt.toISOString() } : null,
        rejectReason: r.rejectReason,
      })))),
      instructions: Object.fromEntries(
        instructions.map((i) => [
          i.memberId,
          { id: i.id, version: i.version, acceptsCash: i.acceptsCash, cashNote: i.cashNote, qrLabel: i.qrLabel, hasQr: Boolean(i.qrAssetId), qrAssetId: i.qrAssetId && qrVisibleFor(i.memberId) ? i.qrAssetId : null },
        ]),
      ),
      audit: audit.map((a) => {
        const d = a.detail && typeof a.detail === "object" && !Array.isArray(a.detail) ? (a.detail as Record<string, unknown>) : {};
        return {
          id: a.id,
          type: a.type,
          actorMemberId: a.actorMemberId,
          /** Set when a manager did this for a guest (someone without a phone). */
          onBehalfOf: typeof d.onBehalfOf === "string" ? d.onBehalfOf : null,
          createdAt: a.createdAt.toISOString(),
          detail: a.detail,
        };
      }),
    };
  }

  private settlementView(agg: EventAggregate, snap: SnapshotRecord, me: MemberRecord) {
    const ledger = agg.paymentLedger(snap)!;
    const remaining = agg.remainingNets(snap.shares.map((x) => [x.memberId, x.netCentavos] as const));
    return {
      snapshotId: snap.id,
      financialVersion: snap.financialVersion,
      policyVersion: snap.policyVersion,
      frozenAt: snap.createdAt.toISOString(),
      hasReports: Boolean(snap.firstReportAt),
      facts: snap.facts,
      positions: snap.shares.map((x) => ({ memberId: x.memberId, funding: s(x.fundingCentavos), cost: s(x.costCentavos), net: s(x.netCentavos), remaining: s(remaining.get(x.memberId) ?? 0n) })),
      edges: ledger.edgeStates().map((st) => {
        const edge = snap.edges.find((x) => x.id === st.edge.id)!;
        const openDispute = edge.disputes.find((d) => d.status !== "RESOLVED");
        return {
          id: edge.id,
          from: edge.fromMemberId,
          to: edge.toMemberId,
          amount: s(edge.amountCentavos),
          verified: s(st.verified),
          pending: s(st.pending),
          outstanding: s(st.outstanding),
          capacity: s(st.capacity),
          settled: st.settled,
          disputed: st.disputed,
          involvesMe: edge.fromMemberId === me.id || edge.toMemberId === me.id,
          reports: edge.reports.map((r) => ({
            id: r.id,
            amount: s(r.amountCentavos),
            method: r.method,
            note: r.note,
            status: r.status,
            version: r.version,
            instructionId: r.instructionId,
            replacesReportId: r.replacesReportId,
            rejectReason: r.rejectReason,
            createdAt: r.createdAt.toISOString(),
            decidedAt: r.decidedAt?.toISOString() ?? null,
            reversal: r.reversal ? { reason: r.reversal.reason, createdAt: r.reversal.createdAt.toISOString() } : null,
          })),
          dispute: openDispute
            ? { id: openDispute.id, status: openDispute.status, version: openDispute.version, senderChoice: openDispute.senderChoice, recipientChoice: openDispute.recipientChoice, rejectedReportId: openDispute.rejectedReportId }
            : null,
        };
      }),
    };
  }
}

export type EventView = Awaited<ReturnType<EventViewBuilder["build"]>>;
