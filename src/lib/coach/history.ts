import { getCompletedSessions, getSessionSets, getAllWorkoutDays, getWorkoutDayExercises } from "@/lib/db/repo/workouts";
import { getExercisesByIds } from "@/lib/db/repo/exercises";
import { getBodyWeightsInRange, getStepsInRange } from "@/lib/db/repo/body";
import { getStrengthProfile } from "@/lib/db/repo/analytics";
import { displayWeightForSet } from "@/lib/engine/weight-math";
import { dateStr, todayStr, DOW_SHORT } from "@/lib/utils/date";
import { subDays } from "date-fns";

export interface ExerciseHistorySummary {
  name: string;
  sessionsLogged: number;
  /** Working sets from the most recent session, oldest set first: "40kg×10, 40kg×9". */
  lastSession: string;
  bestSet: string;
  estimated1RM: number | null;
  /** Sessions in a row that failed to beat the previous session's top weight. */
  stalledSessions: number;
  lastPerformedDaysAgo: number;
}

export interface CurrentProgramSummary {
  day: string;
  label: string;
  exercises: string[];
}

export interface TrainingHistorySummary {
  weeksTracked: number;
  totalWorkouts: number;
  workoutsPerWeekRecent: number;
  avgSessionMinutes: number;
  currentProgram: CurrentProgramSummary[];
  exercises: ExerciseHistorySummary[];
  bodyWeightTrend: { startKg: number; endKg: number; days: number } | null;
  avgDailySteps: number | null;
  /** Muscles with no logged working set in the last 28 days. */
  untrainedRecently: string[];
}

/**
 * Everything worth telling a coach about how training has actually gone. Read once, formatted
 * into the "update my plan" prompt — the point is that the next program is written against real
 * numbers rather than a fresh intake questionnaire.
 */
