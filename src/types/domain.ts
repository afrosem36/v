// Core domain model. Every persisted entity gets a uuid id + timestamps.

export type Id = string;

export type MuscleGroupKey =
  | "lateral_delts"
  | "lats"
  | "rear_delts"
  | "upper_chest"
  | "chest"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "front_delts"
  | "traps"
  | "full_body";

export interface MuscleGroup {
  id: Id;
  key: MuscleGroupKey;
  label: string;
  /** Lower number = higher priority for the V-shape goal (1 = highest). */
  vShapePriority: number;
}

export type EquipmentKey =
  | "dumbbell"
  | "barbell"
  | "adjustable_bench"
  | "flat_bench"
  | "incline_bench"
  | "squat_rack"
  | "cable_machine"
  | "lat_pulldown"
  | "seated_cable_row"
  | "leg_press"
  | "leg_extension"
  | "leg_curl"
  | "chest_press_machine"
  | "pec_deck"
  | "shoulder_press_machine"
  | "smith_machine"
  | "pull_up_bar"
  | "ez_curl_bar"
  | "treadmill"
  | "exercise_bike"
  | "bodyweight";

export interface Equipment {
  id: Id;
  key: EquipmentKey;
  label: string;
}

export type MovementType = "push" | "pull" | "squat" | "hinge" | "carry" | "isolation" | "cardio";
export type ExerciseLevel = "beginner" | "intermediate" | "advanced";
export type LoadType = "dumbbell_each" | "barbell" | "machine_stack" | "bodyweight" | "cardio";

export interface Exercise {
  id: Id;
  name: string;
  /** True for exercises the user (or an imported coach plan) created — never overwritten by library syncs. */
  isCustom?: boolean;
  primaryMuscle: MuscleGroupKey;
  secondaryMuscles: MuscleGroupKey[];
  equipment: EquipmentKey[];
  movementType: MovementType;
  isCompound: boolean;
  level: ExerciseLevel;
  loadType: LoadType;
  repUnit: "reps" | "seconds" | "minutes";
  repRangeMin: number;
  repRangeMax: number;
  recommendedSets: number;
  restSeconds: number;
  instructions: string;
  formCues: string[];
  commonMistakes: string[];
  /** Ordered list of exercise ids to substitute, best first, when equipment is missing. */
  alternativeExerciseIds: Id[];
  createdAt: string;
  updatedAt: string;
}

export interface UserEquipment {
  id: Id;
  equipmentKey: EquipmentKey;
  available: boolean;
  updatedAt: string;
}

/** Smallest weight step the user can actually load, per load type. */
export interface EquipmentIncrements {
  dumbbellStepKg: number;
  /** Smallest single plate available per side, e.g. 1.25kg. */
  plateStepKg: number;
  barWeightKg: number;
  machineStepKg: number;
}

