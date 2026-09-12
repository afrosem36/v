import { db, currentTrainingDbName } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import { MUSCLE_GROUP_SEED } from "./muscle-groups";
import { EQUIPMENT_SEED, DEFAULT_AVAILABLE_EQUIPMENT } from "./equipment";
import { EXERCISE_SEED } from "./exercises";
import { DAY_DEFS, TEMPLATE_WORKOUT_DAY_EXERCISES, buildProgramSeed } from "./program";
import type { AppSettings, EquipmentKey } from "@/types/domain";

/**
 * Bump whenever exercises.ts / program.ts reference data changes (rep ranges, priorities,
 * new exercises, etc). syncLibraryIfNeeded() re-applies that reference data to existing
 * installs without touching user-generated data (sessions, sets, PRs, steps, weight,
 * equipment availability toggles).
 */
const LIBRARY_VERSION = 2;

function defaultSettings(now: string): AppSettings {
  return {
    id: newId("settings"),
    name: "",
    dateOfBirth: null,
    gender: "unspecified",
    phone: null,
    goal: null,
    units: "kg",
    stepGoal: 8000,
    defaultRestCompoundSec: 150,
    defaultRestIsolationSec: 75,
    defaultRestAbsSec: 60,
    equipmentIncrements: {
      dumbbellStepKg: 2,
      plateStepKg: 1.25,
      barWeightKg: 20,
      machineStepKg: 5,
    },
    trainingPhase: "calibration",
    phaseStartedAt: now,
    firstWorkoutCompletedAt: null,
    theme: "dark",
    lastActiveWorkoutDate: null,
    libraryVersion: LIBRARY_VERSION,
    heightCm: null,
    goalWeightKg: null,
    planCustomizedAt: null,
    onboardingCompletedAt: null,
  };
}

/** Keyed by database name — each account has its own database, and each needs its own seed pass. */
const seedingPromises = new Map<string, Promise<void>>();

/** Idempotent: seeds on first run, then syncs corrected reference data on every subsequent boot. */
export function ensureSeeded(): Promise<void> {
  const key = currentTrainingDbName() ?? "vshape";
  let pending = seedingPromises.get(key);
  if (!pending) {
    pending = doSeed()
      .then(() => backfillSettingsDefaults())
      .then(() => syncLibraryIfNeeded())
      .then(() => materializeCustomExercises());
    seedingPromises.set(key, pending);
  }
  return pending;
}

/**
 * Fields added to AppSettings after launch (name, gender, phone, goal, heightCm, ...) never got a
 * migration, since adding a non-indexed field doesn't need a Dexie version bump — so any account
 * seeded before that field existed is still missing it entirely (not "", not null: absent).
 * `settings.name.trim()` in AuthProvider then throws on `undefined`. Patches in only the keys the
 * existing row actually lacks, so nothing already set by the user (or by an older backfill) is
 * ever overwritten.
 */
async function backfillSettingsDefaults(): Promise<void> {
  const settings = await db.appSettings.toCollection().first();
  if (!settings) return;

  const defaults = defaultSettings(settings.phaseStartedAt ?? new Date().toISOString());
  const patch: Partial<AppSettings> = {};
  for (const key of Object.keys(defaults) as (keyof AppSettings)[]) {
    if (key === "id") continue;
    if (!(key in settings)) (patch as Record<string, unknown>)[key] = defaults[key];
  }

  if (Object.keys(patch).length > 0) {
    await db.appSettings.toCollection().modify(patch);
  }
}

/**
 * `exercises` is excluded from Dexie Cloud sync (it's identical bundled data on every device),
 * but a custom exercise created via a coach plan is real user data and needs to reach other
 * devices. It's written to the small synced `customExercises` table at creation time (see
 * lib/db/repo/coach.ts) and copied into the local `exercises` table here — on THIS device
 * immediately, and on any other device the next time it boots after that row has synced down.
 */
export async function materializeCustomExercises(): Promise<void> {
  const custom = await db.customExercises.toArray();
  if (custom.length > 0) await db.exercises.bulkPut(custom);
}

/**
 * Gated on `appSettings` having a row — the LAST thing this function writes — rather than on
 * `exercises` having rows. `exercises` is unsynced local library data; `appSettings` is synced.
 * If a first run ever gets interrupted after the library seeds but before that row lands (a
 * closed tab, a revoked session mid-sync), gating on `exercises` alone would permanently skip
 * the rest of seeding on every later attempt — the account would look "already seeded" while
 * lacking a program or settings row at all. Every write here uses `bulkPut`/`put` (not
 * `bulkAdd`/`add`) so a retry after a partial run never throws a ConstraintError on rows that
 * did land.
 *
 * `appSettings` has no fixed id (see program.ts's warning) — it's looked up as "whichever single
 * row this account's own database holds", never by a shared literal, since Dexie Cloud enforces
 * one global primary key per table across every account sharing this database.
 */
