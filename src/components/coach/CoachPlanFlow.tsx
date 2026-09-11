"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Copy,
  Check,
  Download,
  ExternalLink,
  ClipboardPaste,
  TriangleAlert,
  Wand2,
  Dumbbell,
} from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GOALS, SPLIT_STYLES, EXPERIENCE_LEVELS, type ExperienceLevel } from "@/lib/coach/goals";
import { buildCoachPrompt, buildProgressReviewPrompt } from "@/lib/coach/prompt";
import { collectTrainingHistory } from "@/lib/coach/history";
import { extractJSON, validateCoachPlan } from "@/lib/coach/parse";
import { improveCoachPlan, type ImprovementReport } from "@/lib/coach/improve";
import { getAllExercises, getAvailableEquipmentKeys, isExerciseAvailable } from "@/lib/db/repo/exercises";
import { getSettings } from "@/lib/db/repo/settings";
import { getLatestBodyWeight } from "@/lib/db/repo/body";
import { applyCoachBlock, saveCoachPlan } from "@/lib/db/repo/coach";
import { copyToClipboard, CHATGPT_URL } from "@/lib/utils/clipboard";
import { downloadTextFile } from "@/lib/utils/download";
import { todayStr } from "@/lib/utils/date";
import type { IntakeAnswers } from "@/lib/coach/contract";
import type { TrainingGoal } from "@/types/domain";

export type CoachFlowMode = "new" | "update";
type Step = "goal" | "intake" | "prompt" | "paste" | "review";

interface CoachPlanFlowProps {
  mode: CoachFlowMode;
  /** Onboarding hides the "skip for now" affordances — a plan is how you get into the app. */
  onboarding?: boolean;
  onApplied: () => void;
}

function yearsSince(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
}

