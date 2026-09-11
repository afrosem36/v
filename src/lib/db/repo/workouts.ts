import { db } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import { dateStr, dayOfWeekOf, todayStr } from "@/lib/utils/date";
import { evaluateAndSavePRs, rebuildPRsForExercise } from "@/lib/db/repo/records";
import { getSettings, markPlanCustomized, updateSettings } from "@/lib/db/repo/settings";
import { parseISO } from "date-fns";
import type { DayOfWeek, ExerciseSet, ScheduleOverride, WorkoutDay, WorkoutDayExercise, WorkoutSession } from "@/types/domain";

// ---------------- Plan / day lookups ----------------

export async function getActivePlan() {
  return db.workoutPlans.filter((p) => p.isActive).first();
}

export async function getWorkoutDayByDow(dow: DayOfWeek): Promise<WorkoutDay | undefined> {
  const plan = await getActivePlan();
  if (!plan) return undefined;
  return db.workoutDays.where({ planId: plan.id, dayOfWeek: dow }).first();
}

/**
 * What's scheduled for a date: a one-off override if one was set for that date, otherwise the
 * weekly plan's routine for that weekday. `overridden` lets the UI say so, and a null day with
 * `overridden` true means the user deliberately made that date a rest day.
 */
export async function getScheduledDay(date: string): Promise<{ day: WorkoutDay | undefined; overridden: boolean }> {
  const override = await getScheduleOverride(date);
  if (override) {
    const day = override.workoutDayId ? await db.workoutDays.get(override.workoutDayId) : undefined;
    return { day, overridden: true };
  }
  return { day: await getWorkoutDayByDow(dayOfWeekOf(parseISO(date))), overridden: false };
}

export async function getTodayWorkoutDay(): Promise<WorkoutDay | undefined> {
  return (await getScheduledDay(todayStr())).day;
}

// ---------------- Schedule overrides ----------------

export async function getScheduleOverride(date: string): Promise<ScheduleOverride | undefined> {
  return db.scheduleOverrides.where("date").equals(date).first();
}

/** Pins one calendar date to a routine (or to rest, with null) without touching the weekly plan. */
export async function setScheduleOverride(date: string, workoutDayId: string | null): Promise<void> {
  const existing = await getScheduleOverride(date);
  if (existing) {
    await db.scheduleOverrides.update(existing.id, { workoutDayId });
    return;
  }
  await db.scheduleOverrides.add({ id: newId("sov"), date, workoutDayId, createdAt: new Date().toISOString() });
}

export async function clearScheduleOverride(date: string): Promise<void> {
  const existing = await getScheduleOverride(date);
  if (existing) await db.scheduleOverrides.delete(existing.id);
}

export async function getScheduleOverridesInRange(startDate: string, endDate: string): Promise<ScheduleOverride[]> {
  return db.scheduleOverrides.where("date").between(startDate, endDate, true, true).toArray();
}

export async function getAllWorkoutDays(): Promise<WorkoutDay[]> {
  const plan = await getActivePlan();
  if (!plan) return [];
  return db.workoutDays.where("planId").equals(plan.id).sortBy("order");
}

export async function getWorkoutDayExercises(workoutDayId: string): Promise<WorkoutDayExercise[]> {
  return db.workoutDayExercises.where("workoutDayId").equals(workoutDayId).sortBy("order");
}

export async function getWorkoutDay(id: string): Promise<WorkoutDay | undefined> {
  return db.workoutDays.get(id);
}

export async function updateWorkoutDayExercise(id: string, patch: Partial<Omit<WorkoutDayExercise, "id" | "workoutDayId">>): Promise<void> {
  await db.workoutDayExercises.update(id, patch);
  await markPlanCustomized();
}

export async function renameWorkoutDay(dayId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  await db.workoutDays.update(dayId, { label: trimmed });
  await markPlanCustomized();
}

export async function reorderWorkoutDayExercise(id: string, direction: -1 | 1): Promise<void> {
  const row = await db.workoutDayExercises.get(id);
  if (!row) return;
  const siblings = await getWorkoutDayExercises(row.workoutDayId);
  const index = siblings.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= siblings.length) return;

  const swap = siblings[target];
  await db.workoutDayExercises.update(row.id, { order: swap.order });
  await db.workoutDayExercises.update(swap.id, { order: row.order });
  await markPlanCustomized();
}

