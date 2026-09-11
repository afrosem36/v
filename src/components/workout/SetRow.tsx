"use client";

import { useEffect, useRef, useState } from "react";
import { Check, TriangleAlert, Sparkles, Pencil } from "lucide-react";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { RIR_OPTIONS, rirLabel } from "@/lib/utils/rir";
import { addSet } from "@/lib/db/repo/workouts";
import { getAvailableEquipmentKeys } from "@/lib/db/repo/exercises";
import { vibrate } from "@/lib/pwa/wake-lock";
import { loadTypeToEntryMode } from "@/lib/engine/weight-math";
import { askCoach } from "@/lib/groq/askCoach";
import type { Exercise, ExerciseSet } from "@/types/domain";

interface CompletedSetRowProps {
  setNumber: number;
  set: ExerciseSet;
  /** Pass to make the row tappable for corrections. Omit for read-only contexts. */
  onEdit?: (set: ExerciseSet) => void;
}

export function CompletedSetRow({ setNumber, set, onEdit }: CompletedSetRowProps) {
  const weightLabel = describeWeight(set);

  const content = (
    <>
      <div className="flex items-center gap-2">
        <Check size={16} className="text-success" />
        <span className="font-medium">Set {setNumber}</span>
      </div>
      <div className="flex items-center gap-3 text-text-muted">
        {weightLabel && <span>{weightLabel}</span>}
        <span>
          {set.reps} {set.reps === 1 ? "rep" : "reps"}
        </span>
        {set.rir != null && <span>RIR {rirLabel(set.rir)}</span>}
        {set.painFlag && <TriangleAlert size={15} className="text-danger" />}
        {onEdit && <Pencil size={14} className="text-text-faint" />}
      </div>
    </>
  );

  if (!onEdit) {
    return <div className="flex items-center justify-between rounded-xl bg-surface-2/60 px-4 py-3 text-sm">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onEdit(set)}
      aria-label={`Edit set ${setNumber}`}
      className="flex w-full items-center justify-between rounded-xl bg-surface-2/60 px-4 py-3 text-left text-sm active:brightness-90"
    >
      {content}
    </button>
  );
}

function describeWeight(set: Pick<ExerciseSet, "weightEntryMode" | "weightKg" | "barWeightKg" | "platePerSideKg">): string | null {
  switch (set.weightEntryMode) {
    case "dumbbell_each":
      return `${set.weightKg}kg each`;
    case "barbell_total":
      return set.barWeightKg != null && set.platePerSideKg != null
        ? `${set.barWeightKg + set.platePerSideKg * 2}kg total`
        : `${set.weightKg}kg`;
    case "machine":
      return `${set.weightKg}kg`;
    default:
      return null;
  }
}

interface PendingSetRowProps {
  sessionId: string;
  exercise: Exercise;
  setNumber: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  suggestedWeightKg: number | null;
  weightStep: number;
  barWeightDefaultKg: number;
  plateStepKg: number;
  priorSetAtIndex: ExerciseSet | undefined;
  onLogged: () => void;
}

