"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Ruler, Camera, HeartPulse, Trophy } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { WeeklyVolumeChart } from "@/components/charts/WeeklyVolumeChart";
import { ExerciseTrendChart } from "@/components/charts/ExerciseTrendChart";
import { ActivityHeatmap } from "@/components/charts/ActivityHeatmap";
import { MuscleMap, muscleLabel } from "@/components/charts/MuscleMap";
import { getWeeklyVolumes, getExerciseHistory, getWorkoutCounts, getTrainingHeatmap, getMuscleBreakdown } from "@/lib/db/repo/analytics";
import { getAllPRsByType } from "@/lib/db/repo/records";
import { getExercisesByIds } from "@/lib/db/repo/exercises";
import { getSettings } from "@/lib/db/repo/settings";
import { formatPR } from "@/lib/utils/format";
import type { MuscleGroupKey } from "@/types/domain";

/** The muscles worth calling out by name when they go untrained. */
const MUSCLE_FOCUS: MuscleGroupKey[] = [
  "lats", "lateral_delts", "rear_delts", "chest", "upper_chest", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core",
];

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 365, label: "Year" },
] as const;

function useProgressOverview(windowDays: number) {
  return useLiveQuery(async () => {
    const [weeklyVolumes, counts, heaviestPRs, settings, heatmap, breakdown] = await Promise.all([
      getWeeklyVolumes(8),
      getWorkoutCounts(),
      getAllPRsByType("heaviest_weight"),
      getSettings(),
      getTrainingHeatmap(364),
      getMuscleBreakdown(windowDays),
    ]);
    const exercises = await getExercisesByIds(heaviestPRs.map((p) => p.exerciseId));
    const prRows = heaviestPRs
      .map((pr) => ({ pr, exercise: exercises.find((e) => e.id === pr.exerciseId) }))
      .filter((r): r is { pr: typeof heaviestPRs[number]; exercise: NonNullable<typeof r.exercise> } => r.exercise != null)
      .sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));

    return { weeklyVolumes, counts, prRows, unit: settings.units, heatmap, breakdown };
  }, [windowDays]);
}

function useExerciseTrend(exerciseId: string | null) {
  return useLiveQuery(async () => {
    if (!exerciseId) return [];
    return getExerciseHistory(exerciseId, 12);
  }, [exerciseId]);
}

export default function ProgressPage() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const data = useProgressOverview(windowDays);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const trend = useExerciseTrend(selectedExerciseId ?? data?.prRows[0]?.exercise.id ?? null);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const activeExerciseId = selectedExerciseId ?? data.prRows[0]?.exercise.id ?? null;
  const untrained = MUSCLE_FOCUS.filter((m) => !data.breakdown.some((b) => b.muscle === m && b.sets > 0));

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <div className="text-2xl font-bold tracking-tight">Progress</div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <CardLabel>This Week</CardLabel>
          <div className="mt-1 text-lg font-bold">
            {data.counts.thisWeek} {data.counts.thisWeek === 1 ? "workout" : "workouts"}
          </div>
        </Card>
        <Card className="text-center">
          <CardLabel>This Month</CardLabel>
          <div className="mt-1 text-lg font-bold">
            {data.counts.thisMonth} {data.counts.thisMonth === 1 ? "workout" : "workouts"}
          </div>
        </Card>
      </div>

      <Card>
        <CardLabel>Training activity</CardLabel>
        <div className="mt-3">
          <ActivityHeatmap days={data.heatmap} />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardLabel>Muscle balance</CardLabel>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setWindowDays(w.days)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  windowDays === w.days ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <MuscleMap breakdown={data.breakdown} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {data.breakdown.slice(0, 8).map((b) => {
            const max = Math.max(1, ...data.breakdown.map((x) => x.sets));
            return (
              <div key={b.muscle} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 truncate text-text-muted">{muscleLabel(b.muscle)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(b.sets / max) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums">{b.sets}</span>
              </div>
            );
          })}
          {data.breakdown.length === 0 && <p className="text-sm text-text-muted">No completed sets in this window yet.</p>}
        </div>

        {untrained.length > 0 && (
          <p className="mt-3 text-xs text-text-muted">
            Not trained in this window: <span className="text-danger">{untrained.map(muscleLabel).join(", ")}</span>
          </p>
        )}
      </Card>

      <Card>
        <CardLabel>Weekly Volume</CardLabel>
        <div className="mt-2">
          <WeeklyVolumeChart data={data.weeklyVolumes} />
        </div>
      </Card>

      {data.prRows.length > 0 && (
        <Card>
          <CardLabel>Strength Progression</CardLabel>
          <div className="mt-2 -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {data.prRows.map(({ exercise }) => (
              <button
                key={exercise.id}
                onClick={() => setSelectedExerciseId(exercise.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  activeExerciseId === exercise.id ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
                }`}
              >
                {exercise.name}
              </button>
            ))}
          </div>
          {trend && <ExerciseTrendChart points={trend} />}
        </Card>
      )}

      <Card>
        <CardLabel>Personal Records</CardLabel>
        <div className="mt-2 flex flex-col gap-2">
          {data.prRows.length === 0 && <p className="text-sm text-text-muted">Complete a few workouts to start setting records.</p>}
          {data.prRows.map(({ pr, exercise }) => (
            <div key={pr.id} className="flex items-center justify-between text-sm">
              <span>{exercise.name}</span>
              <span className="font-semibold">{formatPR(pr, exercise.name, data.unit).split("· ")[1]}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <Link href="/progress/strength">
          <Card className="flex items-center justify-between active:brightness-95">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-text-muted" />
              <span className="font-medium">1RM &amp; plate calculator</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
        <Link href="/progress/body">
          <Card className="flex items-center justify-between border-accent/30 active:brightness-95">
            <div className="flex items-center gap-2">
              <HeartPulse size={16} className="text-accent" />
              <span className="font-medium">Body Metrics Dashboard</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
        <Link href="/progress/measurements">
          <Card className="flex items-center justify-between active:brightness-95">
            <div className="flex items-center gap-2">
              <Ruler size={16} className="text-text-muted" />
              <span className="font-medium">Body Measurements</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
        <Link href="/progress/photos">
          <Card className="flex items-center justify-between active:brightness-95">
            <div className="flex items-center gap-2">
              <Camera size={16} className="text-text-muted" />
              <span className="font-medium">Progress Photos</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
