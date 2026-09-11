import type { EquipmentIncrements, ExerciseSet, LoadType } from "@/types/domain";

export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Total load moved for volume math. Dumbbell weight is per-hand, so double it. */
export function totalLoadForSet(set: Pick<ExerciseSet, "weightEntryMode" | "weightKg" | "barWeightKg" | "platePerSideKg" | "assistKg">): number {
  switch (set.weightEntryMode) {
    case "dumbbell_each":
      return set.weightKg * 2;
    case "barbell_total":
      return set.barWeightKg != null && set.platePerSideKg != null ? set.barWeightKg + set.platePerSideKg * 2 : set.weightKg;
    case "machine":
      return set.weightKg;
    case "bodyweight":
      return 0;
    case "assisted":
      return 0;
    default:
      return set.weightKg;
  }
}

/** The number shown as "today's suggested weight" — per-hand for dumbbells, total for barbell/machine. */
export function displayWeightForSet(set: Pick<ExerciseSet, "weightEntryMode" | "weightKg" | "barWeightKg" | "platePerSideKg">): number {
  if (set.weightEntryMode === "barbell_total" && set.barWeightKg != null && set.platePerSideKg != null) {
    return set.barWeightKg + set.platePerSideKg * 2;
  }
  return set.weightKg;
}

export function loadTypeToEntryMode(loadType: LoadType): ExerciseSet["weightEntryMode"] {
  switch (loadType) {
    case "dumbbell_each":
      return "dumbbell_each";
    case "barbell":
      return "barbell_total";
    case "machine_stack":
      return "machine";
    case "bodyweight":
      return "bodyweight";
    case "cardio":
      return "bodyweight";
  }
}

/** Smallest weight step achievable next, given the equipment increments configured for this gym. */
export function stepForLoadType(loadType: LoadType, increments: EquipmentIncrements): number {
  switch (loadType) {
    case "dumbbell_each":
      return increments.dumbbellStepKg;
    case "barbell":
      return increments.plateStepKg * 2; // a plate is added to both sides
    case "machine_stack":
      return increments.machineStepKg;
    default:
      return 0;
  }
}

export function nextPlatePerSide(currentPlatePerSideKg: number, plateStepKg: number): number {
  return roundToStep(currentPlatePerSideKg + plateStepKg, plateStepKg);
}

/** Plates a typical Indian commercial gym stocks, heaviest first. */
export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export interface PlateBreakdown {
  /** Plates to load on ONE side, heaviest first. */
  perSide: number[];
  /** What you'll actually be lifting — the target isn't always loadable. */
  achievedTotalKg: number;
  /** Positive when the bar ends up lighter than asked for. */
  shortfallKg: number;
}

/**
 * Greedy plate maths: what to hang on each side to hit a target total. Greedy is exact for
 * standard plate sets (each plate is a multiple of the next one down), which is every set this
 * app will meet in practice.
 */
export function calculatePlates(
  targetTotalKg: number,
  barKg: number,
  availablePlates: readonly number[] = DEFAULT_PLATES_KG
): PlateBreakdown {
  const perSideTarget = (targetTotalKg - barKg) / 2;
  if (perSideTarget <= 0) {
    return { perSide: [], achievedTotalKg: barKg, shortfallKg: Math.max(0, targetTotalKg - barKg) };
  }

  const plates = [...availablePlates].sort((a, b) => b - a);
  const perSide: number[] = [];
  let remaining = perSideTarget;

  for (const plate of plates) {
    while (remaining >= plate - 1e-9) {
      perSide.push(plate);
      remaining -= plate;
    }
  }

  const achievedTotalKg = Math.round((barKg + perSide.reduce((sum, p) => sum + p, 0) * 2) * 100) / 100;
  return {
    perSide,
    achievedTotalKg,
    shortfallKg: Math.round((targetTotalKg - achievedTotalKg) * 100) / 100,
  };
}

/** Percentage-of-1RM table, the usual reference for picking a working weight. */
export function percentagesOf1RM(oneRmKg: number): { percent: number; weightKg: number; reps: string }[] {
  const rows: { percent: number; reps: string }[] = [
    { percent: 100, reps: "1" },
    { percent: 95, reps: "2" },
    { percent: 90, reps: "3-4" },
    { percent: 85, reps: "5-6" },
    { percent: 80, reps: "7-8" },
    { percent: 75, reps: "9-10" },
    { percent: 70, reps: "11-12" },
    { percent: 65, reps: "13-15" },
  ];
  return rows.map((r) => ({ ...r, weightKg: Math.round(oneRmKg * (r.percent / 100) * 2) / 2 }));
}
