import type { Tx } from "../db";
import { NotFoundError } from "../http/HttpError";
import { EventAggregate } from "./EventAggregate";

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
    const event = await tx.event.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE });
    if (!event) throw new NotFoundError("Event not found");
    return new EventAggregate(event);
  }
}
