"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { RIR_OPTIONS } from "@/lib/utils/rir";
import { deleteSet, updateSet } from "@/lib/db/repo/workouts";
import type { Exercise, ExerciseSet } from "@/types/domain";

interface EditSetSheetProps {
  set: ExerciseSet | null;
  /** Only needed for labels (rep unit, whether weight applies) — edits work without it. */
  exercise?: Exercise;
  onClose: () => void;
}

/**
 * Corrects a set that was already logged: "I actually did 25kg, not 20." Saving rebuilds the
 * exercise's personal records, so a mistyped PR doesn't stay on the board.
 */
export function EditSetSheet({ set, exercise, onClose }: EditSetSheetProps) {
  if (!set) return null;
  return <EditSetForm key={set.id} set={set} exercise={exercise} onClose={onClose} />;
}

function EditSetForm({ set, exercise, onClose }: { set: ExerciseSet; exercise?: Exercise; onClose: () => void }) {
  const isBarbellParts = set.weightEntryMode === "barbell_total" && set.barWeightKg != null && set.platePerSideKg != null;
  const hasWeight = set.weightEntryMode !== "bodyweight" && set.weightEntryMode !== "assisted";

  const [weight, setWeight] = useState(set.weightKg);
  const [barWeight, setBarWeight] = useState(set.barWeightKg ?? 20);
  const [plateEach, setPlateEach] = useState(set.platePerSideKg ?? 0);
  const [reps, setReps] = useState(set.reps);
  const [rir, setRir] = useState<number | null>(set.rir);
  const [pain, setPain] = useState(set.painFlag);
  const [saving, setSaving] = useState(false);

  const repWord = exercise?.repUnit === "seconds" ? "sec" : exercise?.repUnit === "minutes" ? "min" : "reps";
  const weightLabel = set.weightEntryMode === "dumbbell_each" ? "Weight (per hand)" : "Weight";

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await updateSet(set.id, {
        weightKg: isBarbellParts ? barWeight + plateEach * 2 : weight,
        barWeightKg: isBarbellParts ? barWeight : set.barWeightKg,
        platePerSideKg: isBarbellParts ? plateEach : set.platePerSideKg,
        reps,
        rir,
        painFlag: pain,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this set? The remaining sets are renumbered and records are recalculated.")) return;
    setSaving(true);
    try {
      await deleteSet(set.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={`Edit set ${set.setNumber}`}>
      <div className="flex flex-col gap-4 pb-4">
        {exercise && <div className="-mt-1 text-sm text-text-muted">{exercise.name}</div>}

        {hasWeight && !isBarbellParts && (
          <div>
            <div className="mb-1 text-xs text-text-muted">{weightLabel}</div>
            <NumberStepper value={weight} onChange={setWeight} step={2.5} max={1000} decimals={2} quickSteps={[1, 2.5, 5]} />
          </div>
        )}

        {isBarbellParts && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs text-text-muted">Bar</div>
              <NumberStepper value={barWeight} onChange={setBarWeight} step={2.5} max={100} decimals={2} size="md" />
            </div>
            <div>
              <div className="mb-1 text-xs text-text-muted">Plate / side</div>
              <NumberStepper value={plateEach} onChange={setPlateEach} step={1.25} max={500} decimals={2} size="md" />
            </div>
            <div className="col-span-2 rounded-lg bg-surface-2 px-3 py-2 text-center text-sm font-semibold">
              = {barWeight + plateEach * 2} kg total
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 text-xs capitalize text-text-muted">{repWord}</div>
          <NumberStepper value={reps} onChange={setReps} step={1} max={1000} decimals={0} suffix={repWord} />
        </div>

        <div>
          <div className="mb-1 text-xs text-text-muted">Reps in reserve (RIR)</div>
          <SegmentedControl options={RIR_OPTIONS} value={rir} onChange={setRir} size="md" />
        </div>

        <button
          type="button"
          onClick={() => setPain((p) => !p)}
          className={`h-10 rounded-lg border px-3 text-xs font-medium ${
            pain ? "border-danger/50 bg-danger/15 text-danger" : "border-border bg-surface-2 text-text-muted"
          }`}
        >
          {pain ? "Pain flagged on this set" : "Flag pain / discomfort"}
        </button>

        <Button fullWidth size="lg" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button fullWidth variant="danger" disabled={saving} onClick={handleDelete}>
          <Trash2 size={16} />
          Delete set
        </Button>
      </div>
    </BottomSheet>
  );
}
