import { getScheduledDay, getActiveSession, getSessionSets, computeWorkoutStreak, getLastCompletedSession } from "@/lib/db/repo/workouts";
import { getStepsForDate, getLatestBodyWeight, getBodyWeightsInRange } from "@/lib/db/repo/body";
import { getMostRecentPR, getAllPRsByType } from "@/lib/db/repo/records";
import { getExercise, getAllExercises } from "@/lib/db/repo/exercises";
import { getSettings } from "@/lib/db/repo/settings";
import { todayStr, dateStr, daysAgo } from "@/lib/utils/date";
import { goalByKey } from "@/lib/coach/goals";
import { subDays, differenceInYears } from "date-fns";

export type TimeOfDay = "early_morning" | "morning" | "afternoon" | "evening" | "night";

export function timeOfDayFromHour(hour: number): TimeOfDay {
  if (hour < 6) return "early_morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export interface PartnerContext {
  timeOfDay: TimeOfDay;
  localTimeLabel: string;
  goal: string;
  todayLabel: string;
  isRestDayToday: boolean;
  activeWorkout: { label: string; setsLoggedSoFar: number; minutesElapsed: number } | null;
  lastCompletedWorkout: { label: string; daysAgo: number } | null;
  streak: number;
  stepsToday: number | null;
  stepGoal: number;
  latestWeightKg: number | null;
  weightTrendKg: number | null;
  goalWeightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  gender: string | null;
  mostRecentPR: string | null;
  /** Every exercise's all-time heaviest-weight PR, heaviest first — lets it answer "what's my best X" directly. */
  bestLifts: { exerciseName: string; weightKg: number }[];
}

/**
 * A compact, cheap-to-gather snapshot of the person's real data, built fresh for every partner
 * chat turn. Deliberately lighter than collectTrainingHistory() (used for full coach-plan
 * generation) — a chat reply doesn't need every exercise's full history, just enough current
 * context to sound like it actually knows what's going on right now.
 */
export async function buildPartnerContext(now: Date): Promise<PartnerContext> {
  const today = todayStr();
  const settings = await getSettings();
  const goal = goalByKey(settings.goal ?? "vshape");

  const [scheduled, activeSession, streak, lastCompleted, steps, latestWeight, recentPR, heaviestPRs, exercises] = await Promise.all([
    getScheduledDay(today),
    getActiveSession(),
    computeWorkoutStreak(),
    getLastCompletedSession(),
    getStepsForDate(today),
    getLatestBodyWeight(),
    getMostRecentPR(),
    getAllPRsByType("heaviest_weight"),
    getAllExercises(),
  ]);

  const exerciseNameById = new Map(exercises.map((e) => [e.id, e.name]));
  const bestLifts = heaviestPRs
    .filter((pr) => !pr.isBaseline && pr.weightKg != null)
    .map((pr) => ({ exerciseName: exerciseNameById.get(pr.exerciseId) ?? "Unknown exercise", weightKg: pr.weightKg as number }))
    .sort((a, b) => b.weightKg - a.weightKg);

  const ageYears = settings.dateOfBirth ? differenceInYears(now, new Date(settings.dateOfBirth)) : null;

  let activeWorkout: PartnerContext["activeWorkout"] = null;
  if (activeSession) {
    const sets = await getSessionSets(activeSession.id);
    activeWorkout = {
      label: activeSession.label,
      setsLoggedSoFar: sets.filter((s) => !s.isWarmup).length,
      minutesElapsed: Math.max(0, Math.round((now.getTime() - new Date(activeSession.startedAt).getTime()) / 60000)),
    };
  }

  let lastCompletedWorkout: PartnerContext["lastCompletedWorkout"] = null;
  if (lastCompleted) {
    lastCompletedWorkout = { label: lastCompleted.label, daysAgo: daysAgo(lastCompleted.startedAt) };
  }

  const weights = await getBodyWeightsInRange(dateStr(subDays(now, 14)), today);
  const weightTrendKg =
    latestWeight && weights.length >= 2
      ? Math.round((latestWeight.weightKg - weights[0].weightKg) * 10) / 10
      : null;

  let mostRecentPRLabel: string | null = null;
  if (recentPR && !recentPR.isBaseline) {
    const exercise = await getExercise(recentPR.exerciseId);
    if (exercise) {
      mostRecentPRLabel =
        recentPR.type === "heaviest_weight"
          ? `${exercise.name} — heaviest weight ${recentPR.value}kg`
          : recentPR.type === "est_1rm"
            ? `${exercise.name} — estimated 1RM ${recentPR.value}kg`
            : recentPR.type === "best_reps_at_weight"
              ? `${exercise.name} — ${recentPR.value} reps${recentPR.weightKg ? ` @ ${recentPR.weightKg}kg` : ""}`
              : `${exercise.name} — volume PR`;
    }
  }

  return {
    timeOfDay: timeOfDayFromHour(now.getHours()),
    localTimeLabel: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    goal: goal.label,
    todayLabel: scheduled.day?.label ?? (scheduled.overridden ? "Rest (rescheduled)" : "Rest day"),
    isRestDayToday: scheduled.day?.isRestDay ?? true,
    activeWorkout,
    lastCompletedWorkout,
    streak,
    stepsToday: steps?.steps ?? null,
    stepGoal: settings.stepGoal,
    latestWeightKg: latestWeight?.weightKg ?? null,
    weightTrendKg,
    goalWeightKg: settings.goalWeightKg,
    heightCm: settings.heightCm,
    ageYears,
    gender: settings.gender !== "unspecified" ? settings.gender : null,
    mostRecentPR: mostRecentPRLabel,
    bestLifts,
  };
}

