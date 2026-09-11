"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import clsx from "clsx";

interface NumberStepperProps {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  /**
   * Leave unset for anything that can legitimately be large (steps, calories, machine stacks).
   * The old default of 999 silently clamped every step count above it, which made it impossible
   * to type 3000 or 5000 — the field cannot be relied on to guess a sane ceiling.
   */
  max?: number;
  suffix?: string;
  decimals?: number;
  quickSteps?: number[];
  size?: "md" | "lg";
}

function round(v: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function NumberStepper({
  value,
  onChange,
  step,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  suffix,
  decimals = 1,
  quickSteps,
  size = "lg",
}: NumberStepperProps) {
  // While the field has focus the user's literal keystrokes win. Reformatting mid-entry is what
  // makes multi-digit numbers impossible to type: "5" becomes 5, then "50", then "500"…
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, round(v, decimals)));

  function commitDraft(raw: string) {
    const parsed = parseFloat(raw);
    onChange(Number.isFinite(parsed) ? clamp(parsed) : min);
    setDraft(null);
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            onChange(clamp(value - step));
          }}
          className={clsx(
            "flex items-center justify-center rounded-xl bg-surface-2 border border-border active:brightness-90 shrink-0",
            size === "lg" ? "h-14 w-14" : "h-11 w-11"
          )}
          aria-label="Decrease"
        >
          <Minus size={20} />
        </button>

        <div
          className={clsx(
            "flex flex-1 min-w-0 items-center justify-center gap-1 rounded-xl bg-surface-2 border border-border",
            size === "lg" ? "h-14" : "h-11"
          )}
        >
          <input
            type="number"
            inputMode="decimal"
            enterKeyHint="done"
            value={draft ?? String(value)}
            onFocus={(e) => {
              setDraft(String(value));
              e.currentTarget.select();
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              // Save as they type, but only once what they've typed is actually in range — so a
              // half-typed "50" on the way to "5000" never gets written back as the final value.
              const parsed = parseFloat(raw);
              if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(round(parsed, decimals));
            }}
            onBlur={(e) => commitDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={clsx(
              "min-w-0 flex-1 basis-0 bg-transparent text-center font-bold tabular-nums",
              size === "lg" ? "text-2xl" : "text-lg"
            )}
          />
          {suffix && <span className="shrink-0 pr-3 text-sm text-text-muted">{suffix}</span>}
        </div>

        <button
          type="button"
          onClick={() => {
            setDraft(null);
            onChange(clamp(value + step));
          }}
          className={clsx(
            "flex items-center justify-center rounded-xl bg-surface-2 border border-border active:brightness-90 shrink-0",
            size === "lg" ? "h-14 w-14" : "h-11 w-11"
          )}
          aria-label="Increase"
        >
          <Plus size={20} />
        </button>
      </div>

      {quickSteps && quickSteps.length > 0 && (
        <div className="mt-2 flex gap-2">
          {quickSteps.map((qs) => (
            <button
              key={qs}
              type="button"
              onClick={() => {
                setDraft(null);
                onChange(clamp(value + qs));
              }}
              className="h-9 flex-1 rounded-lg bg-surface-2 border border-border text-xs font-medium text-text-muted active:brightness-90"
            >
              +{qs}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
