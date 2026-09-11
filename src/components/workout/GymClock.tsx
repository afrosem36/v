"use client";

import { Timer } from "lucide-react";
import { useNow } from "@/lib/hooks/useNow";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Live "time spent in the gym" clock — ticks from when the session was started (clock-in). */
export function GymClock({ startedAt }: { startedAt: string }) {
  const now = useNow(1000);
  const elapsedMs = now != null ? now - new Date(startedAt).getTime() : 0;

  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-accent">
      <Timer size={15} />
      {formatElapsed(elapsedMs)}
    </div>
  );
}
