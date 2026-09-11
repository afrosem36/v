import { db } from "@/lib/db/db";
import { getCompletedSessions, getSessionSets } from "@/lib/db/repo/workouts";
import { getExercisesByIds } from "@/lib/db/repo/exercises";
import { totalLoadForSet, displayWeightForSet } from "@/lib/engine/weight-math";
import { estimateCaloriesBurned } from "@/lib/engine/body-metrics";
import { estimate1RM } from "@/lib/engine/pr";
import { dateStr } from "@/lib/utils/date";
import { startOfWeek, addWeeks, isWithinInterval, endOfWeek, format } from "date-fns";
import type { MuscleGroupKey } from "@/types/domain";

export interface WeeklyVolume {
  weekStart: string;
  label: string;
  volume: number;
  workouts: number;
}

export async function getWeeklyVolumes(weeks: number): Promise<WeeklyVolume[]> {
  const sessions = await getCompletedSessions(500);
  const allSets = await db.exerciseSets.toArray();
  const setsBySession = new Map<string, typeof allSets>();
  for (const s of allSets) {
    const arr = setsBySession.get(s.sessionId) ?? [];
    arr.push(s);
    setsBySession.set(s.sessionId, arr);
  }

  const results: WeeklyVolume[] = [];
  const now = new Date();
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = startOfWeek(addWeeks(now, -i), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    let volume = 0;
    let workouts = 0;
    for (const session of sessions) {
      const started = new Date(session.startedAt);
      if (isWithinInterval(started, { start: weekStart, end: weekEnd })) {
        workouts++;
        const sets = setsBySession.get(session.id) ?? [];
        volume += sets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0);
      }
    }
    results.push({ weekStart: dateStr(weekStart), label: format(weekStart, "MMM d"), volume: Math.round(volume), workouts });
  }
  return results;
}

export interface ExerciseHistoryPoint {
  date: string;
  sessionId: string;
  bestWeightKg: number;
  bestSetReps: number;
}

export async function getExerciseHistory(exerciseId: string, limit = 12): Promise<ExerciseHistoryPoint[]> {
  const sets = await db.exerciseSets.where("exerciseId").equals(exerciseId).and((s) => !s.isWarmup).toArray();
  const bySession = new Map<string, typeof sets>();
  for (const s of sets) {
    const arr = bySession.get(s.sessionId) ?? [];
    arr.push(s);
    bySession.set(s.sessionId, arr);
  }

  const points: ExerciseHistoryPoint[] = [];
  for (const [sessionId, sessionSets] of bySession) {
    const best = sessionSets.reduce((b, s) => (displayWeightForSet(s) > displayWeightForSet(b) ? s : b));
    points.push({ date: best.completedAt, sessionId, bestWeightKg: displayWeightForSet(best), bestSetReps: best.reps });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

export async function getWorkoutCounts(): Promise<{ thisWeek: number; thisMonth: number }> {
  const sessions = await getCompletedSessions(500);
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let thisWeek = 0;
  let thisMonth = 0;
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d >= weekStart) thisWeek++;
    if (d >= monthStart) thisMonth++;
  }
  return { thisWeek, thisMonth };
}

export interface RecentSessionSummary {
  date: string;
  label: string;
  primaryMuscles: string[];
  totalVolume: number;
  durationMin: number;
}

/** Last N completed workouts (most recent first) — the training context sent to the AI for recovery-nutrition suggestions. */
export async function getRecentSessionsSummary(limit = 3): Promise<RecentSessionSummary[]> {
  const sessions = await getCompletedSessions(limit);
  const results: RecentSessionSummary[] = [];

  for (const session of sessions) {
    const sets = await getSessionSets(session.id);
    const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
    const exercises = await getExercisesByIds(exerciseIds);
    const primaryMuscles = [...new Set(exercises.map((e) => e.primaryMuscle))];
    const totalVolume = Math.round(sets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0));
    const durationMin =
      session.completedAt != null ? Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000) : 0;

    results.push({ date: session.startedAt.slice(0, 10), label: session.label, primaryMuscles, totalVolume, durationMin });
  }

  return results;
}

export interface HeatmapDay {
  date: string;
  /** Minutes trained that day. 0 means no session. */
  minutes: number;
  sets: number;
}

/** GitHub-style activity grid: one entry per day for the last `days` days, oldest first. */
export async function getTrainingHeatmap(days = 364): Promise<HeatmapDay[]> {
  const sessions = await getCompletedSessions(1000);
  const allSets = await db.exerciseSets.toArray();

  const setCountBySession = new Map<string, number>();
  for (const s of allSets) setCountBySession.set(s.sessionId, (setCountBySession.get(s.sessionId) ?? 0) + 1);

  const byDate = new Map<string, HeatmapDay>();
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10);
    const minutes = session.completedAt
      ? Math.max(0, Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000))
      : 0;
    const existing = byDate.get(date) ?? { date, minutes: 0, sets: 0 };
    existing.minutes += minutes;
    existing.sets += setCountBySession.get(session.id) ?? 0;
    byDate.set(date, existing);
  }

  const result: HeatmapDay[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = dateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
    result.push(byDate.get(date) ?? { date, minutes: 0, sets: 0 });
  }
  return result;
}

