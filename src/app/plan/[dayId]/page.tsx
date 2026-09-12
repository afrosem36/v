"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ArrowRightLeft, Trash2, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  getWorkoutDay,
  getWorkoutDayExercises,
  updateWorkoutDayExercise,
  addWorkoutDayExercise,
  removeWorkoutDayExercise,
  setDayRestStatus,
  getActiveSession,
  getSessionSets,
  startWorkoutForDay,
  completeSession,
  abandonSession,
  reorderWorkoutDayExercise,
  renameWorkoutDay,
} from "@/lib/db/repo/workouts";
import { getExercisesByIds, getExercisesByPrimaryMuscle, getAllExercises } from "@/lib/db/repo/exercises";
import { dayOfWeekOf, DOW_SHORT } from "@/lib/utils/date";
import type { Exercise, WorkoutDayExercise, MuscleGroupKey } from "@/types/domain";

const MUSCLE_LABELS: Record<MuscleGroupKey, string> = {
  lateral_delts: "Lateral Delts",
  lats: "Lats",
  rear_delts: "Rear Delts",
  upper_chest: "Upper Chest",
  chest: "Chest",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  front_delts: "Front Delts",
  traps: "Traps",
  full_body: "Full Body / Cardio",
};

function useDayDetail(dayId: string) {
  return useLiveQuery(async () => {
    const day = await getWorkoutDay(dayId);
    if (!day) return null;
    const dayExercises = await getWorkoutDayExercises(dayId);
    const exercises = await getExercisesByIds(dayExercises.map((d) => d.exerciseId));
    const activeSession = await getActiveSession();
    const activeSetCount = activeSession ? (await getSessionSets(activeSession.id)).length : 0;
    return {
      activeSession,
      activeSetCount,
      day,
      rows: dayExercises.map((de) => ({ de, exercise: exercises.find((e) => e.id === de.exerciseId)! })).filter((r) => r.exercise),
    };
  }, [dayId]);
}

