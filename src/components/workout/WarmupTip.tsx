"use client";

import { useState } from "react";
import { Flame, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { Exercise } from "@/types/domain";

export function WarmupTip({ exercise }: { exercise: Exercise }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !exercise.isCompound) return null;

  return (
    <Card className="mb-3 border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2">
          <Flame size={16} className="mt-0.5 shrink-0 text-text-muted" />
          <div className="text-xs text-text-muted">
            <span className="font-medium text-text">Optional warm-up:</span> 3–5 min light cardio, then 1–2 light
            sets of {exercise.name.toLowerCase()} below your working weight. Warm-up sets don&apos;t need to be logged.
          </div>
        </div>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-text-faint" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    </Card>
  );
}
