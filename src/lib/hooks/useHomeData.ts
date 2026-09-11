import { useLiveQuery } from "dexie-react-hooks";
import {
  getScheduledDay,
  getWorkoutDayExercises,
  getActiveSession,
  computeWorkoutStreak,
  getLastCompletedSession,
  getSessionSets,
} from "@/lib/db/repo/workouts";
import { getSettings } from "@/lib/db/repo/settings";
import { getStepsForDate, getLatestBodyWeight } from "@/lib/db/repo/body";
import { getMostRecentPR } from "@/lib/db/repo/records";
import { getExercise } from "@/lib/db/repo/exercises";
import { getWeeklyGymStats, getWorkoutCounts } from "@/lib/db/repo/analytics";
import { estimateWorkoutMinutes } from "@/lib/engine/time-estimate";
import { getReturnPrompt } from "@/lib/engine/calibration";
import { todayStr } from "@/lib/utils/date";

export function useHomeData() {
  return useLiveQuery(async () => {
    const today = todayStr();
    const [scheduled, activeSession, settings, steps, latestWeight, streak, lastCompleted, recentPR, counts] = await Promise.all([
      getScheduledDay(today),
      getActiveSession(),
      getSettings(),
      getStepsForDate(today),
      getLatestBodyWeight(),
      computeWorkoutStreak(),
      getLastCompletedSession(),
      getMostRecentPR(),
      getWorkoutCounts(),
    ]);

    const dayExercises = scheduled.day ? await getWorkoutDayExercises(scheduled.day.id) : [];
    const estimatedMinutes = estimateWorkoutMinutes(dayExercises);
    const recentPRExercise = recentPR ? await getExercise(recentPR.exerciseId) : undefined;
    const returnPrompt = getReturnPrompt(lastCompleted?.startedAt.slice(0, 10) ?? null, today);
    const weekStats = await getWeeklyGymStats(latestWeight?.weightKg ?? null);
    const activeSetCount = activeSession ? (await getSessionSets(activeSession.id)).length : 0;

    return {
      today: scheduled.day,
      rescheduled: scheduled.overridden,
      dayExercises,
      estimatedMinutes,
      activeSession,
      activeSetCount,
      settings,
      steps,
      latestWeight,
      streak,
      counts,
      weekStats,
      recentPR: recentPR && recentPRExercise ? { record: recentPR, exerciseName: recentPRExercise.name } : null,
      returnPrompt,
    };
  }, []);
}
