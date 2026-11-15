import { ConflictError } from "../errors";

export type Phase = "COLLECTING" | "ALLOCATING" | "REVIEWING" | "SETTLING" | "DONE";

export const PHASES: readonly Phase[] = ["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING", "DONE"];

export const PHASE_LABEL: Record<Phase, string> = {
  COLLECTING: "Collecting",
  ALLOCATING: "Allocating",
  REVIEWING: "Reviewing",
  SETTLING: "Settling",
  DONE: "Done",
};

/**
 * Allowed phase transitions. Forward moves pass a readiness gate checked by
 * the application service; backward moves are corrections and are only
 * allowed before money is reported (Settling → Reviewing needs a snapshot
 * with no payment reports ever created).
 */
const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  COLLECTING: ["ALLOCATING"],
  ALLOCATING: ["REVIEWING", "COLLECTING"],
  REVIEWING: ["SETTLING", "ALLOCATING", "COLLECTING"],
  SETTLING: ["DONE", "REVIEWING"],
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
