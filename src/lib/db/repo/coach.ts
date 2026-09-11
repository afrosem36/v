import { db } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import { getActivePlan, getAllWorkoutDays } from "@/lib/db/repo/workouts";
import { markPlanCustomized } from "@/lib/db/repo/settings";
import type { CoachPlanBundle } from "@/lib/coach/contract";
import type {
  CoachPlanRecord,
  DayOfWeek,
  Exercise,
  ExercisePriority,
  PlanSnapshot,
  WorkoutDay,
  WorkoutDayExercise,
} from "@/types/domain";

// ---------------- Stored coach plans ----------------

export async function saveCoachPlan(
  bundle: CoachPlanBundle,
  improvements: string[],
  warnings: string[]
): Promise<CoachPlanRecord> {
  const weeksCovered = bundle.blocks.reduce((max, b) => Math.max(max, b.weekEnd), 0);
  const record: CoachPlanRecord = {
    id: newId("cplan"),
    createdAt: new Date().toISOString(),
    name: bundle.name,
    summary: bundle.summary,
    goal: bundle.goal,
    weeksCovered,
    bundleJson: JSON.stringify(bundle),
    status: "imported",
    appliedAt: null,
    improvements,
    warnings,
  };
  await db.coachPlans.add(record);
  return record;
}

export async function getCoachPlans(): Promise<CoachPlanRecord[]> {
  return db.coachPlans.orderBy("createdAt").reverse().toArray();
}

export async function getCoachPlan(id: string): Promise<CoachPlanRecord | undefined> {
  return db.coachPlans.get(id);
}

export async function deleteCoachPlan(id: string): Promise<void> {
  await db.coachPlans.delete(id);
}

export function parseBundle(record: CoachPlanRecord): CoachPlanBundle | null {
  try {
    return JSON.parse(record.bundleJson) as CoachPlanBundle;
  } catch {
    return null;
  }
}

// ---------------- Snapshots ----------------

interface SnapshotPayload {
  workoutDays: WorkoutDay[];
  workoutDayExercises: WorkoutDayExercise[];
}

/** Full copy of the weekly program, taken right before it's overwritten. */
export async function snapshotCurrentPlan(label: string): Promise<PlanSnapshot> {
  const [workoutDays, workoutDayExercises] = await Promise.all([
    db.workoutDays.toArray(),
    db.workoutDayExercises.toArray(),
  ]);
  const snapshot: PlanSnapshot = {
    id: newId("snap"),
    createdAt: new Date().toISOString(),
    label,
    payloadJson: JSON.stringify({ workoutDays, workoutDayExercises } satisfies SnapshotPayload),
  };
  await db.planSnapshots.add(snapshot);

  // Keep the last handful only — these are an undo button, not an archive.
  const all = await db.planSnapshots.orderBy("createdAt").reverse().toArray();
  const stale = all.slice(8);
  if (stale.length > 0) await db.planSnapshots.bulkDelete(stale.map((s) => s.id));

  return snapshot;
}

export async function getPlanSnapshots(): Promise<PlanSnapshot[]> {
  return db.planSnapshots.orderBy("createdAt").reverse().toArray();
}

export async function restorePlanSnapshot(id: string): Promise<boolean> {
  const snapshot = await db.planSnapshots.get(id);
  if (!snapshot) return false;

  let payload: SnapshotPayload;
  try {
    payload = JSON.parse(snapshot.payloadJson) as SnapshotPayload;
  } catch {
    return false;
  }

  await db.transaction("rw", [db.workoutDays, db.workoutDayExercises], async () => {
    await db.workoutDays.clear();
    await db.workoutDayExercises.clear();
    await db.workoutDays.bulkAdd(payload.workoutDays);
    await db.workoutDayExercises.bulkAdd(payload.workoutDayExercises);
  });
  return true;
}

// ---------------- Applying a coach plan ----------------

function toPriority(value: number | undefined): ExercisePriority {
  const n = Math.min(5, Math.max(1, Math.round(value ?? 3)));
  return n as ExercisePriority;
}

/**
 * Writes one block of a coach plan over the weekly program. Sessions land on the weekdays the
 * plan asked for; any weekday it doesn't use becomes a rest day. The previous program is
 * snapshotted first, so this is always undoable.
 */
