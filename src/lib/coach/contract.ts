import type { EquipmentKey, MuscleGroupKey, TrainingGoal } from "@/types/domain";
import type { ExperienceLevel } from "./goals";

/**
 * The shape the app asks ChatGPT for and the only shape it will accept back. Bumping
 * CONTRACT_VERSION means old pasted plans stop importing, so change it only when the schema
 * genuinely breaks.
 */
export const CONTRACT_VERSION = 1;

export interface CoachExercise {
  /** Library id when ChatGPT used one; otherwise matched by `name`. */
  id: string;
  name?: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds?: number;
  /** 1 = never skip this, 5 = first thing to cut when time is short. */
  priority?: number;
  why?: string;
}

export interface CoachRoutine {
  id: string;
  name: string;
  why?: string;
  exercises: CoachExercise[];
}

export interface CoachBlock {
  id: string;
  name: string;
  weekStart: number;
  weekEnd: number;
  focus?: string;
  /** Weekday number as string ("0" = Sunday) → routine id in this same block. */
  week: Record<string, string>;
  routines: CoachRoutine[];
}

export interface CoachCustomExercise {
  id: string;
  name: string;
  primaryMuscle: MuscleGroupKey;
  equipment: EquipmentKey[];
  instructions?: string;
}

export interface CoachPlanBundle {
  vshape_plan: number;
  name: string;
  summary: string;
  goal: TrainingGoal;
  daysPerWeek: number;
  blocks: CoachBlock[];
  customExercises: CoachCustomExercise[];
}

/** Everything the user tells us before we write the prompt. */
export interface IntakeAnswers {
  goal: TrainingGoal;
  splitStyle: string;
  daysPerWeek: number;
  sessionMinutes: number;
  experience: ExperienceLevel;
  ageYears: number | null;
  gender: string;
  heightCm: number | null;
  weightKg: number | null;
  goalWeightKg: number | null;
  limitations: string;
  dislikes: string;
  notes: string;
  includePhotoInstruction: boolean;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  bundle: CoachPlanBundle;
  /** Non-fatal things that were silently repaired during validation. */
  repairs: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;
