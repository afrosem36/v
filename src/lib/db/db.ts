import Dexie, { type EntityTable } from "dexie";
import type {
  MuscleGroup,
  Equipment,
  Exercise,
  UserEquipment,
  WorkoutPlan,
  WorkoutDay,
  WorkoutDayExercise,
  WorkoutSession,
  ExerciseSet,
  PersonalRecord,
  BodyWeight,
  BodyMeasurement,
  DailySteps,
  ProgressPhoto,
  AppSettings,
  ScheduleOverride,
  ExerciseNote,
  CoachPlanRecord,
  PlanSnapshot,
  PartnerMessage,
} from "@/types/domain";

/**
 * Every account gets its own IndexedDB database, so two people sharing a phone never see
 * each other's training even if signing out doesn't purge a shared local cache. The first account
 * keeps the original "vshape" name, which is what makes pre-accounts data carry over untouched.
 */
export const LEGACY_DB_NAME = "vshape";

export class VshapeDB extends Dexie {
  muscleGroups!: EntityTable<MuscleGroup, "id">;
  equipment!: EntityTable<Equipment, "id">;
  exercises!: EntityTable<Exercise, "id">;
  userEquipment!: EntityTable<UserEquipment, "id">;
  workoutPlans!: EntityTable<WorkoutPlan, "id">;
  workoutDays!: EntityTable<WorkoutDay, "id">;
  workoutDayExercises!: EntityTable<WorkoutDayExercise, "id">;
  workoutSessions!: EntityTable<WorkoutSession, "id">;
  exerciseSets!: EntityTable<ExerciseSet, "id">;
  personalRecords!: EntityTable<PersonalRecord, "id">;
  bodyWeights!: EntityTable<BodyWeight, "id">;
  bodyMeasurements!: EntityTable<BodyMeasurement, "id">;
  dailySteps!: EntityTable<DailySteps, "id">;
  progressPhotos!: EntityTable<ProgressPhoto, "id">;
  appSettings!: EntityTable<AppSettings, "id">;
  scheduleOverrides!: EntityTable<ScheduleOverride, "id">;
  exerciseNotes!: EntityTable<ExerciseNote, "id">;
  coachPlans!: EntityTable<CoachPlanRecord, "id">;
  planSnapshots!: EntityTable<PlanSnapshot, "id">;
  /** Custom exercises only, mirrored from `exercises` so they can sync without the stock library. */
  customExercises!: EntityTable<Exercise, "id">;
  partnerMessages!: EntityTable<PartnerMessage, "id">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      muscleGroups: "id, key",
      equipment: "id, key",
      exercises: "id, primaryMuscle, name",
      userEquipment: "id, equipmentKey",
      workoutPlans: "id, isActive",
      workoutDays: "id, planId, dayOfWeek",
      workoutDayExercises: "id, workoutDayId, exerciseId, order",
      workoutSessions: "id, status, startedAt, workoutDayId",
      exerciseSets: "id, sessionId, exerciseId, [exerciseId+completedAt], completedAt",
      personalRecords: "id, exerciseId, type, [exerciseId+type]",
      bodyWeights: "id, &date",
      bodyMeasurements: "id, &date",
      dailySteps: "id, &date",
      progressPhotos: "id, date, angle",
      appSettings: "id",
    });
    // v2: personalRecords.sessionId needed its own index (getPRsForSession threw without it);
    // added compound indexes the query planner was falling back and warning on.
    this.version(2).stores({
      workoutDays: "id, planId, dayOfWeek, [planId+dayOfWeek]",
      exerciseSets: "id, sessionId, exerciseId, [exerciseId+completedAt], [sessionId+exerciseId], completedAt",
      personalRecords: "id, exerciseId, sessionId, type, [exerciseId+type]",
    });
    // v3: per-date schedule overrides (train any day's routine on any date), per-exercise notes,
    // and storage for AI coach plans + the plan snapshots that make applying one revertible.
    this.version(3).stores({
      scheduleOverrides: "id, &date",
      exerciseNotes: "id, &exerciseId",
      coachPlans: "id, createdAt, status",
      planSnapshots: "id, createdAt",
    });
    // v4: customExercises — the sync-eligible mirror of any exercise created via a coach plan.
    this.version(4).stores({
      customExercises: "id, primaryMuscle",
    });
    // v5: the AI training partner's conversation history.
    this.version(5).stores({
      partnerMessages: "id, createdAt",
    });
    // v6: dailySteps/bodyWeights/bodyMeasurements/scheduleOverrides/exerciseNotes used `&field`
    // (unique) indexes on date/exerciseId. That's enforced locally, including against rows Dexie
    // Cloud's sync engine merges in from another device — so two devices logging the same date
    // before either had synced turned an ordinary, self-resolving race into a permanent
    // ConstraintError that broke the sync queue (`dailySteps.bulkPut(): ... does not satisfy the
    // uniqueness requirements`). Dropping `&` makes these plain indexes; findOneDeduped()
    // (repo/dedupe.ts) is what now enforces "one row per key" at the application layer instead,
    // by keeping the most recently touched duplicate and deleting the rest. The upgrade below
    // cleans out any duplicates already stuck from a past crash.
    this.version(6)
      .stores({
        bodyWeights: "id, date",
        bodyMeasurements: "id, date",
        dailySteps: "id, date",
        scheduleOverrides: "id, date",
        exerciseNotes: "id, exerciseId",
      })
      .upgrade(async (tx) => {
        const dedupeTable = async (tableName: string, key: string) => {
          const table = tx.table(tableName);
          const rows: Array<Record<string, unknown>> = await table.toArray();
          const byKey = new Map<string, Array<Record<string, unknown>>>();
          for (const row of rows) {
            const k = String(row[key]);
            const list = byKey.get(k) ?? [];
            list.push(row);
            byKey.set(k, list);
          }
          for (const group of byKey.values()) {
            if (group.length <= 1) continue;
            group.sort((a, b) =>
              String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""))
            );
            const extras = group.slice(1);
            await table.bulkDelete(extras.map((r) => r.id as string));
          }
        };
        await dedupeTable("bodyWeights", "date");
        await dedupeTable("bodyMeasurements", "date");
        await dedupeTable("dailySteps", "date");
        await dedupeTable("scheduleOverrides", "date");
        await dedupeTable("exerciseNotes", "exerciseId");
      });
  }
}