export function CoachPlanFlow({ mode, onboarding = false, onApplied }: CoachPlanFlowProps) {
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("goal");
  const [goal, setGoal] = useState<TrainingGoal>(user.goal ?? "vshape");
  const [splitStyle, setSplitStyle] = useState("auto");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [sessionMinutes, setSessionMinutes] = useState(60);
  const [experience, setExperience] = useState<ExperienceLevel>("returning");
  const [limitations, setLimitations] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [notes, setNotes] = useState("");
  const [includePhoto, setIncludePhoto] = useState(true);

  const [pasted, setPasted] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [report, setReport] = useState<ImprovementReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const context = useLiveQuery(async () => {
    const [exercises, availableEquipment, settings, weight] = await Promise.all([
      getAllExercises(),
      getAvailableEquipmentKeys(),
      getSettings(),
      getLatestBodyWeight(),
    ]);
    return {
      exercises,
      usableExercises: exercises.filter((e) => isExerciseAvailable(e, availableEquipment)),
      availableEquipment: [...availableEquipment],
      settings,
      weightKg: weight?.weightKg ?? null,
      // Derived off-render: reading the clock during render makes the component impure.
      ageYears: yearsSince(user.dateOfBirth),
      history: mode === "update" ? await collectTrainingHistory() : null,
    };
  }, [user.dateOfBirth, mode]);

  const intake: IntakeAnswers = {
    goal,
    splitStyle,
    daysPerWeek,
    sessionMinutes,
    experience,
    ageYears: context?.ageYears ?? null,
    gender: user.gender,
    heightCm: context?.settings.heightCm ?? null,
    weightKg: context?.weightKg ?? null,
    goalWeightKg: context?.settings.goalWeightKg ?? null,
    limitations,
    dislikes,
    notes,
    includePhotoInstruction: includePhoto,
  };

  const prompt = useMemo(() => {
    if (!context) return "";
    const args = { intake, library: context.usableExercises, availableEquipment: context.availableEquipment };
    return mode === "update" && context.history
      ? buildProgressReviewPrompt({ ...args, history: context.history })
      : buildCoachPrompt(args);
    // Rebuilt whenever any intake answer or the underlying data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, mode, goal, splitStyle, daysPerWeek, sessionMinutes, experience, limitations, dislikes, notes, includePhoto]);

  if (!context) return <div className="text-sm text-text-muted">Loading…</div>;

  async function handleCopy() {
    const ok = await copyToClipboard(prompt);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
  }

  function handleDownload() {
    downloadTextFile(`vshape-coach-prompt-${todayStr()}.txt`, prompt, "text/plain");
  }

  function handleImport() {
    setErrors([]);
    const extracted = extractJSON(pasted);
    if ("error" in extracted) {
      setErrors([extracted.error]);
      return;
    }

    const validated = validateCoachPlan(extracted.value);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }

    const improved = improveCoachPlan(validated.bundle, { library: context!.exercises, sessionMinutes });
    improved.improvements.unshift(...validated.repairs);
    setReport(improved);
    setStep("review");
  }

  async function handleApply(blockIndex: number) {
    if (!report || busy) return;
    setBusy(true);
    try {
      const record = await saveCoachPlan(report.bundle, report.improvements, report.warnings);
      const result = await applyCoachBlock(record, report.bundle.blocks[blockIndex].id);
      if (!result.ok) {
        setErrors([result.error ?? "Couldn't apply that plan."]);
        setStep("paste");
        return;
      }
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  const historyReady = mode !== "update" || (context.history?.totalWorkouts ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <StepDots step={step} />

      {step === "goal" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            {mode === "update"
              ? "Confirm what you're training for now — it can change, and the new program follows it."
              : "What are you actually training for? Everything after this is shaped by this answer."}
          </p>
          {GOALS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGoal(g.key)}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                goal === g.key ? "border-accent bg-accent/10" : "border-border bg-surface active:brightness-95"
              }`}
            >
              <div className="font-semibold">{g.label}</div>
              <div className="mt-0.5 text-sm text-text-muted">{g.blurb}</div>
            </button>
          ))}
          <Button size="lg" fullWidth onClick={() => setStep("intake")}>
            Continue
          </Button>
        </div>
      )}

      {step === "intake" && (
        <div className="flex flex-col gap-4">
          {mode === "update" && context.history && (
            <Card className="border-accent/30">
              <CardLabel>What gets sent</CardLabel>
              <p className="mt-2 text-sm text-text-muted">
                {context.history.totalWorkouts} logged workouts, every lift and the weights you moved on it,
                {context.history.bodyWeightTrend ? " your body-weight trend," : ""} and what&apos;s been stalling.
              </p>
            </Card>
          )}

          <Card>
            <CardLabel>Days per week</CardLabel>
            <div className="mt-2">
              <NumberStepper value={daysPerWeek} onChange={(v) => setDaysPerWeek(Math.round(v))} step={1} min={1} max={7} decimals={0} size="md" />
            </div>
          </Card>

          <Card>
            <CardLabel>Minutes per session</CardLabel>
            <div className="mt-2">
              <NumberStepper
                value={sessionMinutes}
                onChange={(v) => setSessionMinutes(Math.round(v))}
                step={5}
                min={20}
                max={180}
                decimals={0}
                size="md"
                suffix="min"
              />
            </div>
          </Card>

          <Card>
            <CardLabel>Split you prefer</CardLabel>
            <div className="mt-2 flex flex-col gap-2">
              {SPLIT_STYLES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSplitStyle(s.key)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm ${
                    splitStyle === s.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                  }`}
                >
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-text-muted">{s.description}</div>
                </button>
              ))}
            </div>
          </Card>

          {mode === "new" && (
            <Card>
              <CardLabel>Experience</CardLabel>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {EXPERIENCE_LEVELS.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => setExperience(e.key)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm ${
                      experience === e.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                    }`}
                  >
                    <div className="font-medium">{e.label}</div>
                    <div className="text-[11px] text-text-muted">{e.description}</div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardLabel>Anything it should know</CardLabel>
            <div className="mt-2 flex flex-col gap-3">
              <LabelledTextarea
                label="Injuries or limitations"
                value={limitations}
                onChange={setLimitations}
                placeholder="e.g. right shoulder clicks on overhead pressing"
              />
              <LabelledTextarea label="Exercises you don't want" value={dislikes} onChange={setDislikes} placeholder="e.g. no barbell back squats" />
              <LabelledTextarea
                label="Anything else"
                value={notes}
                onChange={setNotes}
                placeholder="e.g. gym is packed after 7pm, avoid squat rack work"
              />
            </div>
          </Card>

          <Card>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={includePhoto}
                onChange={(e) => setIncludePhoto(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-sm font-medium">I&apos;ll upload a physique photo in ChatGPT</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  Adds an instruction telling it to read the photo and say what it saw. Attach the photo in ChatGPT before you send the
                  prompt — the photo stays in your ChatGPT chat and never touches this app.
                </span>
              </span>
            </label>
          </Card>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("goal")}>
              Back
            </Button>
            <Button size="lg" fullWidth onClick={() => setStep("prompt")}>
              Build my prompt
            </Button>
          </div>
        </div>
      )}

      {step === "prompt" && (
        <div className="flex flex-col gap-3">
          <Card className="border-accent/30">
            <CardLabel>{mode === "update" ? "Your progress review prompt" : "Your prompt is ready"}</CardLabel>
            <p className="mt-2 text-sm text-text-muted">
              Download the prompt as a text file, open ChatGPT, and attach that file (the paperclip / attach icon) instead of
              pasting — it&apos;s long enough that some phone browsers can&apos;t copy all of it at once. Attach your photo too
              if you want one, then send.
            </p>
            {!historyReady && (
              <p className="mt-2 text-xs text-danger">
                You haven&apos;t logged any workouts yet, so there&apos;s no training history to review.
              </p>
            )}
            <Button size="lg" fullWidth className="mt-3" onClick={handleDownload}>
              <Download size={18} />
              Download prompt (.txt)
            </Button>
            <a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="lg" fullWidth className="mt-2">
                <ExternalLink size={18} />
                Open ChatGPT
              </Button>
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-text-muted active:text-text"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied to clipboard" : "Or copy the text instead"}
            </button>
          </Card>

          <details className="rounded-2xl border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium text-text-muted">
              Preview the prompt ({prompt.length.toLocaleString()} characters)
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">{prompt}</pre>
          </details>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("intake")}>
              Back
            </Button>
            <Button size="lg" fullWidth onClick={() => setStep("paste")}>
              I have the answer
            </Button>
          </div>
        </div>
      )}

      {step === "paste" && (
        <div className="flex flex-col gap-3">
          <Card>
            <CardLabel>Paste ChatGPT&apos;s answer</CardLabel>
            <p className="mt-1 text-xs text-text-muted">The whole reply is fine — surrounding chat text gets stripped automatically.</p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={10}
              placeholder='{ "vshape_plan": 1, "name": "..." }'
              className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs outline-none focus:border-accent"
            />
            <Button size="lg" fullWidth className="mt-3" disabled={!pasted.trim()} onClick={handleImport}>
              <ClipboardPaste size={18} />
              Check and improve it
            </Button>
          </Card>

          {errors.length > 0 && (
            <Card className="border-danger/40 bg-danger/5">
              <div className="flex items-center gap-2 text-sm font-semibold text-danger">
                <TriangleAlert size={16} />
                Couldn&apos;t import that
              </div>
              <ul className="mt-2 list-disc pl-5 text-xs text-text-muted">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-faint">
                Paste these points back to ChatGPT and ask it to fix them, keeping the same JSON shape.
              </p>
            </Card>
          )}

          <Button variant="secondary" onClick={() => setStep("prompt")}>
            Back
          </Button>
        </div>
      )}

      {step === "review" && report && (
        <ReviewStep report={report} busy={busy} onboarding={onboarding} onApply={handleApply} onBack={() => setStep("paste")} />
      )}
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ["goal", "intake", "prompt", "paste", "review"];
  const index = steps.indexOf(step);
  return (
    <div className="flex gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-accent" : "bg-surface-2"}`} />
      ))}
    </div>
  );
}

function LabelledTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface-2 p-3 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}

function ReviewStep({
  report,
  busy,
  onboarding,
  onApply,
  onBack,
}: {
  report: ImprovementReport;
  busy: boolean;
  onboarding: boolean;
  onApply: (blockIndex: number) => void;
  onBack: () => void;
}) {
  const [blockIndex, setBlockIndex] = useState(0);
  const block = report.bundle.blocks[blockIndex];

  return (
    <div className="flex flex-col gap-3">
      <Card className="border-accent/30">
        <CardLabel>{report.bundle.name}</CardLabel>
        <p className="mt-2 text-sm text-text-muted">{report.bundle.summary}</p>
        <div className="mt-2 text-xs text-text-faint">
          {report.bundle.blocks.length} blocks · {report.bundle.daysPerWeek} days/week ·{" "}
          {report.bundle.blocks.reduce((m, b) => Math.max(m, b.weekEnd), 0)} weeks
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <Wand2 size={15} className="text-accent" />
          <CardLabel>What your app changed</CardLabel>
        </div>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-text-muted">
          {report.improvements.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        {report.warnings.length > 0 && (
          <>
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-danger">
              <TriangleAlert size={13} />
              Worth knowing
            </div>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-xs text-text-muted">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardLabel>Weekly volume check</CardLabel>
        <p className="mt-1 text-[11px] text-text-faint">Working sets per muscle per week, counting assistance work at half credit.</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {report.weeklyVolume.slice(0, 10).map((v) => (
            <div key={v.muscle} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 capitalize text-text-muted">{v.muscle.replace(/_/g, " ")}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${v.status === "ok" ? "bg-success" : v.status === "low" ? "bg-accent" : "bg-danger"}`}
                  style={{ width: `${Math.min(100, (v.sets / 24) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums">{v.sets}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardLabel>Blocks</CardLabel>
        <div className="mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {report.bundle.blocks.map((b, i) => (
            <button
              key={b.id}
              onClick={() => setBlockIndex(i)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                i === blockIndex ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
              }`}
            >
              Wk {b.weekStart}–{b.weekEnd}
            </button>
          ))}
        </div>
        <div className="mt-3 text-sm font-semibold">{block.name}</div>
        {block.focus && <div className="text-xs text-text-muted">{block.focus}</div>}
        <div className="mt-3 flex flex-col gap-2">
          {block.routines.map((r) => (
            <div key={r.id} className="rounded-xl bg-surface-2 p-3">
              <div className="text-sm font-medium">{r.name}</div>
              <div className="mt-1 flex flex-col gap-0.5 text-xs text-text-muted">
                {r.exercises.map((ex, i) => (
                  <div key={`${ex.id}-${i}`}>
                    {ex.name ?? ex.id} · {ex.sets} × {ex.repsMin}–{ex.repsMax}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Button size="lg" fullWidth disabled={busy} onClick={() => onApply(blockIndex)}>
        <Dumbbell size={18} />
        {busy ? "Setting up…" : onboarding ? `Start with block ${blockIndex + 1}` : `Use block ${blockIndex + 1} as my program`}
      </Button>
      <p className="text-center text-xs text-text-faint">
        {onboarding
          ? "You can import a new plan any time from your profile."
          : "Your current program is saved first — you can undo this from the AI Coach screen at any time."}
      </p>
      <Button variant="secondary" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