export interface MuscleVolume {
  muscle: MuscleGroupKey;
  sets: number;
  volumeKg: number;
  lastTrained: string | null;
}

/**
 * Working sets and tonnage per muscle over a window. Assistance work counts at half a set,
 * which is the convention most volume guidance is written against.
 */
export async function getMuscleBreakdown(windowDays: number): Promise<MuscleVolume[]> {
  const cutoff = dateStr(new Date(Date.now() - windowDays * 86_400_000));
  const [sessions, allSets, exercises] = await Promise.all([
    getCompletedSessions(500),
    db.exerciseSets.toArray(),
    db.exercises.toArray(),
  ]);

  const completedIds = new Set(sessions.filter((s) => s.startedAt.slice(0, 10) >= cutoff).map((s) => s.id));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const totals = new Map<MuscleGroupKey, MuscleVolume>();

  const bump = (muscle: MuscleGroupKey, sets: number, volume: number, date: string) => {
    const entry = totals.get(muscle) ?? { muscle, sets: 0, volumeKg: 0, lastTrained: null };
    entry.sets += sets;
    entry.volumeKg += volume;
    if (!entry.lastTrained || date > entry.lastTrained) entry.lastTrained = date;
    totals.set(muscle, entry);
  };

  for (const set of allSets) {
    if (set.isWarmup || !completedIds.has(set.sessionId)) continue;
    const exercise = exerciseById.get(set.exerciseId);
    if (!exercise) continue;
    const volume = totalLoadForSet(set) * set.reps;
    const date = set.completedAt.slice(0, 10);
    bump(exercise.primaryMuscle, 1, volume, date);
    for (const secondary of exercise.secondaryMuscles) bump(secondary, 0.5, volume * 0.5, date);
  }

  return [...totals.values()]
    .map((t) => ({ ...t, sets: Math.round(t.sets * 10) / 10, volumeKg: Math.round(t.volumeKg) }))
    .sort((a, b) => b.sets - a.sets);
}

export interface ExerciseStrength {
  exerciseId: string;
  name: string;
  bestWeightKg: number;
  bestReps: number;
  estimated1RM: number;
  lastPerformed: string;
}

/** Best estimated 1RM per exercise, from the single best eligible set (Epley is unreliable past 12 reps). */
export async function getStrengthProfile(): Promise<ExerciseStrength[]> {
  const [allSets, exercises, sessions] = await Promise.all([
    db.exerciseSets.toArray(),
    db.exercises.toArray(),
    getCompletedSessions(500),
  ]);
  const completedIds = new Set(sessions.map((s) => s.id));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const best = new Map<string, ExerciseStrength>();
  for (const set of allSets) {
    if (set.isWarmup || !completedIds.has(set.sessionId) || set.reps > 12) continue;
    const exercise = exerciseById.get(set.exerciseId);
    if (!exercise || exercise.loadType === "bodyweight" || exercise.loadType === "cardio") continue;

    const weight = displayWeightForSet(set);
    if (weight <= 0) continue;
    const oneRm = Math.round(estimate1RM(weight, set.reps) * 10) / 10;
    const current = best.get(set.exerciseId);
    if (current && current.estimated1RM >= oneRm) {
      if (set.completedAt > current.lastPerformed) current.lastPerformed = set.completedAt;
      continue;
    }
    best.set(set.exerciseId, {
      exerciseId: set.exerciseId,
      name: exercise.name,
      bestWeightKg: weight,
      bestReps: set.reps,
      estimated1RM: oneRm,
      lastPerformed: current && current.lastPerformed > set.completedAt ? current.lastPerformed : set.completedAt,
    });
  }

  return [...best.values()].sort((a, b) => b.estimated1RM - a.estimated1RM);
}

export interface WeeklyGymStats {
  sessionCount: number;
  totalMinutes: number;
  avgMinutesPerSession: number;
  estimatedCalories: number;
}

/** "Time at the gym" + a rough calorie estimate for the current calendar week (Mon-Sun). */
export async function getWeeklyGymStats(bodyWeightKg: number | null): Promise<WeeklyGymStats> {
  const sessions = await getCompletedSessions(500);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  let totalMinutes = 0;
  let sessionCount = 0;
  for (const s of sessions) {
    const started = new Date(s.startedAt);
    if (!isWithinInterval(started, { start: weekStart, end: weekEnd }) || !s.completedAt) continue;
    sessionCount++;
    totalMinutes += Math.max(0, Math.round((new Date(s.completedAt).getTime() - started.getTime()) / 60000));
  }

  return {
    sessionCount,
    totalMinutes,
    avgMinutesPerSession: sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0,
    estimatedCalories: bodyWeightKg != null ? estimateCaloriesBurned(totalMinutes, bodyWeightKg) : 0,
  };
}
