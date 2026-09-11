import { newId } from "@/lib/utils/id";
import type { WorkoutPlan, WorkoutDay, WorkoutDayExercise, DayOfWeek, ExercisePriority } from "@/types/domain";

/**
 * The string ids below ("day_mon", ...) are internal correlation keys, used only to wire this
 * file's own definitions together (which exercises belong to which day). They must NEVER reach
 * Dexie as a real row id: this database is shared by every account via Dexie Cloud, which
 * enforces one globally unique primary key per table across ALL of them, not per account. Two
 * different people's programs writing "day_mon" or "plan_default" as their own row's id will
 * collide — the second account's insert gets silently rejected by the sync server. buildProgramSeed()
 * is what actually gets called, and it replaces every one of these with a fresh random id first.
 */
export const DAY_DEFS: readonly {
  id: string;
  dayOfWeek: DayOfWeek;
  label: string;
  isRestDay: boolean;
  order: number;
}[] = [
  { id: "day_mon", dayOfWeek: 1, label: "Chest + Triceps", isRestDay: false, order: 0 },
  { id: "day_tue", dayOfWeek: 2, label: "Back + Biceps", isRestDay: false, order: 1 },
  { id: "day_wed", dayOfWeek: 3, label: "Legs + Abs", isRestDay: false, order: 2 },
  { id: "day_thu", dayOfWeek: 4, label: "Chest + Shoulders + Triceps", isRestDay: false, order: 3 },
  { id: "day_fri", dayOfWeek: 5, label: "Back + Biceps", isRestDay: false, order: 4 },
  { id: "day_sat", dayOfWeek: 6, label: "Legs + Abs + Cardio", isRestDay: false, order: 5 },
  { id: "day_sun", dayOfWeek: 0, label: "Rest / Recovery", isRestDay: true, order: 6 },
];

type DayExDef = Omit<WorkoutDayExercise, "id" | "workoutDayId"> & { exerciseId: string };

function dayExercises(dayId: string, defs: DayExDef[]): WorkoutDayExercise[] {
  return defs.map((d, i) => ({
    id: `${dayId}_ex${i}`,
    workoutDayId: dayId,
    ...d,
  }));
}

const P = (n: number): ExercisePriority => n as ExercisePriority;

/** Template only — see the correlation-key warning above. Never bulkPut this directly. */
export const TEMPLATE_WORKOUT_DAY_EXERCISES: WorkoutDayExercise[] = [
  ...dayExercises("day_mon", [
    { exerciseId: "ex_barbell_bench_press", order: 0, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_incline_dumbbell_press", order: 1, priority: P(2), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 120 },
    { exerciseId: "ex_dumbbell_lateral_raise", order: 2, priority: P(2), targetSets: 4, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_triceps_pushdown", order: 3, priority: P(3), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_pec_deck_fly", order: 4, priority: P(4), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_overhead_triceps_extension", order: 5, priority: P(5), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
  ]),
  ...dayExercises("day_tue", [
    { exerciseId: "ex_lat_pulldown", order: 0, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 120 },
    { exerciseId: "ex_seated_cable_row", order: 1, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 120 },
    { exerciseId: "ex_face_pull", order: 2, priority: P(2), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_barbell_curl", order: 3, priority: P(3), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_hammer_curl", order: 4, priority: P(4), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_straight_arm_pulldown", order: 5, priority: P(5), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
  ]),
  ...dayExercises("day_wed", [
    { exerciseId: "ex_barbell_squat", order: 0, priority: P(1), targetSets: 3, repRangeMin: 6, repRangeMax: 10, restSeconds: 180 },
    { exerciseId: "ex_leg_press", order: 1, priority: P(2), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_leg_curl", order: 2, priority: P(2), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_leg_extension", order: 3, priority: P(3), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_calf_raise_machine", order: 4, priority: P(4), targetSets: 3, repRangeMin: 12, repRangeMax: 20, restSeconds: 60 },
    { exerciseId: "ex_cable_crunch", order: 5, priority: P(4), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_hanging_leg_raise", order: 6, priority: P(5), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
  ]),
  ...dayExercises("day_thu", [
    { exerciseId: "ex_incline_barbell_press", order: 0, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_dumbbell_shoulder_press", order: 1, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 120 },
    { exerciseId: "ex_dumbbell_lateral_raise", order: 2, priority: P(2), targetSets: 4, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_rear_delt_fly", order: 3, priority: P(2), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_triceps_pushdown", order: 4, priority: P(3), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_dumbbell_fly", order: 5, priority: P(5), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
  ]),
  ...dayExercises("day_fri", [
    { exerciseId: "ex_barbell_row", order: 0, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_assisted_pullup", order: 1, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 120 },
    { exerciseId: "ex_rear_delt_fly", order: 2, priority: P(2), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_ez_bar_curl", order: 3, priority: P(3), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 75 },
    { exerciseId: "ex_cable_curl", order: 4, priority: P(4), targetSets: 2, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_dumbbell_row", order: 5, priority: P(5), targetSets: 2, repRangeMin: 8, repRangeMax: 12, restSeconds: 90 },
  ]),
  ...dayExercises("day_sat", [
    { exerciseId: "ex_leg_press", order: 0, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_romanian_deadlift", order: 1, priority: P(1), targetSets: 3, repRangeMin: 8, repRangeMax: 12, restSeconds: 150 },
    { exerciseId: "ex_walking_lunge", order: 2, priority: P(2), targetSets: 3, repRangeMin: 10, repRangeMax: 12, restSeconds: 90 },
    { exerciseId: "ex_calf_raise_machine", order: 3, priority: P(3), targetSets: 3, repRangeMin: 12, repRangeMax: 20, restSeconds: 60 },
    { exerciseId: "ex_lying_leg_raise", order: 4, priority: P(4), targetSets: 3, repRangeMin: 10, repRangeMax: 15, restSeconds: 60 },
    { exerciseId: "ex_treadmill_walk", order: 5, priority: P(2), targetSets: 1, repRangeMin: 15, repRangeMax: 20, restSeconds: 0 },
  ]),
];

export interface ProgramSeed {
  plan: WorkoutPlan;
  days: WorkoutDay[];
  dayExercises: WorkoutDayExercise[];
}

/** Builds one account's default program with fresh, globally-unique ids on every call. */
export function buildProgramSeed(now: string): ProgramSeed {
  const planId = newId("plan");
  const dayIdMap = new Map(DAY_DEFS.map((d) => [d.id, newId("day")]));

  const plan: WorkoutPlan = { id: planId, name: "V-Shape Program", isActive: true, createdAt: now, updatedAt: now };

  const days: WorkoutDay[] = DAY_DEFS.map((d) => ({
    id: dayIdMap.get(d.id)!,
    planId,
    dayOfWeek: d.dayOfWeek,
    label: d.label,
    isRestDay: d.isRestDay,
    order: d.order,
  }));

  const dayExercisesOut: WorkoutDayExercise[] = TEMPLATE_WORKOUT_DAY_EXERCISES.map((e) => ({
    ...e,
    id: newId("wdex"),
    workoutDayId: dayIdMap.get(e.workoutDayId)!,
  }));

  return { plan, days, dayExercises: dayExercisesOut };
}
