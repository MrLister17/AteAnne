import type { Phase } from "./PhaseMachine";

/** What the server knows, inside the event lock, right after an action. */
export interface AdvanceFacts {
  phase: Phase;
  cancelled: boolean;
  /** The organizer tapped "Everyone's here": nobody else can join. */
  rosterLocked: boolean;
  /** A statement was frozen before (active or superseded by a correction). */
  hasStatement: boolean;
  /** Everyone has entered their receipts and answered every receipt; everything reconciles. */
  freezeReady: boolean;
}

export interface CloseFacts {
  phase: Phase;
  /** Every transfer is confirmed received and no balance remains. */
  doneReady: boolean;
  /** Latest money event on the active statement: freeze, report, decision, reversal or dispute resolution. */
  lastActivityAt: Date;
  now: Date;
}

/**
 * Moves the group on by itself so nobody waits for an organizer button (D49).
 *
 * - The first statement freezes as soon as the roster is closed and everyone
 *   is done. Claiming is the agreement; there is no separate approval (D50).
 * - After a correction the organizer re-freezes by hand: the claims are
 *   usually still complete, so an automatic re-freeze would fire before
 *   anyone had a chance to fix anything.
 * - A fully paid event closes one day after the last payment activity (the
 *   daily cleanup checks). Done is read-only, so the day is the window to undo
 *   a mistaken "Received". Nobody waits on it: people see "All settled" at once.
 */
export class AutoAdvance {
  static readonly CLOSE_AFTER_MS = 24 * 60 * 60 * 1000;

  static next(f: AdvanceFacts): Phase | null {
    if (f.phase === "COLLECTING" || f.phase === "ALLOCATING" || f.phase === "REVIEWING") {
      return !f.cancelled && f.rosterLocked && !f.hasStatement && f.freezeReady ? "SETTLING" : null;
    }
    return null;
  }

  static shouldClose(f: CloseFacts): boolean {
    return f.phase === "SETTLING" && f.doneReady && f.now.getTime() - f.lastActivityAt.getTime() >= AutoAdvance.CLOSE_AFTER_MS;
  }
}