export interface WorkoutPlan {
  id: Id;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface WorkoutDay {
  id: Id;
  planId: Id;
  dayOfWeek: DayOfWeek;
  label: string; // e.g. "Chest + Triceps"
  isRestDay: boolean;
  order: number;
}

export type ExercisePriority = 1 | 2 | 3 | 4 | 5; // 1 = never skip, 5 = optional/first cut

export interface WorkoutDayExercise {
  id: Id;
  workoutDayId: Id;
  exerciseId: Id;
  order: number;
  priority: ExercisePriority;
  targetSets: number;
  repRangeMin: number;
  repRangeMax: number;
  restSeconds: number;
}

export type SessionStatus = "active" | "completed" | "abandoned";

export interface WorkoutSession {
  id: Id;
  workoutDayId: Id | null;
  label: string;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  /** short workout mode target, minutes */
  timeBudgetMinutes: number | null;
  notes: string | null;
  /** yyyy-mm-dd the session was started for. Older rows predate this field — fall back to startedAt. */
  scheduledDate?: string;
}

export type WeightEntryMode = "dumbbell_each" | "barbell_total" | "machine" | "bodyweight" | "assisted";

export interface ExerciseSet {
  id: Id;
  sessionId: Id;
  exerciseId: Id;
  setNumber: number;
  isWarmup: boolean;
  weightEntryMode: WeightEntryMode;
  /** Per-hand for dumbbells, total for machine/bodyweight. */
  weightKg: number;
  barWeightKg: number | null;
  platePerSideKg: number | null;
  assistKg: number | null;
  reps: number;
  rir: number | null;
  painFlag: boolean;
  completedAt: string;
}

export type PRType = "heaviest_weight" | "best_reps_at_weight" | "est_1rm" | "volume";

export interface PersonalRecord {
  id: Id;
  exerciseId: Id;
  type: PRType;
  value: number;
  weightKg: number | null;
  reps: number | null;
  achievedAt: string;
  sessionId: Id;
  /** True when this was set on the exercise's first-ever session — a baseline, not an earned record. Not celebrated in the UI. */
  isBaseline?: boolean;
}

export type WeightUnit = "kg" | "lb";

export interface BodyWeight {
  id: Id;
  date: string; // yyyy-mm-dd
  weightKg: number;
  /** Optional — only if the user's scale/caliper gives a reading. Used to estimate fat mass trend. */
  bodyFatPercent: number | null;
  notes: string | null;
  createdAt: string;
}

export interface BodyMeasurement {
  id: Id;
  date: string;
  waistCm: number | null;
  chestCm: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  createdAt: string;
}

export interface DailySteps {
  id: Id;
  date: string; // yyyy-mm-dd, unique
  steps: number;
  source: "manual" | "healthkit";
  updatedAt: string;
}

export type PhotoAngle = "front" | "side" | "back";

export interface ProgressPhoto {
  id: Id;
  date: string;
  angle: PhotoAngle;
  blob: Blob;
  createdAt: string;
}

export interface ExerciseAlternative {
  id: Id;
  exerciseId: Id;
  alternativeExerciseId: Id;
  rank: number;
}

export type TrainingPhase = "calibration" | "steady_state";

export type Gender = "male" | "female" | "other" | "unspecified";

export interface AppSettings {
  id: Id; // singleton, fixed id "settings"
  /**
   * Profile fields live here rather than in a separate account table so they sync via Dexie
   * Cloud along with everything else — logging in on a second device should show the same
   * name and goal, not just the same workouts. Empty `name` means the person hasn't completed
   * the post-login profile step yet.
   */
  name: string;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  goal: TrainingGoal | null;
  units: WeightUnit;
  stepGoal: number;
  defaultRestCompoundSec: number;
  defaultRestIsolationSec: number;
  defaultRestAbsSec: number;
  equipmentIncrements: EquipmentIncrements;
  trainingPhase: TrainingPhase;
  phaseStartedAt: string;
  firstWorkoutCompletedAt: string | null;
  theme: "dark";
  lastActiveWorkoutDate: string | null;
  /** Undefined/1 = original seed. Bumped whenever exercises/program reference data is corrected post-launch. */
  libraryVersion?: number;
  heightCm: number | null;
  goalWeightKg: number | null;
  /**
   * Set the moment the user edits their program or applies a coach plan. Once set, library
   * syncs stop re-applying the seeded weekly program over the top of their own.
   */
  planCustomizedAt?: string | null;
  /**
   * Null until the account has a real program — a coach plan imported from ChatGPT, or (for
   * accounts that predate this) any logged training history. The app is gated on it.
   */
  onboardingCompletedAt?: string | null;
}

// ---------------- Scheduling ----------------

/**
 * Pins a specific calendar date to a specific routine (or to rest, when workoutDayId is null),
 * without editing the weekly plan. This is how a missed Tuesday gets trained on Wednesday.
 */
export interface ScheduleOverride {
  id: Id;
  date: string; // yyyy-mm-dd, unique
  workoutDayId: Id | null;
  createdAt: string;
}

export interface ExerciseNote {
  id: Id;
  exerciseId: Id; // unique
  text: string;
  updatedAt: string;
}

// ---------------- Coach / goals ----------------

export type TrainingGoal = "vshape" | "lean" | "bulk" | "strength" | "recomp" | "general";

export type CoachPlanStatus = "imported" | "applied" | "discarded";

/** A training plan pasted back from ChatGPT, after local validation and auto-improvement. */
export interface CoachPlanRecord {
  id: Id;
  createdAt: string;
  name: string;
  summary: string;
  goal: TrainingGoal;
  weeksCovered: number;
  /** The validated + improved bundle, serialized. Shape: CoachPlanBundle in lib/coach/contract.ts */
  bundleJson: string;
  status: CoachPlanStatus;
  appliedAt: string | null;
  improvements: string[];
  warnings: string[];
}

/** Full copy of the weekly plan taken immediately before a coach plan is applied, so it can be reverted. */
export interface PlanSnapshot {
  id: Id;
  createdAt: string;
  label: string;
  payloadJson: string;
}
