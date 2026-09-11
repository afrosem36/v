import Dexie, { type EntityTable } from "dexie";
import dexieCloud from "dexie-cloud-addon";
import { takePendingCredentials } from "@/lib/auth/passwordBridge";
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
} from "@/types/domain";

/**
 * Every account gets its own IndexedDB database, so two people sharing a phone never see
 * each other's training even if Dexie Cloud's own logout doesn't purge a shared local cache.
 * The first account keeps the original "vshape" name, which is what makes pre-accounts data
 * carry over untouched.
 */
export const LEGACY_DB_NAME = "vshape";

/**
 * The public sync endpoint from `npx dexie-cloud create` (see dexie-cloud.json). Not a secret —
 * the real secret is dexie-cloud.key, which never leaves the machine that ran the CLI and is
 * never read by this app. Undefined in any environment where sync hasn't been set up yet, in
 * which case the app runs exactly as it did before: fully local, no login required.
 */
export const DEXIE_CLOUD_URL = process.env.NEXT_PUBLIC_DEXIE_CLOUD_URL || null;

/**
 * Stock reference data (the exercise/equipment/muscle library) is identical bundled JSON on
 * every device and is re-seeded locally by ensureSeeded() — round-tripping it through the cloud
 * would just burn the free tier's request-rate limit and 100MB storage cap for no benefit.
 * Progress photos stay local for the same storage-budget reason (Dexie Cloud does support
 * syncing Blobs, but photos are the one table that could actually blow through a free-tier
 * quota) plus a privacy-by-default argument: body photos staying off any server unless the user
 * explicitly asks otherwise is the safer default. Custom exercises are real user data and sync
 * via their own small table instead (see customExercises + seed/index.ts materialization).
 */
const UNSYNCED_TABLES = ["muscleGroups", "equipment", "exercises", "progressPhotos"];

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

  constructor(name: string) {
    super(name, DEXIE_CLOUD_URL ? { addons: [dexieCloud] } : undefined);
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

    if (DEXIE_CLOUD_URL) {
      this.cloud.configure({
        databaseUrl: DEXIE_CLOUD_URL,
        requireAuth: true,
        unsyncedTables: UNSYNCED_TABLES,
        // Bridges our own email+password to Dexie Cloud: verifies the password server-side
        // (see /api/auth/token) and only then mints a real Dexie Cloud session for it. Providing
        // this replaces Dexie's own built-in email-code login entirely — it's never shown.
        fetchTokens: async ({ public_key }) => {
          const credentials = takePendingCredentials();
          if (!credentials) throw new Error("Not signed in.");
          const res = await fetch("/api/auth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: credentials.email, password: credentials.password, publicKey: public_key }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "Sign-in failed.");
          }
          return res.json();
        },
      });
    }
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