export function PendingSetRow({
  sessionId,
  exercise,
  setNumber,
  targetRepMin,
  targetRepMax,
  targetRir,
  suggestedWeightKg,
  weightStep,
  barWeightDefaultKg,
  plateStepKg,
  priorSetAtIndex,
  onLogged,
}: PendingSetRowProps) {
  const entryMode = loadTypeToEntryMode(exercise.loadType);

  const [weight, setWeight] = useState(() => suggestedWeightKg ?? priorSetAtIndex?.weightKg ?? 0);
  const [barWeight, setBarWeight] = useState(() => priorSetAtIndex?.barWeightKg ?? barWeightDefaultKg);
  const [plateEach, setPlateEach] = useState(() => priorSetAtIndex?.platePerSideKg ?? 0);
  const [barbellEntryStyle, setBarbellEntryStyle] = useState<"parts" | "total">(
    priorSetAtIndex && priorSetAtIndex.barWeightKg == null ? "total" : "parts"
  );
  const [barbellTotal, setBarbellTotal] = useState(() => suggestedWeightKg ?? priorSetAtIndex?.weightKg ?? barWeightDefaultKg);
  const [reps, setReps] = useState(() => priorSetAtIndex?.reps ?? targetRepMax);
  const [rir, setRir] = useState<number | null>(priorSetAtIndex?.rir ?? targetRir);
  const [pain, setPain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [painAiText, setPainAiText] = useState<string | null>(null);
  const [painAiLoading, setPainAiLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function askPainAlternatives() {
    if (painAiLoading) return;
    setPainAiLoading(true);
    try {
      const available = [...(await getAvailableEquipmentKeys())];
      const result = await askCoach({
        type: "adjust",
        exerciseName: exercise.name,
        primaryMuscle: exercise.primaryMuscle,
        availableEquipment: available,
        discomfortNote: "Discomfort reported during this set.",
      });
      setPainAiText(result ?? "AI coach is unavailable right now. Use the exercise's alternatives via the swap button instead.");
    } finally {
      setPainAiLoading(false);
    }
  }

  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const isCardio = exercise.loadType === "cardio";
  const repWord = exercise.repUnit === "seconds" ? "sec" : exercise.repUnit === "minutes" ? "min" : "reps";

  async function handleLog() {
    if (saving) return;
    setSaving(true);
    try {
      await addSet({
        sessionId,
        exerciseId: exercise.id,
        setNumber,
        isWarmup: false,
        weightEntryMode: entryMode,
        weightKg:
          entryMode === "barbell_total" ? (barbellEntryStyle === "total" ? barbellTotal : barWeight + plateEach * 2) : weight,
        barWeightKg: entryMode === "barbell_total" && barbellEntryStyle === "parts" ? barWeight : null,
        platePerSideKg: entryMode === "barbell_total" && barbellEntryStyle === "parts" ? plateEach : null,
        assistKg: null,
        reps,
        rir,
        painFlag: pain,
      });
      vibrate(40);
      onLogged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} className="rounded-xl border border-accent/30 bg-surface-2/40 p-4 scroll-mt-20">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">Set {setNumber}</span>
        {!isCardio && (
          <span className="text-xs text-text-muted">
            Target: {targetRepMin}–{targetRepMax} {repWord}
          </span>
        )}
      </div>

      {!isCardio && entryMode === "dumbbell_each" && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-text-muted">Weight (per hand)</div>
          <NumberStepper value={weight} onChange={setWeight} step={weightStep} suffix="kg each" decimals={2} quickSteps={[1, 2, 2.5, 5]} />
        </div>
      )}

      {!isCardio && entryMode === "machine" && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-text-muted">Weight (stack)</div>
          <NumberStepper value={weight} onChange={setWeight} step={weightStep} suffix="kg" decimals={1} quickSteps={[5, 10]} />
        </div>
      )}

      {!isCardio && entryMode === "barbell_total" && (
        <div className="mb-3">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setBarbellEntryStyle("parts")}
              className={`h-8 flex-1 rounded-lg text-xs font-medium ${barbellEntryStyle === "parts" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"}`}
            >
              Bar + Plates
            </button>
            <button
              type="button"
              onClick={() => setBarbellEntryStyle("total")}
              className={`h-8 flex-1 rounded-lg text-xs font-medium ${barbellEntryStyle === "total" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"}`}
            >
              Enter Total
            </button>
          </div>

          {barbellEntryStyle === "parts" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-text-muted">Bar</div>
                <NumberStepper value={barWeight} onChange={setBarWeight} step={2.5} decimals={2} size="md" />
              </div>
              <div>
                <div className="mb-1 text-xs text-text-muted">Plate / side</div>
                <NumberStepper value={plateEach} onChange={setPlateEach} step={plateStepKg} decimals={2} size="md" quickSteps={[1.25, 2.5, 5]} />
              </div>
              <div className="col-span-2 rounded-lg bg-surface px-3 py-2 text-center text-sm font-semibold">
                = {(barWeight + plateEach * 2).toFixed(2).replace(/\.?0+$/, "")} kg total
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1 text-xs text-text-muted">Total weight</div>
              <NumberStepper value={barbellTotal} onChange={setBarbellTotal} step={2.5} suffix="kg" decimals={2} quickSteps={[2.5, 5, 10]} />
            </div>
          )}
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1 text-xs text-text-muted capitalize">{repWord}</div>
        <NumberStepper
          value={reps}
          onChange={setReps}
          step={exercise.repUnit === "seconds" ? 5 : exercise.repUnit === "minutes" ? 1 : 1}
          suffix={repWord}
          decimals={0}
        />
      </div>

      {!isCardio && (
        <div className="mb-4">
          <div className="mb-1 text-xs text-text-muted">Reps in reserve (RIR)</div>
          <SegmentedControl options={RIR_OPTIONS} value={rir} onChange={setRir} size="md" />
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPain((p) => !p)}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ${
            pain ? "border-danger/50 bg-danger/15 text-danger" : "border-border bg-surface-2 text-text-muted"
          }`}
        >
          <TriangleAlert size={14} />
          Pain / discomfort?
        </button>
      </div>

      {pain && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
          {painAiText ? (
            <p className="text-xs text-text-muted">{painAiText}</p>
          ) : (
            <button
              onClick={askPainAlternatives}
              disabled={painAiLoading}
              className="flex items-center gap-1.5 text-xs font-medium text-danger disabled:opacity-40"
            >
              <Sparkles size={13} />
              {painAiLoading ? "Asking AI…" : "Ask AI for alternative exercises"}
            </button>
          )}
          <p className="mt-1.5 text-[11px] text-text-faint">Not medical advice — see a professional if this continues.</p>
        </div>
      )}

      <Button fullWidth size="lg" disabled={saving} onClick={handleLog}>
        {saving ? "Logging…" : "Log Set"}
      </Button>
    </div>
  );
}
