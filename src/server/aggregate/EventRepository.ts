import type { Tx } from "../db";
import { NotFoundError } from "../http/HttpError";
import { EventAggregate, type EventRecord } from "./EventAggregate";
import { RateService, receiptDay } from "../fx/RateService";

/** Everything needed to evaluate one event; scoped strictly by event ID. */
export const EVENT_INCLUDE = {
  members: { orderBy: { seq: "asc" } },
  receipts: {
    orderBy: { position: "asc" },
    include: {
      lines: { orderBy: { position: "asc" }, include: { claims: true } },
      adjustments: { orderBy: { position: "asc" } },
      fundingAcks: true,
      receiptAcks: true,
    },
  },
  approvals: true,
  // Reversals and disputes are loaded only when the event has cash reports (one query instead of three per load).
  cashReports: { orderBy: { createdAt: "asc" } },
  snapshots: {
    orderBy: { createdAt: "asc" },
    include: {
      shares: true,
      edges: {
        orderBy: { position: "asc" },
        include: {
          reports: { orderBy: { createdAt: "asc" }, include: { reversal: true } },
          disputes: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  },
} as const;

export class EventRepository {
  /** Lock the event row for the rest of the transaction (serialises all money writes). */
  async lock(tx: Tx, eventId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError("Event not found");
  }

  async load(tx: Tx, eventId: string): Promise<EventAggregate> {
    const loaded = await tx.event.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE });
    if (!loaded) throw new NotFoundError("Event not found");
    const ids = loaded.cashReports.map((c) => c.id);
    const [reversals, disputes] = ids.length
      ? await Promise.all([tx.cashReversal.findMany({ where: { reportId: { in: ids } } }), tx.cashDispute.findMany({ where: { reportId: { in: ids } } })])
      : [[], []];
    const event: EventRecord = {
      ...loaded,
      cashReports: loaded.cashReports.map((c) => ({ ...c, reversal: reversals.find((r) => r.reportId === c.id) ?? null, dispute: disputes.find((d) => d.reportId === c.id) ?? null })),
    };
    // Only events with receipts in another currency need rates; the read stays on this transaction.
    const days = event.receipts.filter((r) => r.currency !== event.currency).map(receiptDay);
    return new EventAggregate(event, days.length ? await RateService.load(tx, days) : new Map());
  }
}
