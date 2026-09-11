"use client";

import { useEffect } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import { useActiveWorkoutStore } from "@/store/active-workout-store";
import { vibrate } from "@/lib/pwa/wake-lock";
import { useNow } from "@/lib/hooks/useNow";

function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function RestTimerBar() {
  const restTimer = useActiveWorkoutStore((s) => s.restTimer);
  const pauseRest = useActiveWorkoutStore((s) => s.pauseRest);
  const resumeRest = useActiveWorkoutStore((s) => s.resumeRest);
  const adjustRest = useActiveWorkoutStore((s) => s.adjustRest);
  const skipRest = useActiveWorkoutStore((s) => s.skipRest);

  const now = useNow(250);

  const remaining =
    restTimer.running && restTimer.endAt != null && now != null ? (restTimer.endAt - now) / 1000 : restTimer.totalSec;
  const done = remaining <= 0;
  const shouldBuzz = done && restTimer.running;

  // Buzzes once on the transition into "rest complete" — `shouldBuzz` only flips true once per
  // rest period, so the effect doesn't need a ref to de-duplicate itself.
  useEffect(() => {
    if (shouldBuzz) vibrate([200, 100, 200]);
  }, [shouldBuzz]);

  if (restTimer.totalSec <= 0 && !restTimer.running) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[var(--safe-bottom)]">
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        <div className="flex-1">
          <div className="text-xs text-text-muted">{done ? "Rest complete" : "Resting"}</div>
          <div className="text-2xl font-bold tabular-nums">{formatMMSS(remaining)}</div>
        </div>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 border border-border active:brightness-90"
          onClick={() => adjustRest(-30)}
          aria-label="Minus 30 seconds"
        >
          <span className="text-xs font-semibold">-30</span>
        </button>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 border border-border active:brightness-90"
          onClick={() => (restTimer.running ? pauseRest() : resumeRest())}
          aria-label={restTimer.running ? "Pause" : "Resume"}
        >
          {restTimer.running ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 border border-border active:brightness-90"
          onClick={() => adjustRest(30)}
          aria-label="Plus 30 seconds"
        >
          <span className="text-xs font-semibold">+30</span>
        </button>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground active:brightness-90"
          onClick={skipRest}
          aria-label="Skip rest"
        >
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
}
