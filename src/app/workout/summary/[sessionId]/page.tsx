"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { PartyPopper, Sparkles, NotebookPen, Apple } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CompletedSetRow } from "@/components/workout/SetRow";
import { getSession, getSessionSets, getPreviousCompletedSessionForDay, updateSessionNotes } from "@/lib/db/repo/workouts";
import { getExercisesByIds } from "@/lib/db/repo/exercises";
import { getPRsForSession } from "@/lib/db/repo/records";
import { getLatestBodyWeight } from "@/lib/db/repo/body";
import { getRecentSessionsSummary } from "@/lib/db/repo/analytics";
import { totalLoadForSet } from "@/lib/engine/weight-math";
import { estimateCaloriesBurned } from "@/lib/engine/body-metrics";
import { formatDuration, formatPR } from "@/lib/utils/format";
import { getSettings } from "@/lib/db/repo/settings";
import { askCoach } from "@/lib/groq/askCoach";

export default function WorkoutSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);

  const data = useLiveQuery(async () => {
    const session = await getSession(sessionId);
    if (!session) return null;

    const sets = await getSessionSets(sessionId);
    const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
    const exercises = await getExercisesByIds(exerciseIds);
    const prs = await getPRsForSession(sessionId);
    const settings = await getSettings();

    const previousSession = session.workoutDayId
      ? await getPreviousCompletedSessionForDay(session.workoutDayId, sessionId)
      : undefined;
    const previousVolume = previousSession ? (await getSessionSets(previousSession.id)).reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0) : null;

    const totalVolume = sets.reduce((sum, s) => sum + totalLoadForSet(s) * s.reps, 0);
    const durationMin =
      session.completedAt != null ? Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000) : 0;

    const latestWeight = await getLatestBodyWeight();
    const estimatedCalories = latestWeight ? estimateCaloriesBurned(durationMin, latestWeight.weightKg) : null;

    const byExercise = exercises.map((ex) => ({
      exercise: ex,
      sets: sets.filter((s) => s.exerciseId === ex.id).sort((a, b) => a.setNumber - b.setNumber),
    }));

    return { session, byExercise, prs, totalVolume, previousVolume, durationMin, estimatedCalories, unit: settings.units };
  }, [sessionId]);

  const [aiFeedback, setAiFeedback] = useState<string | null | undefined>(undefined);
  const [nutritionTip, setNutritionTip] = useState<string | null | undefined>(undefined);
  const [noteText, setNoteText] = useState("");
  const [noteSeeded, setNoteSeeded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    if (!data || aiFeedback !== undefined) return;
    const exercises = data.byExercise.map(({ exercise, sets }) => ({
      name: exercise.name,
      action: sets.every((s) => s.reps >= exercise.repRangeMax) ? "increase next time" : "hold this weight, chase reps",
      targetRepMin: exercise.repRangeMin,
      targetRepMax: exercise.repRangeMax,
      sets: sets.map((s) => ({ weight: s.weightKg, reps: s.reps, rir: s.rir })),
    }));
    askCoach({ type: "feedback", workoutLabel: data.session.label, exercises }).then(setAiFeedback);
  }, [data, aiFeedback]);

  // One Groq call per finished workout, based on the last few days of training — never repeated on re-render.
  useEffect(() => {
    if (!data || nutritionTip !== undefined) return;
    getRecentSessionsSummary(3).then((recentSessions) => {
      askCoach({ type: "nutrition", recentSessions }).then(setNutritionTip);
    });
  }, [data, nutritionTip]);

  if (data && !noteSeeded) {
    setNoteText(data.session.notes ?? "");
    setNoteSeeded(true);
  }

  // Auto-save shortly after typing stops, so a note is never sitting unsaved waiting for a blur
  // event that might not fire (e.g. navigating away by tapping a link rather than tabbing out).
  // "pending" is set by the change handler, not here — setting it in the effect body would
  // cascade an extra render on every keystroke.
  useEffect(() => {
    if (!noteSeeded) return;
    const timeout = setTimeout(async () => {
      await updateSessionNotes(sessionId, noteText);
      setSaveState("saved");
    }, 700);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteText]);

  if (!data) {
    return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;
  }

  const { session, byExercise, prs, totalVolume, previousVolume, durationMin, estimatedCalories, unit } = data;
  const totalSets = byExercise.reduce((sum, e) => sum + e.sets.length, 0);
  const volumeDeltaPct = previousVolume && previousVolume > 0 ? Math.round(((totalVolume - previousVolume) / previousVolume) * 100) : null;

  async function summarizeNote() {
    if (!noteText.trim()) return;
    setSummarizing(true);
    try {
      const result = await askCoach({
        type: "notes",
        rawNote: noteText,
        exerciseNames: byExercise.map((e) => e.exercise.name),
      });
      if (result) setNoteText(result);
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(2rem+var(--safe-top))] pb-10">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <PartyPopper size={26} />
        </div>
        <div className="text-xl font-bold">Workout Complete</div>
        <div className="text-sm text-text-muted">{session.label}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <CardLabel>Duration</CardLabel>
          <div className="mt-1 text-lg font-bold">{formatDuration(durationMin)}</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Sets</CardLabel>
          <div className="mt-1 text-lg font-bold">{totalSets}</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Volume</CardLabel>
          <div className="mt-1 text-lg font-bold">{Math.round(totalVolume)}kg</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Calories (est.)</CardLabel>
          <div className="mt-1 text-lg font-bold">{estimatedCalories != null ? estimatedCalories : "—"}</div>
        </Card>
      </div>

      {volumeDeltaPct != null && (
        <Card>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">vs. last time</span>
            <span className={`font-semibold ${volumeDeltaPct >= 0 ? "text-success" : "text-danger"}`}>
              {volumeDeltaPct >= 0 ? "+" : ""}
              {volumeDeltaPct}%
            </span>
          </div>
        </Card>
      )}

      {prs.length > 0 && (
        <Card className="border-accent/40 bg-accent/10">
          <CardLabel>New Records</CardLabel>
          <div className="mt-2 flex flex-col gap-1.5">
            {prs.map((pr) => {
              const ex = byExercise.find((e) => e.exercise.id === pr.exerciseId)?.exercise;
              return (
                <div key={pr.id} className="text-sm font-semibold text-accent">
                  {ex ? formatPR(pr, ex.name, unit) : null}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {aiFeedback && (
        <Card>
          <div className="flex items-center gap-1.5 text-text-muted">
            <Sparkles size={14} />
            <CardLabel>Coach Note</CardLabel>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed">{aiFeedback}</p>
        </Card>
      )}

      {nutritionTip && (
        <Card>
          <div className="flex items-center gap-1.5 text-text-muted">
            <Apple size={14} />
            <CardLabel>Recovery Food Ideas</CardLabel>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed">{nutritionTip}</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {byExercise.map(({ exercise, sets }) => (
          <Card key={exercise.id}>
            <div className="mb-2 font-semibold">{exercise.name}</div>
            <div className="flex flex-col gap-1.5">
              {sets.map((s) => (
                <CompletedSetRow key={s.id} setNumber={s.setNumber} set={s} />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center gap-1.5 text-text-muted">
          <NotebookPen size={14} />
          <CardLabel>Notes</CardLabel>
        </div>
        <textarea
          value={noteText}
          onChange={(e) => {
            setNoteText(e.target.value);
            setSaveState("pending");
          }}
          onBlur={() => updateSessionNotes(sessionId, noteText)}
          placeholder="e.g. bench felt heavy but incline felt easy…"
          rows={3}
          className="mt-2 w-full resize-none rounded-lg bg-surface-2 p-3 text-sm placeholder:text-text-faint"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={summarizeNote}
            disabled={summarizing || !noteText.trim()}
            className="flex items-center gap-1.5 text-xs font-medium text-accent disabled:opacity-40"
          >
            <Sparkles size={13} />
            {summarizing ? "Summarizing…" : "Tighten with AI"}
          </button>
        </div>
        {saveState !== "idle" && (
          <div className="mt-1 text-xs text-text-faint">{saveState === "pending" ? "Saving…" : "Saved"}</div>
        )}
      </Card>

      <Link href="/">
        <Button fullWidth size="lg" className="mt-2">
          Done
        </Button>
      </Link>
    </div>
  );
}