export async function addWorkoutDayExercise(workoutDayId: string, exerciseId: string): Promise<void> {
  const [existing, exercise] = await Promise.all([getWorkoutDayExercises(workoutDayId), db.exercises.get(exerciseId)]);
  if (!exercise) return;
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
  const row: WorkoutDayExercise = {
    id: newId("wde"),
    workoutDayId,
    exerciseId,
    order: nextOrder,
    priority: 5, // new additions default to "optional / first cut" until the user re-prioritizes
    targetSets: exercise.recommendedSets,
    repRangeMin: exercise.repRangeMin,
    repRangeMax: exercise.repRangeMax,
    restSeconds: exercise.restSeconds,
  };
  await db.workoutDayExercises.add(row);
  await markPlanCustomized();
}

export async function removeWorkoutDayExercise(id: string): Promise<void> {
  await db.workoutDayExercises.delete(id);
  await markPlanCustomized();
}

export async function setDayRestStatus(dayId: string, isRestDay: boolean): Promise<void> {
  await db.workoutDays.update(dayId, { isRestDay });
  await markPlanCustomized();
}

// ---------------- Sessions ----------------

export async function getActiveSessions(): Promise<WorkoutSession[]> {
  return db.workoutSessions.where("status").equals("active").reverse().sortBy("startedAt");
}

/**
 * The one session the user is actually in. Sorted newest-first on purpose: `.first()` on the
 * status index returns whichever row IndexedDB happens to hit first, which is what used to
 * bounce people into a stale session from a previous day.
 */
export async function getActiveSession(): Promise<WorkoutSession | undefined> {
  return (await getActiveSessions())[0];
}

export function sessionDate(session: WorkoutSession): string {
  return session.scheduledDate ?? session.startedAt.slice(0, 10);
}

/**
 * Closes out sessions left open on an earlier day. Anything with logged sets is completed so
 * the work still counts (and still sets PRs); an empty one is abandoned. Without this, a
 * workout opened on Tuesday and never finished stays "active" forever and hijacks every later
 * Start Workout tap.
 */
export async function finalizeStaleSessions(): Promise<number> {
  const today = todayStr();
  const stale = (await getActiveSessions()).filter((s) => sessionDate(s) < today);

  for (const session of stale) {
    const sets = await getSessionSets(session.id);
    if (sets.length > 0) {
      await completeSession(session.id);
    } else {
      await abandonSession(session.id);
    }
  }
  return stale.length;
}

export async function startSession(
  workoutDayId: string | null,
  label: string,
  timeBudgetMinutes: number | null,
  scheduledDate: string = todayStr()
): Promise<WorkoutSession> {
  // One active session at a time. Callers decide what happens to an existing one (resume it or
  // discard it) before getting here; this is the backstop that keeps two from coexisting.
  for (const open of await getActiveSessions()) {
    const sets = await getSessionSets(open.id);
    if (sets.length > 0) await completeSession(open.id);
    else await abandonSession(open.id);
  }

  const session: WorkoutSession = {
    id: newId("sess"),
    workoutDayId,
    label,
    status: "active",
    startedAt: new Date().toISOString(),
    completedAt: null,
    timeBudgetMinutes,
    notes: null,
    scheduledDate,
  };
  await db.workoutSessions.add(session);
  return session;
}

/**
 * Starts whatever routine the user picked, for today, whichever weekday it belongs to. When
 * `pinToToday` is set, today's schedule is repointed at that routine too, so Home and the week
 * view agree with what they're actually training.
 */
export async function startWorkoutForDay(
  day: WorkoutDay,
  options: { timeBudgetMinutes?: number | null; pinToToday?: boolean } = {}
): Promise<WorkoutSession> {
  const { timeBudgetMinutes = null, pinToToday = true } = options;
  if (pinToToday) await setScheduleOverride(todayStr(), day.id);
  return startSession(day.id, day.label, timeBudgetMinutes);
}

export async function getSession(id: string): Promise<WorkoutSession | undefined> {
  return db.workoutSessions.get(id);
}

export async function updateSessionNotes(id: string, notes: string): Promise<void> {
  await db.workoutSessions.update(id, { notes: notes.trim().length > 0 ? notes.trim() : null });
}

export async function abandonSession(id: string): Promise<void> {
  await db.workoutSessions.update(id, { status: "abandoned", completedAt: new Date().toISOString() });
}

export interface CompletionSummary {
  session: WorkoutSession;
  newPRsByExercise: Record<string, ReturnType<typeof evaluateAndSavePRs> extends Promise<infer R> ? R : never>;
}

export async function completeSession(id: string) {
  const sets = await getSessionSets(id);
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];

  const newPRsByExercise: Record<string, Awaited<ReturnType<typeof evaluateAndSavePRs>>> = {};
  for (const exId of exerciseIds) {
    const exSets = sets.filter((s) => s.exerciseId === exId);
    newPRsByExercise[exId] = await evaluateAndSavePRs(exId, id, exSets);
  }

  const completedAt = new Date().toISOString();
  await db.workoutSessions.update(id, { status: "completed", completedAt });

  const settings = await getSettings();
  await updateSettings({
    firstWorkoutCompletedAt: settings.firstWorkoutCompletedAt ?? completedAt,
    lastActiveWorkoutDate: todayStr(),
  });

  const session = await getSession(id);
  return { session: session!, newPRsByExercise };
}

