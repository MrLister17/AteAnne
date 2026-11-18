import { ConflictError } from "../errors";

export type Phase = "COLLECTING" | "ALLOCATING" | "REVIEWING" | "SETTLING" | "DONE";

export const PHASES: readonly Phase[] = ["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING", "DONE"];

export const PHASE_LABEL: Record<Phase, string> = {
  COLLECTING: "Add & claim",
  ALLOCATING: "Claiming",
  REVIEWING: "Final check",
  SETTLING: "Paying",
  DONE: "Done",
};

/**
 * What people see since v0.7 (D49): three steps. New events go
 * Collecting ("Add & claim": receipts and claims together) → Settling → Done.
 * Allocating and Reviewing are only reached by events started before v0.7,
 * and count as step 1.
 */
export const STEPS = ["Add & claim", "Pay", "Done"] as const;

export function stepOf(phase: Phase): { index: 0 | 1 | 2; label: (typeof STEPS)[number] } {
  const index = phase === "SETTLING" ? 1 : phase === "DONE" ? 2 : 0;
  return { index, label: STEPS[index] };
}

/**
 * Allowed phase transitions. Forward moves pass a readiness gate checked by
 * the application service (usually automatically, see AutoAdvance); backward
 * moves are corrections. Settling → Collecting is a reasoned correction: it
 * preserves the old snapshot and carries confirmed money into the next
 * statement; pending/disputed reports must be resolved first.
 */
const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  COLLECTING: ["SETTLING"],
  ALLOCATING: ["SETTLING", "COLLECTING"],
  REVIEWING: ["SETTLING", "COLLECTING"],
  SETTLING: ["DONE", "COLLECTING"],
  DONE: [],
};

export class PhaseMachine {
  constructor(public readonly phase: Phase) {}

  canMoveTo(target: Phase): boolean {
    return TRANSITIONS[this.phase].includes(target);
  }

  assertCanMoveTo(target: Phase): void {
    if (!this.canMoveTo(target)) {
      throw new ConflictError("invalid_transition", `Cannot move from ${PHASE_LABEL[this.phase]} to ${PHASE_LABEL[target]}`);
    }
  }

  assertIn(...phases: Phase[]): void {
    if (!phases.includes(this.phase)) {
      throw new ConflictError("wrong_phase", `This action is only available while ${phases.map((p) => PHASE_LABEL[p]).join(" or ")}`);
    }
  }

  index(): number {
    return PHASES.indexOf(this.phase);
  }
}
