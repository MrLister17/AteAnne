import type { Db } from "../db";
import type { PrivateStorage } from "../storage/PrivateStorage";
import type { EventService } from "./EventService";
import { RetentionPolicy } from "@/domain/event/RetentionPolicy";
import type { RateService } from "../fx/RateService";

/**
 * Daily housekeeping: expired sessions, stale rate-limit buckets, abandoned
 * unreferenced uploads, closing fully paid events a day after their last
 * payment activity, and whole-event purge of every event older than the
 * retention period (default 30 days from creation, finished or not — owner
 * decision). Purging goes through EventService.purge so rows are removed in
 * dependency order and image bytes are deleted too.
 */
export class CleanupService {
  constructor(
    private readonly db: Db,
    private readonly storage: PrivateStorage,
    private readonly events: EventService,
    private readonly retention = new RetentionPolicy(),
    private readonly rates: RateService | null = null,
  ) {}

  async run(now = new Date()) {
    const sessions = await this.db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } });
    const buckets = await this.db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 3600_000) } } });

    // QR assets that never became an instruction, older than a day.
    const orphans = await this.db.asset.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600_000) }, receipt: null, instructions: { none: {} } },
      select: { id: true, storageKey: true },
    });
    for (const a of orphans) {
      await this.db.asset.delete({ where: { id: a.id } });
      await this.storage.delete(a.storageKey).catch(() => undefined);
    }

    const expired = await this.db.event.findMany({ where: { createdAt: { lt: this.retention.cutoff(now) } }, select: { id: true } });
    let purgedEvents = 0;
    for (const e of expired) {
      const keys = (await this.db.asset.findMany({ where: { eventId: e.id }, select: { storageKey: true } })).map((a) => a.storageKey);
      await this.db.$transaction((tx) => this.events.purge(tx, e.id));
      for (const k of keys) await this.storage.delete(k).catch(() => undefined);
      purgedEvents++;
    }
    // Fully paid events close a day after their last payment activity (D49).
    const closedEvents = await this.events.closeSettledEvents(now);
    // Last night's ECB rates (D61), then freeze any bill that was only waiting for one.
    const rateDays = this.rates ? await this.rates.refreshForOpenEvents() : 0;
    const frozenEvents = await this.events.freezeWaitingEvents();
    return { sessions: sessions.count, rateBuckets: buckets.count, orphanAssets: orphans.length, purgedEvents, closedEvents, rateDays, frozenEvents };
  }
}