export async function collectTrainingHistory(): Promise<TrainingHistorySummary> {
  const today = todayStr();
  const sessions = await getCompletedSessions(400);
  const strength = await getStrengthProfile();
  const strengthById = new Map(strength.map((s) => [s.exerciseId, s]));

  // ---- current program ----
  const days = await getAllWorkoutDays();
  const currentProgram: CurrentProgramSummary[] = [];
  for (const day of days) {
    if (day.isRestDay) continue;
    const dayExercises = await getWorkoutDayExercises(day.id);
    const exercises = await getExercisesByIds(dayExercises.map((d) => d.exerciseId));
    const byId = new Map(exercises.map((e) => [e.id, e]));
    currentProgram.push({
      day: DOW_SHORT[day.dayOfWeek],
      label: day.label,
      exercises: dayExercises
        .map((de) => {
          const exercise = byId.get(de.exerciseId);
          return exercise ? `${exercise.name} ${de.targetSets}×${de.repRangeMin}-${de.repRangeMax}` : null;
        })
        .filter((v): v is string => v !== null),
    });
  }

  // ---- per-exercise performance ----
  const setsBySession = new Map<string, Awaited<ReturnType<typeof getSessionSets>>>();
  for (const session of sessions.slice(0, 60)) {
    setsBySession.set(session.id, await getSessionSets(session.id));
  }

  const byExercise = new Map<string, { sessionId: string; date: string; sets: { weight: number; reps: number; rir: number | null }[] }[]>();
  for (const session of sessions.slice(0, 60)) {
    const sets = (setsBySession.get(session.id) ?? []).filter((s) => !s.isWarmup);
    const grouped = new Map<string, typeof sets>();
    for (const set of sets) {
      const bucket = grouped.get(set.exerciseId) ?? [];
      bucket.push(set);
      grouped.set(set.exerciseId, bucket);
    }
    for (const [exerciseId, exerciseSets] of grouped) {
      const entries = byExercise.get(exerciseId) ?? [];
      entries.push({
        sessionId: session.id,
        date: session.startedAt.slice(0, 10),
        sets: exerciseSets
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => ({ weight: displayWeightForSet(s), reps: s.reps, rir: s.rir })),
      });
      byExercise.set(exerciseId, entries);
    }
  }

  const exerciseRows = await getExercisesByIds([...byExercise.keys()]);
  const exerciseNameById = new Map(exerciseRows.map((e) => [e.id, e.name]));

  const exercises: ExerciseHistorySummary[] = [];
  for (const [exerciseId, entries] of byExercise) {
    const name = exerciseNameById.get(exerciseId);
    if (!name) continue;

    // `sessions` is newest-first, so entries are too.
    const latest = entries[0];
    const topWeightBySession = entries.map((e) => Math.max(...e.sets.map((s) => s.weight), 0));

    let stalled = 0;
    for (let i = 0; i < topWeightBySession.length - 1; i++) {
      if (topWeightBySession[i] <= topWeightBySession[i + 1]) stalled++;
      else break;
    }

    const best = strengthById.get(exerciseId);
    const bestSetOverall = entries.flatMap((e) => e.sets).reduce((b, s) => (s.weight > b.weight ? s : b), { weight: 0, reps: 0, rir: null as number | null });

    exercises.push({
      name,
      sessionsLogged: entries.length,
      lastSession: latest.sets.map((s) => `${s.weight}kg×${s.reps}${s.rir != null ? ` @RIR${s.rir}` : ""}`).join(", "),
      bestSet: bestSetOverall.weight > 0 ? `${bestSetOverall.weight}kg×${bestSetOverall.reps}` : "bodyweight",
      estimated1RM: best?.estimated1RM ?? null,
      stalledSessions: stalled,
      lastPerformedDaysAgo: Math.round((new Date(today).getTime() - new Date(latest.date).getTime()) / 86_400_000),
    });
  }
  exercises.sort((a, b) => b.sessionsLogged - a.sessionsLogged);

  // ---- adherence and body trend ----
  const fourWeeksAgo = dateStr(subDays(new Date(), 28));
  const recent = sessions.filter((s) => s.startedAt.slice(0, 10) >= fourWeeksAgo);
  const durations = sessions
    .filter((s) => s.completedAt)
    .map((s) => Math.round((new Date(s.completedAt!).getTime() - new Date(s.startedAt).getTime()) / 60000))
    .filter((m) => m > 0 && m < 300);

  const weights = await getBodyWeightsInRange(dateStr(subDays(new Date(), 90)), today);
  const steps = await getStepsInRange(dateStr(subDays(new Date(), 28)), today);

  const oldestSession = sessions[sessions.length - 1];
  const weeksTracked = oldestSession
    ? Math.max(1, Math.round((new Date(today).getTime() - new Date(oldestSession.startedAt).getTime()) / (7 * 86_400_000)))
    : 0;

  const trainedMuscles = new Set<string>();
  for (const session of recent) {
    const sets = setsBySession.get(session.id) ?? [];
    const ids = [...new Set(sets.map((s) => s.exerciseId))];
    for (const exercise of await getExercisesByIds(ids)) trainedMuscles.add(exercise.primaryMuscle);
  }
  const allMuscles = ["lats", "lateral_delts", "rear_delts", "chest", "upper_chest", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"];

  return {
    weeksTracked,
    totalWorkouts: sessions.length,
    workoutsPerWeekRecent: Math.round((recent.length / 4) * 10) / 10,
    avgSessionMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    currentProgram,
    exercises,
    bodyWeightTrend:
      weights.length >= 2
        ? {
            startKg: weights[0].weightKg,
            endKg: weights[weights.length - 1].weightKg,
            days: Math.round((new Date(weights[weights.length - 1].date).getTime() - new Date(weights[0].date).getTime()) / 86_400_000),
          }
        : null,
    avgDailySteps: steps.length > 0 ? Math.round(steps.reduce((sum, s) => sum + s.steps, 0) / steps.length) : null,
    untrainedRecently: allMuscles.filter((m) => !trainedMuscles.has(m)),
  };
}