/** Renders the context as plain lines for the system prompt — compact, not a full JSON dump. */
export function describePartnerContext(ctx: PartnerContext): string {
  const bio = [
    ctx.ageYears != null ? `${ctx.ageYears}yo` : null,
    ctx.gender,
    ctx.heightCm != null ? `${ctx.heightCm}cm` : null,
  ].filter(Boolean);

  const lines = [
    `Local time: ${ctx.localTimeLabel} (${ctx.timeOfDay.replace("_", " ")})`,
    bio.length > 0 ? `Bio: ${bio.join(", ")}` : null,
    `Training goal: ${ctx.goal}`,
    `Today's plan: ${ctx.todayLabel}${ctx.isRestDayToday ? " (rest day)" : ""}`,
    ctx.activeWorkout
      ? `Currently mid-workout: "${ctx.activeWorkout.label}", ${ctx.activeWorkout.setsLoggedSoFar} sets logged so far, ${ctx.activeWorkout.minutesElapsed} min in`
      : ctx.lastCompletedWorkout
        ? `Last workout: "${ctx.lastCompletedWorkout.label}", ${ctx.lastCompletedWorkout.daysAgo} day(s) ago`
        : "No workouts logged yet",
    `Current streak: ${ctx.streak} day(s)`,
    ctx.stepsToday != null ? `Steps today: ${ctx.stepsToday} (goal ${ctx.stepGoal})` : `No step count logged today (goal ${ctx.stepGoal})`,
    ctx.latestWeightKg != null
      ? `Latest weight: ${ctx.latestWeightKg}kg${ctx.weightTrendKg != null ? ` (${ctx.weightTrendKg >= 0 ? "+" : ""}${ctx.weightTrendKg}kg over ~2 weeks)` : ""}${ctx.goalWeightKg ? `, goal ${ctx.goalWeightKg}kg` : ""}`
      : "No body weight logged yet",
    ctx.mostRecentPR ? `Most recent personal record: ${ctx.mostRecentPR}` : "No personal records yet",
    ctx.bestLifts.length > 0
      ? `All-time best lifts (heaviest weight ever, any rep count):\n${ctx.bestLifts.map((l) => `- ${l.exerciseName}: ${l.weightKg}kg`).join("\n")}`
      : "No lift records yet",
  ];
  return lines.filter((l): l is string => l != null).join("\n");
}