async function doSeed(): Promise<void> {
  const existingSettings = await db.appSettings.toCollection().first();
  if (existingSettings) return;

  const now = new Date().toISOString();
  const { plan, days, dayExercises } = buildProgramSeed(now);

  await db.transaction(
    "rw",
    [db.muscleGroups, db.equipment, db.exercises, db.userEquipment, db.workoutPlans, db.workoutDays, db.workoutDayExercises, db.appSettings],
    async () => {
      await db.muscleGroups.bulkPut(MUSCLE_GROUP_SEED);
      await db.equipment.bulkPut(EQUIPMENT_SEED);
      await db.exercises.bulkPut(EXERCISE_SEED.map((e) => ({ ...e, createdAt: now, updatedAt: now })));

      const availableSet = new Set<EquipmentKey>(DEFAULT_AVAILABLE_EQUIPMENT);
      await db.userEquipment.bulkPut(
        EQUIPMENT_SEED.map((eq) => ({
          id: newId("ue"),
          equipmentKey: eq.key,
          available: eq.key === "bodyweight" ? true : availableSet.has(eq.key),
          updatedAt: now,
        }))
      );

      await db.workoutPlans.put(plan);
      await db.workoutDays.bulkPut(days);
      await db.workoutDayExercises.bulkPut(dayExercises);

      // Re-checked inside the transaction: another concurrent seed attempt (e.g. a second tab)
      // may have already written it since the check at the top of this function.
      if (!(await db.appSettings.toCollection().first())) {
        await db.appSettings.add(defaultSettings(now));
      }
    }
  );
}

/**
 * Re-applies corrected exercise/program reference data on top of an existing install.
 * Reference tables (muscleGroups, equipment, exercises) are fully re-synced — they're library
 * data, never user-edited directly, except for custom exercises, which are left alone.
 *
 * The seeded weekly program is only re-applied while the user still has the stock program.
 * `planCustomizedAt` is stamped the moment they edit a day or apply a coach plan, and from
 * then on a library bump never overwrites their own program. When it does re-apply, the
 * corrected template is remapped onto THIS account's own existing day ids (matched by
 * dayOfWeek) rather than the template's placeholder ids — see program.ts's warning on why a
 * shared literal id can never be written here.
 */
async function syncLibraryIfNeeded(): Promise<void> {
  const settings = await db.appSettings.toCollection().first();
  const currentVersion = settings?.libraryVersion ?? 1;
  if (currentVersion >= LIBRARY_VERSION) return;

  const now = new Date().toISOString();
  const planIsCustomized = settings?.planCustomizedAt != null;

  await db.transaction("rw", [db.muscleGroups, db.equipment, db.exercises, db.userEquipment, db.workoutDays, db.workoutDayExercises, db.appSettings], async () => {
    await db.muscleGroups.bulkPut(MUSCLE_GROUP_SEED);
    await db.equipment.bulkPut(EQUIPMENT_SEED);

    const existingExercises = await db.exercises.toArray();
    const createdAtById = new Map(existingExercises.map((e) => [e.id, e.createdAt]));
    await db.exercises.bulkPut(
      EXERCISE_SEED.map((e) => ({ ...e, createdAt: createdAtById.get(e.id) ?? now, updatedAt: now }))
    );

    if (!planIsCustomized) {
      const existingDays = await db.workoutDays.toArray();
      const realDayIdByDow = new Map(existingDays.map((d) => [d.dayOfWeek, d.id]));
      const dowByTemplateKey = new Map(DAY_DEFS.map((d) => [d.id, d.dayOfWeek]));

      const remapped = TEMPLATE_WORKOUT_DAY_EXERCISES.flatMap((e) => {
        const dow = dowByTemplateKey.get(e.workoutDayId);
        const realDayId = dow != null ? realDayIdByDow.get(dow) : undefined;
        return realDayId ? [{ ...e, id: newId("wdex"), workoutDayId: realDayId }] : [];
      });

      await db.workoutDayExercises.clear();
      await db.workoutDayExercises.bulkAdd(remapped);
    }

    const existingEquipmentKeys = new Set((await db.userEquipment.toArray()).map((u) => u.equipmentKey));
    const newEquipment = EQUIPMENT_SEED.filter((eq) => !existingEquipmentKeys.has(eq.key));
    if (newEquipment.length > 0) {
      await db.userEquipment.bulkAdd(
        newEquipment.map((eq) => ({ id: newId("ue"), equipmentKey: eq.key, available: true, updatedAt: now }))
      );
    }

    await db.appSettings.toCollection().modify({ libraryVersion: LIBRARY_VERSION });
  });
}
