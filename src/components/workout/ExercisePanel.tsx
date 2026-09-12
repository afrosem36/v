"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Repeat2, ArrowRightLeft, Sparkles } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CompletedSetRow, PendingSetRow } from "@/components/workout/SetRow";
import { ExerciseInfoSheet } from "@/components/workout/ExerciseInfoSheet";
import { SwapExerciseSheet } from "@/components/workout/SwapExerciseSheet";
import { EditSetSheet } from "@/components/workout/EditSetSheet";
import { useActiveWorkoutStore } from "@/store/active-workout-store";
import { formatLastPerformance } from "@/lib/utils/workout-format";
import { totalLoadForSet } from "@/lib/engine/weight-math";
import { askCoach } from "@/lib/groq/askCoach";
import type { SessionExerciseEntry } from "@/lib/hooks/useActiveWorkoutSession";
import type { ExerciseSet } from "@/types/domain";

const MUSCLE_LABELS: Record<string, string> = {
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
  full_body: "Full Body",
};

const ACTION_LABELS: Record<string, string> = {
  calibrate: "Calibrating",
  increase: "Increase",
  hold: "Hold steady",
  decrease: "Step down",
  caution: "Caution",
  restart: "Easing back in",
};

interface ExercisePanelProps {
  entry: SessionExerciseEntry;
  sessionId: string;
  isLast: boolean;
  onNext: () => void;
  onSwap: (exerciseId: string) => void;
}

export function ExercisePanel({ entry, sessionId, isLast, onNext, onSwap }: ExercisePanelProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<ExerciseSet | null>(null);
  const startRest = useActiveWorkoutStore((s) => s.startRest);

  const { exercise, dayExercise, loggedSets, lastWorkingSets, prescription, weightStep, isComplete, wasSubstituted, originalExercise } = entry;

  const repRangeMin = dayExercise.repRangeMin || exercise.repRangeMin;
  const repRangeMax = dayExercise.repRangeMax || exercise.repRangeMax;

  const currentVolume = loggedSets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0);
  const lastVolume = lastWorkingSets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0);
  const volumeDeltaPct = lastVolume > 0 ? Math.round(((currentVolume - lastVolume) / lastVolume) * 100) : null;

  // A short AI cue after each set — while the exercise is still in progress, not once it's done
  // (the volume-vs-last-time card covers that moment instead). Ignored if it arrives after the
  // person has already moved to a different set count or exercise.
  const [tip, setTip] = useState<string | null>(null);
  const tipRequestSetCount = useRef(0);

  useEffect(() => {
    setTip(null);
    if (isComplete || loggedSets.length === 0 || exercise.loadType === "cardio") return;
    const setCountAtRequest = loggedSets.length;
    tipRequestSetCount.current = setCountAtRequest;
    askCoach({
      type: "exercise_tip",
      exerciseName: exercise.name,
      targetRepMin: repRangeMin,
      targetRepMax: repRangeMax,
      targetRir: prescription.action === "calibrate" ? null : prescription.targetRir,
      restSeconds: dayExercise.restSeconds,
      sets: loggedSets.map((s) => ({ weight: totalLoadForSet(s), reps: s.reps, rir: s.rir })),
    }).then((text) => {
      if (text && tipRequestSetCount.current === setCountAtRequest) setTip(text);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedSets.length, isComplete]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {MUSCLE_LABELS[exercise.primaryMuscle] ?? exercise.primaryMuscle}
            </div>
            <h2 className="text-xl font-bold leading-tight">{exercise.name}</h2>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setSwapOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 border border-border active:brightness-90"
              aria-label="Swap exercise"
            >
              <ArrowRightLeft size={16} />
            </button>
            <button
              onClick={() => setInfoOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 border border-border active:brightness-90"
              aria-label="Exercise info"
            >
              <Info size={16} />
            </button>
          </div>
        </div>
        {wasSubstituted && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
            <Repeat2 size={13} />
            Swapped from {originalExercise.name}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardLabel>Last Time</CardLabel>
          <div className="mt-1.5 text-sm font-semibold">{formatLastPerformance(lastWorkingSets, exercise.loadType, exercise.repUnit)}</div>
        </Card>
        <Card>
          <CardLabel>Today&apos;s Target</CardLabel>
          <div className="mt-1.5 text-sm font-semibold">
            {prescription.action === "calibrate"
              ? `${repRangeMin}–${repRangeMax} ${exercise.repUnit}`
              : `${prescription.suggestedWeightKg ?? "—"}${exercise.loadType === "cardio" || exercise.loadType === "bodyweight" ? "" : "kg"} · ${repRangeMin}–${repRangeMax}`}
          </div>
          {prescription.action !== "calibrate" && exercise.loadType !== "cardio" && (
            <div className="text-[11px] text-text-muted">
              Target {prescription.targetRirMin}–{prescription.targetRirMax} RIR
            </div>
          )}
          <div className="mt-0.5 text-[11px] font-medium text-accent">{ACTION_LABELS[prescription.action]}</div>
        </Card>
      </div>

      <p className="px-0.5 text-xs text-text-muted">{prescription.rationale}</p>

      <div className="flex flex-col gap-2">
        {loggedSets.map((s) => (
          <CompletedSetRow key={s.id} setNumber={s.setNumber} set={s} onEdit={setEditingSet} />
        ))}

        {tip && !isComplete && (
          <div className="flex animate-message-in items-start gap-2 rounded-xl border border-accent/25 bg-accent/5 px-3 py-2.5 text-xs leading-snug text-text">
            <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" />
            <span>{tip}</span>
          </div>
        )}

        {!isComplete && (
          <PendingSetRow
            key={`${exercise.id}-${loggedSets.length + 1}`}
            sessionId={sessionId}
            exercise={exercise}
            setNumber={loggedSets.length + 1}
            targetRepMin={repRangeMin}
            targetRepMax={repRangeMax}
            targetRir={prescription.targetRir}
            suggestedWeightKg={prescription.suggestedWeightKg}
            weightStep={weightStep}
            barWeightDefaultKg={20}
            plateStepKg={weightStep > 0 ? weightStep / 2 : 1.25}
            priorSetAtIndex={lastWorkingSets[loggedSets.length]}
            onLogged={() => startRest(dayExercise.restSeconds)}
          />
        )}
      </div>

      {isComplete && (
        <Card className="border-success/30 bg-success/5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Volume vs last time</span>
            <span className="font-semibold">
              {Math.round(currentVolume)}kg
              {volumeDeltaPct != null && (
                <span className={volumeDeltaPct >= 0 ? "text-success" : "text-danger"}>
                  {" "}
                  ({volumeDeltaPct >= 0 ? "+" : ""}
                  {volumeDeltaPct}%)
                </span>
              )}
            </span>
          </div>
          <Button fullWidth size="lg" className="mt-3" onClick={onNext}>
            {isLast ? "Finish Workout" : "Next Exercise"}
          </Button>
        </Card>
      )}

      <EditSetSheet set={editingSet} exercise={exercise} onClose={() => setEditingSet(null)} />
      <ExerciseInfoSheet exercise={infoOpen ? exercise : null} onClose={() => setInfoOpen(false)} />
      <SwapExerciseSheet
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        originalExercise={originalExercise}
        currentExerciseId={exercise.id}
        onSelect={onSwap}
      />
    </div>
  );
}