let instance: VshapeDB | null = null;

/** Opens (or returns) the training database for a given account. Closes the previous one on switch. */
export function openTrainingDb(name: string): VshapeDB {
  if (instance && instance.name === name) return instance;
  if (instance) instance.close();
  instance = new VshapeDB(name);
  return instance;
}

export function currentTrainingDbName(): string | null {
  return instance?.name ?? null;
}

/** Dexie.delete() blocks while a connection is open, so anything deleting a database closes it first. */
export function closeTrainingDb(): void {
  instance?.close();
  instance = null;
}

/**
 * The single `db` every repo imports. It forwards to whichever account's database is open, so
 * modules can keep a static import while the underlying database is chosen at login time.
 * Nothing may read `db` before AppBootstrap has resolved an account — the fallback to the
 * legacy name exists only so a stray early read can't crash the app.
 */
export const db = new Proxy({} as VshapeDB, {
  get(_target, prop) {
    const active = instance ?? openTrainingDb(LEGACY_DB_NAME);
    // Deliberately not forwarding the receiver: Dexie's getters must resolve `this` to the real
    // instance, not to this proxy.
    const value = Reflect.get(active, prop);
    return typeof value === "function" ? value.bind(active) : value;
  },
  has(_target, prop) {
    return Reflect.has(instance ?? openTrainingDb(LEGACY_DB_NAME), prop);
  },
});
