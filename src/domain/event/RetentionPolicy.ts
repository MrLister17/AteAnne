const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an event lives. Owner decision (2026-11-15): every event —
 * finished or not — is deleted a fixed number of days after it was created
 * (default 30). Deletion destroys the record, not any real-world debt.
 */
export class RetentionPolicy {
  constructor(public readonly days: number = 30) {
    if (!Number.isInteger(days) || days < 1) throw new Error("Retention must be a whole number of days ≥ 1");
  }

  deletesAt(createdAt: Date): Date {
    return new Date(createdAt.getTime() + this.days * DAY_MS);
  }

  /** Events created before this instant are due for deletion. */
  cutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - this.days * DAY_MS);
  }

  daysLeft(createdAt: Date, now: Date = new Date()): number {
    return Math.max(0, Math.ceil((this.deletesAt(createdAt).getTime() - now.getTime()) / DAY_MS));
  }
}