export default function PlanDayPage({ params }: { params: Promise<{ dayId: string }> }) {
  const { dayId } = use(params);
  const router = useRouter();
  const data = useDayDetail(dayId);
  const [swapFor, setSwapFor] = useState<{ de: WorkoutDayExercise; exercise: Exercise } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  /**
   * Starts THIS day's routine today, whatever weekday it is in the plan — e.g. catching up on a
   * missed Thursday from Friday, or getting ahead on Monday's early. Doing that never touches any
   * other day's own completion: sessions are tracked by when they actually happened
   * (`startedAt`/`scheduledDate`), so finishing a catch-up session today doesn't mark today's own
   * scheduled day done, and vice versa — both can be done independently, in either order.
   *
   * An unfinished session used to silently swallow the tap and reopen itself — which is how
   * picking Wednesday landed you back in Tuesday's workout.
   */
  async function handleStart() {
    if (starting || !data) return;
    const { activeSession, activeSetCount, day } = data;

    if (activeSession && activeSession.workoutDayId === day.id) {
      router.push(`/workout/active?session=${activeSession.id}`);
      return;
    }

    if (day.dayOfWeek !== dayOfWeekOf(new Date())) {
      if (!confirm(`Continue with "${day.label}"? It's usually scheduled for ${DOW_SHORT[day.dayOfWeek]}, not today.`)) return;
    }

    if (activeSession) {
      const resumeOther = confirm(
        `"${activeSession.label}" is still open with ${activeSetCount} set(s) logged.\n\n` +
          `OK — go back to that one.\nCancel — close it and start "${day.label}" instead.`
      );
      if (resumeOther) {
        router.push(`/workout/active?session=${activeSession.id}`);
        return;
      }
      if (activeSetCount > 0) await completeSession(activeSession.id);
      else await abandonSession(activeSession.id);
    }

    setStarting(true);
    try {
      const session = await startWorkoutForDay(day, { timeBudgetMinutes: null });
      router.push(`/workout/active?session=${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this exercise from the day?")) return;
    await removeWorkoutDayExercise(id);
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="flex items-start justify-between gap-3">
        <input
          defaultValue={data.day.label}
          onBlur={(e) => renameWorkoutDay(dayId, e.target.value)}
          aria-label="Workout name"
          className="min-w-0 flex-1 bg-transparent text-2xl font-bold tracking-tight outline-none focus:border-b focus:border-accent"
        />
        <button
          onClick={() => setDayRestStatus(dayId, !data.day.isRestDay)}
          className="shrink-0 rounded-lg bg-surface-2 border border-border px-3 py-1.5 text-xs font-medium text-text-muted active:brightness-90"
        >
          {data.day.isRestDay ? "Make it active" : "Mark as rest"}
        </button>
      </div>

      {data.day.isRestDay ? (
        <p className="text-sm text-text-muted">
          Rest day — no exercises scheduled. Tap &quot;Make it active&quot; above if you want an optional session here (e.g. a light
          Sunday task) instead of full rest.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" fullWidth disabled={starting} onClick={handleStart}>
            {data.activeSession?.workoutDayId === data.day.id ? "Resume Workout in Progress" : "Start This Workout"}
          </Button>
          {data.rows.map(({ de, exercise }, index) => (
            <Card key={de.id}>
              <div className="mb-3 flex items-center justify-between">
                <div className="font-semibold">{exercise.name}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => reorderWorkoutDayExercise(de.id, -1)}
                    disabled={index === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-border active:brightness-90 disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => reorderWorkoutDayExercise(de.id, 1)}
                    disabled={index === data.rows.length - 1}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-border active:brightness-90 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => setSwapFor({ de, exercise })}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-border active:brightness-90"
                    aria-label="Change exercise"
                  >
                    <ArrowRightLeft size={14} />
                  </button>
                  <button
                    onClick={() => handleRemove(de.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-border text-danger active:brightness-90"
                    aria-label="Remove exercise"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div>
                  <CardLabel>Sets</CardLabel>
                  <NumberStepper
                    value={de.targetSets}
                    onChange={(v) => updateWorkoutDayExercise(de.id, { targetSets: Math.max(1, Math.round(v)) })}
                    step={1}
                    decimals={0}
                    size="md"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <CardLabel>Min reps</CardLabel>
                    <NumberStepper
                      value={de.repRangeMin}
                      onChange={(v) => updateWorkoutDayExercise(de.id, { repRangeMin: Math.max(1, Math.round(v)) })}
                      step={1}
                      decimals={0}
                      size="md"
                    />
                  </div>
                  <div>
                    <CardLabel>Max reps</CardLabel>
                    <NumberStepper
                      value={de.repRangeMax}
                      onChange={(v) => updateWorkoutDayExercise(de.id, { repRangeMax: Math.max(de.repRangeMin, Math.round(v)) })}
                      step={1}
                      decimals={0}
                      size="md"
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <Button variant="secondary" fullWidth onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            Add Exercise
          </Button>
        </div>
      )}

      {swapFor && (
        <SwapDefaultSheet
          current={swapFor}
          onClose={() => setSwapFor(null)}
          onSelect={async (exerciseId) => {
            await updateWorkoutDayExercise(swapFor.de.id, { exerciseId });
            setSwapFor(null);
          }}
        />
      )}

      <AddExerciseSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSelect={async (exerciseId) => {
          await addWorkoutDayExercise(dayId, exerciseId);
          setAddOpen(false);
        }}
      />
    </div>
  );
}

function SwapDefaultSheet({
  current,
  onClose,
  onSelect,
}: {
  current: { de: WorkoutDayExercise; exercise: Exercise };
  onClose: () => void;
  onSelect: (exerciseId: string) => void;
}) {
  const candidates = useLiveQuery(() => getExercisesByPrimaryMuscle(current.exercise.primaryMuscle), [current.exercise.primaryMuscle]);

  return (
    <BottomSheet open onClose={onClose} title="Change Exercise">
      <div className="space-y-2 pb-4">
        {candidates?.map((ex) => (
          <button
            key={ex.id}
            onClick={() => onSelect(ex.id)}
            className={`w-full rounded-xl border px-4 py-3 text-left ${
              ex.id === current.exercise.id ? "border-accent bg-accent/10" : "border-border bg-surface-2 active:brightness-90"
            }`}
          >
            <div className="font-medium">{ex.name}</div>
            <div className="text-xs text-text-muted">
              {ex.isCompound ? "Compound" : "Isolation"} · {ex.equipment.join(", ")}
            </div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function AddExerciseSheet({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (exerciseId: string) => void }) {
  const all = useLiveQuery(() => (open ? getAllExercises() : undefined), [open]);

  const grouped = new Map<MuscleGroupKey, Exercise[]>();
  for (const ex of all ?? []) {
    const arr = grouped.get(ex.primaryMuscle) ?? [];
    arr.push(ex);
    grouped.set(ex.primaryMuscle, arr);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add Exercise">
      <div className="space-y-4 pb-4">
        {[...grouped.entries()].map(([muscle, exercises]) => (
          <div key={muscle}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{MUSCLE_LABELS[muscle]}</div>
            <div className="space-y-2">
              {exercises.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => onSelect(ex.id)}
                  className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-left active:brightness-90"
                >
                  <div className="font-medium">{ex.name}</div>
                  <div className="text-xs text-text-muted">
                    {ex.isCompound ? "Compound" : "Isolation"} · {ex.repRangeMin}-{ex.repRangeMax} {ex.repUnit}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
