import type { LoadType, TrainingPhase } from "@/types/domain";
import { roundToStep } from "./weight-math";

export interface PerformedSet {
  weightKg: number; // display weight: per-hand for dumbbells, total for barbell/machine
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  painFlag: boolean;
}

export interface PrescriptionInput {
  lastWorkingSets: PerformedSet[];
  repRangeMin: number;
  repRangeMax: number;
  loadType: LoadType;
  /** Smallest achievable jump for this load type, given the gym's plate/dumbbell increments. 0 for bodyweight/cardio. */
  step: number;
  phase: TrainingPhase;
  repUnit: "reps" | "seconds" | "minutes";
  /** Days since this specific exercise was last performed (not just last workout). Drives layoff back-off. */
  daysSinceLastPerformed?: number | null;
}

export type PrescriptionAction = "calibrate" | "increase" | "hold" | "decrease" | "caution" | "restart";

export interface Prescription {
  action: PrescriptionAction;
  suggestedWeightKg: number | null;
  targetRepRangeMin: number;
  targetRepRangeMax: number;
  /** Lower bound of the RIR range to aim for (also used as the default RIR chip selection). */
  targetRir: number;
  targetRirMin: number;
  targetRirMax: number;
  rationale: string;
}

/** First 2 weeks: keep more reps in reserve while re-establishing a safe baseline; then tighten up. */
export function targetRirRangeForPhase(phase: TrainingPhase): [number, number] {
  return phase === "calibration" ? [2, 3] : [1, 2];
}

const LAYOFF_LONG_DAYS = 21;
const LAYOFF_SHORT_DAYS = 10;
const LAYOFF_LONG_BACKOFF = 0.7; // ~30% lighter
const LAYOFF_SHORT_BACKOFF = 0.9; // ~10% lighter

export function computeNextPrescription(input: PrescriptionInput): Prescription {
  const { lastWorkingSets, repRangeMin, repRangeMax, loadType, step, phase, repUnit, daysSinceLastPerformed } = input;
  const [rirMin, rirMax] = targetRirRangeForPhase(phase);
  const progressesByWeight = step > 0 && loadType !== "bodyweight" && loadType !== "cardio";

  const base = {
    targetRepRangeMin: repRangeMin,
    targetRepRangeMax: repRangeMax,
    targetRir: rirMin,
    targetRirMin: rirMin,
    targetRirMax: rirMax,
  };

  const workingSets = lastWorkingSets.filter((s) => !s.isWarmup);

  if (workingSets.length === 0) {
    return {
      ...base,
      action: "calibrate",
      suggestedWeightKg: null,
      rationale: phase === "calibration"
        ? "No history yet. Pick a conservative weight you're confident you can control for the full rep range."
        : "First time logging this exercise. Start conservative and let the app calibrate from here.",
    };
  }

  if (workingSets.some((s) => s.painFlag)) {
    return {
      ...base,
      action: "caution",
      suggestedWeightKg: lastWeight(workingSets),
      rationale: "Pain or discomfort was reported last time. Hold this weight, avoid aggravating the movement, and check with a qualified professional if it continues.",
    };
  }

  const w = lastWeight(workingSets);

  // A real layoff on THIS exercise resets the baseline rather than judging trend off stale data.
  if (progressesByWeight && daysSinceLastPerformed != null && daysSinceLastPerformed >= LAYOFF_SHORT_DAYS) {
    const long = daysSinceLastPerformed >= LAYOFF_LONG_DAYS;
    const multiplier = long ? LAYOFF_LONG_BACKOFF : LAYOFF_SHORT_BACKOFF;
    const adjusted = Math.max(0, roundToStep(w * multiplier, step || 0.5));
    return {
      ...base,
      action: "restart",
      suggestedWeightKg: adjusted,
      rationale: `It's been ${daysSinceLastPerformed} days since you trained this — starting about ${long ? "30" : "10"}% lighter than last time to rebuild safely.`,
    };
  }

  const reps = workingSets.map((s) => s.reps);
  const rirValues = workingSets.map((s) => s.rir).filter((r): r is number => r != null);
  const avgRir = rirValues.length > 0 ? rirValues.reduce((a, b) => a + b, 0) / rirValues.length : rirMin;
  const minReps = Math.min(...reps);
  const allAtOrAboveMax = reps.every((r) => r >= repRangeMax);
  const droppedWellBelowRange = minReps < repRangeMin - 2 && avgRir <= 1;

  if (allAtOrAboveMax) {
    // Hitting the ceiling of the rep range always means "go up in weight" — that's double progression.
    // How much easier than asked (avgRir vs. the top of the target range) only changes the size of the jump.
    const muchEasierThanAsked = avgRir - rirMax >= 2;

    if (!progressesByWeight) {
      const bump = repUnit === "seconds" ? 10 : repUnit === "minutes" ? 5 : 3;
      return {
        ...base,
        action: "increase",
        suggestedWeightKg: w,
        targetRepRangeMin: repRangeMax,
        targetRepRangeMax: repRangeMax + (muchEasierThanAsked ? bump * 2 : bump),
        rationale: `All sets hit the top of the range with reps to spare. Push the target ${repUnit === "reps" ? "reps" : repUnit} up next time.`,
      };
    }
    const jump = muchEasierThanAsked ? step * 2 : step;
    return {
      ...base,
      action: "increase",
      suggestedWeightKg: w + jump,
      rationale: muchEasierThanAsked
        ? `All sets hit ${repRangeMax}+ reps with several left in reserve — that was too easy, so adding a bigger jump.`
        : `All sets hit ${repRangeMax}+ reps last time. Adding the smallest available increment.`,
    };
  }

  if (droppedWellBelowRange) {
    if (!progressesByWeight) {
      return {
        ...base,
        action: "hold",
        suggestedWeightKg: w,
        rationale: "Performance dropped off last time. Repeat the same target and focus on clean form.",
      };
    }
    return {
      ...base,
      action: "decrease",
      suggestedWeightKg: Math.max(0, w - step),
      rationale: "Reps dropped well below target with little left in reserve. Stepping down to rebuild solid reps.",
    };
  }

  return {
    ...base,
    action: "hold",
    suggestedWeightKg: w,
    rationale: "Within target range last time. Same weight — aim for an extra rep on any set.",
  };
}

function lastWeight(sets: PerformedSet[]): number {
  return sets[sets.length - 1]?.weightKg ?? 0;
}
