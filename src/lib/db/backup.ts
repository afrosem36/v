import { db } from "@/lib/db/db";
import { getCompletedSessions } from "@/lib/db/repo/workouts";
import { totalLoadForSet } from "@/lib/engine/weight-math";

const BACKUP_VERSION = 2;

interface BackupPayload {
  version: number;
  exportedAt: string;
  data: {
    workoutPlans: unknown[];
    workoutDays: unknown[];
    workoutDayExercises: unknown[];
    workoutSessions: unknown[];
    exerciseSets: unknown[];
    personalRecords: unknown[];
    bodyWeights: unknown[];
    bodyMeasurements: unknown[];
    dailySteps: unknown[];
    appSettings: unknown[];
    userEquipment: unknown[];
    // v2 additions. Restoring a v1 file leaves these empty rather than failing.
    scheduleOverrides?: unknown[];
    exerciseNotes?: unknown[];
    coachPlans?: unknown[];
    customExercises?: unknown[];
  };
}

/**
 * Excludes the stock exercise/equipment/muscle library (re-derived on import) and photos
 * (binary, kept device-local). Custom exercises ARE included — nothing else can recreate them.
 * Account credentials are never exported.
 */
export async function exportAllDataJSON(): Promise<string> {
  const [
    workoutPlans,
    workoutDays,
    workoutDayExercises,
    workoutSessions,
    exerciseSets,
    personalRecords,
    bodyWeights,
    bodyMeasurements,
    dailySteps,
    appSettings,
    userEquipment,
    scheduleOverrides,
    exerciseNotes,
    coachPlans,
    allExercises,
  ] = await Promise.all([
    db.workoutPlans.toArray(),
    db.workoutDays.toArray(),
    db.workoutDayExercises.toArray(),
    db.workoutSessions.toArray(),
    db.exerciseSets.toArray(),
    db.personalRecords.toArray(),
    db.bodyWeights.toArray(),
    db.bodyMeasurements.toArray(),
    db.dailySteps.toArray(),
    db.appSettings.toArray(),
    db.userEquipment.toArray(),
    db.scheduleOverrides.toArray(),
    db.exerciseNotes.toArray(),
    db.coachPlans.toArray(),
    db.exercises.toArray(),
  ]);

  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workoutPlans,
      workoutDays,
      workoutDayExercises,
      workoutSessions,
      exerciseSets,
      personalRecords,
      bodyWeights,
      bodyMeasurements,
      dailySteps,
      appSettings,
      userEquipment,
      scheduleOverrides,
      exerciseNotes,
      coachPlans,
      customExercises: allExercises.filter((e) => e.isCustom),
    },
  };
  return JSON.stringify(payload, null, 2);
}

export async function importAllDataJSON(json: string): Promise<void> {
  const parsed = JSON.parse(json) as BackupPayload;
  const d = parsed.data;

  await db.transaction(
    "rw",
    [
      db.workoutPlans,
      db.workoutDays,
      db.workoutDayExercises,
      db.workoutSessions,
      db.exerciseSets,
      db.personalRecords,
      db.bodyWeights,
      db.bodyMeasurements,
      db.dailySteps,
      db.appSettings,
      db.userEquipment,
      db.scheduleOverrides,
      db.exerciseNotes,
      db.coachPlans,
      db.exercises,
    ],
    async () => {
      await Promise.all([
        db.workoutPlans.clear(),
        db.workoutDays.clear(),
        db.workoutDayExercises.clear(),
        db.workoutSessions.clear(),
        db.exerciseSets.clear(),
        db.personalRecords.clear(),
        db.bodyWeights.clear(),
        db.bodyMeasurements.clear(),
        db.dailySteps.clear(),
        db.appSettings.clear(),
        db.userEquipment.clear(),
        db.scheduleOverrides.clear(),
        db.exerciseNotes.clear(),
        db.coachPlans.clear(),
      ]);
      // biome-ignore-start
      await db.workoutPlans.bulkAdd(d.workoutPlans as never[]);
      await db.workoutDays.bulkAdd(d.workoutDays as never[]);
      await db.workoutDayExercises.bulkAdd(d.workoutDayExercises as never[]);
      await db.workoutSessions.bulkAdd(d.workoutSessions as never[]);
      await db.exerciseSets.bulkAdd(d.exerciseSets as never[]);
      await db.personalRecords.bulkAdd(d.personalRecords as never[]);
      await db.bodyWeights.bulkAdd(d.bodyWeights as never[]);
      await db.bodyMeasurements.bulkAdd(d.bodyMeasurements as never[]);
      await db.dailySteps.bulkAdd(d.dailySteps as never[]);
      await db.appSettings.bulkAdd(d.appSettings as never[]);
      await db.userEquipment.bulkAdd(d.userEquipment as never[]);
      await db.scheduleOverrides.bulkAdd((d.scheduleOverrides ?? []) as never[]);
      await db.exerciseNotes.bulkAdd((d.exerciseNotes ?? []) as never[]);
      await db.coachPlans.bulkAdd((d.coachPlans ?? []) as never[]);
      // Custom exercises are merged rather than cleared — the stock library must survive.
      if (d.customExercises?.length) await db.exercises.bulkPut(d.customExercises as never[]);
      // biome-ignore-end
    }
  );
}

function csvEscape(value: string | number | boolean | null): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportWorkoutHistoryCSV(): Promise<string> {
  const sessions = await getCompletedSessions(10000);
  const rows: string[] = ["date,workout_label,exercise_id,set_number,weight_kg,reps,rir,pain,total_load_kg"];

  for (const session of sessions) {
    const sets = await db.exerciseSets.where("sessionId").equals(session.id).sortBy("setNumber");
    for (const s of sets) {
      rows.push(
        [
          csvEscape(session.startedAt.slice(0, 10)),
          csvEscape(session.label),
          csvEscape(s.exerciseId),
          csvEscape(s.setNumber),
          csvEscape(s.weightKg),
          csvEscape(s.reps),
          csvEscape(s.rir),
          csvEscape(s.painFlag),
          csvEscape(Math.round(totalLoadForSet(s) * s.reps)),
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

export async function clearAllData(): Promise<void> {
  await db.delete();
}