export async function applyCoachBlock(record: CoachPlanRecord, blockId: string): Promise<{ ok: boolean; error?: string }> {
  const bundle = parseBundle(record);
  if (!bundle) return { ok: false, error: "That saved plan couldn't be read." };

  const block = bundle.blocks.find((b) => b.id === blockId) ?? bundle.blocks[0];
  if (!block) return { ok: false, error: "That plan has no training blocks." };

  const plan = await getActivePlan();
  if (!plan) return { ok: false, error: "No active program to write into." };

  await snapshotCurrentPlan(`Before "${record.name}" — ${block.name}`);
  await createCustomExercises(bundle);

  const existingDays = await getAllWorkoutDays();
  const byDow = new Map<DayOfWeek, WorkoutDay>(existingDays.map((d) => [d.dayOfWeek, d]));

  const newDays: WorkoutDay[] = [];
  const newDayExercises: WorkoutDayExercise[] = [];

  for (let dow = 0 as DayOfWeek; dow <= 6; dow = (dow + 1) as DayOfWeek) {
    const routineId = block.week[String(dow)];
    const routine = routineId ? block.routines.find((r) => r.id === routineId) : undefined;
    const existing = byDow.get(dow);
    // A fresh random id when this weekday has no existing row — never a literal like "day_mon"
    // (see program.ts's warning: Dexie Cloud enforces one global primary key per table across
    // every account sharing this database).
    const dayId = existing?.id ?? newId("day");

    newDays.push({
      id: dayId,
      planId: plan.id,
      dayOfWeek: dow,
      label: routine?.name ?? "Rest / Recovery",
      isRestDay: !routine,
      order: dow === 0 ? 6 : dow - 1,
    });

    routine?.exercises.forEach((ex, index) => {
      newDayExercises.push({
        id: `${dayId}_c${index}`,
        workoutDayId: dayId,
        exerciseId: ex.id,
        order: index,
        priority: toPriority(ex.priority),
        targetSets: ex.sets,
        repRangeMin: ex.repsMin,
        repRangeMax: ex.repsMax,
        restSeconds: ex.restSeconds ?? 90,
      });
    });
  }

  await db.transaction("rw", [db.workoutDays, db.workoutDayExercises], async () => {
    await db.workoutDayExercises.clear();
    await db.workoutDays.clear();
    await db.workoutDays.bulkAdd(newDays);
    await db.workoutDayExercises.bulkAdd(newDayExercises);
  });

  const now = new Date().toISOString();
  await db.coachPlans.update(record.id, { status: "applied", appliedAt: now });
  await markPlanCustomized();
  // Having a real program is exactly what onboarding is waiting for.
  const settings = await db.appSettings.toCollection().first();
  if (settings && !settings.onboardingCompletedAt) {
    await db.appSettings.toCollection().modify({ onboardingCompletedAt: now });
  }
  return { ok: true };
}

/** Any exercise the coach invented becomes a real library row, flagged so library syncs leave it alone. */
async function createCustomExercises(bundle: CoachPlanBundle): Promise<void> {
  if (bundle.customExercises.length === 0) return;
  const now = new Date().toISOString();

  const rows: Exercise[] = bundle.customExercises.map((c) => ({
    // Always fresh and random — never derived from the coach plan's own id (e.g. "cx1"), which
    // is not unique across different accounts' coach-plan generations and would collide in the
    // synced customExercises table the same way a literal "day_mon" collides in workoutDays.
    id: newId("ex_custom"),
    name: c.name,
    isCustom: true,
    primaryMuscle: c.primaryMuscle,
    secondaryMuscles: [],
    equipment: c.equipment,
    movementType: "isolation",
    isCompound: false,
    level: "beginner",
    loadType: c.equipment.includes("dumbbell") ? "dumbbell_each" : c.equipment.includes("barbell") ? "barbell" : "bodyweight",
    repUnit: "reps",
    repRangeMin: 8,
    repRangeMax: 12,
    recommendedSets: 3,
    restSeconds: 90,
    instructions: c.instructions ?? "Added by your coach plan.",
    formCues: [],
    commonMistakes: [],
    alternativeExerciseIds: [],
    createdAt: now,
    updatedAt: now,
  }));

  await db.exercises.bulkPut(rows);
  // Mirrored into the small synced table so other devices pick it up — `exercises` itself
  // isn't synced (see db.ts UNSYNCED_TABLES).
  await db.customExercises.bulkPut(rows);

  // Routines reference the id the coach used; keep those pointing at the row we just created.
  const renamed = new Map(bundle.customExercises.map((c, i) => [c.id, rows[i].id]));
  for (const block of bundle.blocks) {
    for (const routine of block.routines) {
      for (const ex of routine.exercises) {
        const mapped = renamed.get(ex.id);
        if (mapped) ex.id = mapped;
      }
    }
  }
}
