import type { VshapeDB } from "@/lib/db/db";

/**
 * Every Dexie table that holds real user data and needs to reach other devices.
 * Deliberately excludes: muscleGroups/equipment/exercises (stock reference data, identical
 * on every install, re-seeded from src/lib/db/seed/ rather than synced), progressPhotos
 * (raw Blob — local-only, same exclusion the JSON backup already makes), and syncOutbox
 * itself (device-local bookkeeping, never synced).
 */
export const SYNCED_TABLES = [
  "userEquipment",
  "workoutPlans",
  "workoutDays",
  "workoutDayExercises",
  "workoutSessions",
  "exerciseSets",
  "personalRecords",
  "bodyWeights",
  "bodyMeasurements",
  "dailySteps",
  "appSettings",
  "scheduleOverrides",
  "exerciseNotes",
  "coachPlans",
  "planSnapshots",
  "partnerMessages",
  "customExercises",
] as const satisfies readonly (keyof VshapeDB & string)[];

export type SyncedTableName = (typeof SYNCED_TABLES)[number];

/**
 * Seeded locally by doSeed() before any sync ever runs, each with device-generated random
 * ids. When a device joins an account that's already synced elsewhere, these placeholders
 * must be wiped before the real synced rows land — otherwise the "one settings row" and
 * the ids workoutSessions.workoutDayId/exerciseSets reference would fork per device. See
 * bootstrap.ts.
 */
export const FULL_REPLACE_TABLES: readonly SyncedTableName[] = ["appSettings", "workoutPlans", "workoutDays", "workoutDayExercises"];