// ---------------- Sets ----------------

export async function getSessionSets(sessionId: string): Promise<ExerciseSet[]> {
  return db.exerciseSets.where("sessionId").equals(sessionId).sortBy("completedAt");
}

export async function getSessionSetsForExercise(sessionId: string, exerciseId: string): Promise<ExerciseSet[]> {
  const all = await db.exerciseSets.where({ sessionId, exerciseId }).sortBy("setNumber");
  return all;
}

export async function addSet(input: Omit<ExerciseSet, "id" | "completedAt">): Promise<ExerciseSet> {
  const set: ExerciseSet = { ...input, id: newId("set"), completedAt: new Date().toISOString() };
  await db.exerciseSets.add(set);
  return set;
}

export type EditableSetFields = Pick<
  ExerciseSet,
  "weightKg" | "reps" | "rir" | "painFlag" | "barWeightKg" | "platePerSideKg" | "weightEntryMode"
>;

/**
 * Corrects an already-logged set — "I actually did 25kg, not 20". Records derived from that
 * exercise are rebuilt from scratch afterwards, so lowering a set that had set a PR takes the
 * PR back down with it instead of leaving a record nobody ever hit.
 */
export async function updateSet(id: string, patch: Partial<EditableSetFields>): Promise<void> {
  const existing = await db.exerciseSets.get(id);
  if (!existing) return;
  await db.exerciseSets.update(id, patch);
  await rebuildPRsForExercise(existing.exerciseId);
}

export async function deleteSet(id: string): Promise<void> {
  const existing = await db.exerciseSets.get(id);
  if (!existing) return;
  await db.exerciseSets.delete(id);
  await renumberSets(existing.sessionId, existing.exerciseId);
  await rebuildPRsForExercise(existing.exerciseId);
}

/** Keeps "Set 1, 2, 3" contiguous after a deletion rather than showing a gap at 2. */
async function renumberSets(sessionId: string, exerciseId: string): Promise<void> {
  const remaining = await getSessionSetsForExercise(sessionId, exerciseId);
  await Promise.all(
    remaining.map((set, index) => (set.setNumber === index + 1 ? Promise.resolve(0) : db.exerciseSets.update(set.id, { setNumber: index + 1 })))
  );
}

/** Most recent OTHER session's working sets for this exercise — powers "LAST TIME" + progression. */
export async function getLastWorkingSets(exerciseId: string, excludeSessionId?: string): Promise<ExerciseSet[]> {
  const all = await db.exerciseSets.where("exerciseId").equals(exerciseId).reverse().sortBy("completedAt");
  const filtered = all.filter((s) => s.sessionId !== excludeSessionId);
  if (filtered.length === 0) return [];
  const lastSessionId = filtered[0].sessionId;
  return filtered.filter((s) => s.sessionId === lastSessionId && !s.isWarmup).sort((a, b) => a.setNumber - b.setNumber);
}

// ---------------- History ----------------

export async function getCompletedSessions(limit = 50): Promise<WorkoutSession[]> {
  return db.workoutSessions.where("status").equals("completed").reverse().sortBy("startedAt").then((r) => r.slice(0, limit));
}

export async function getLastCompletedSession(): Promise<WorkoutSession | undefined> {
  const rows = await getCompletedSessions(1);
  return rows[0];
}

export async function getPreviousCompletedSessionForDay(workoutDayId: string, excludeSessionId: string): Promise<WorkoutSession | undefined> {
  const all = await getCompletedSessions(200);
  return all.find((s) => s.workoutDayId === workoutDayId && s.id !== excludeSessionId);
}

// ---------------- Streak ----------------

export async function computeWorkoutStreak(): Promise<number> {
  const days = await getAllWorkoutDays();
  const completed = await getCompletedSessions(200);
  const completedDates = new Set(completed.map((s) => dateStr(new Date(s.startedAt))));

  let streak = 0;
  const cursor = new Date();
  // Don't penalize for today not being done yet; start checking from today backward.
  for (let i = 0; i < 90; i++) {
    const ds = dateStr(cursor);
    const dow = dayOfWeekOf(cursor);
    const day = days.find((d) => d.dayOfWeek === dow);
    const isRest = day?.isRestDay ?? false;

    if (isRest) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (completedDates.has(ds)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (ds === todayStr()) {
      // today's workout not done yet — doesn't break an existing streak
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return streak;
}
