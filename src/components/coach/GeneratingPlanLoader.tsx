"use client";

import { useEffect, useState } from "react";
import { Camera, ScanFace, Dumbbell, BarChart3, Sparkles, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Camera, label: "Reading your photos" },
  { icon: ScanFace, label: "Assessing your physique" },
  { icon: Dumbbell, label: "Building your split" },
  { icon: BarChart3, label: "Balancing weekly volume" },
  { icon: Sparkles, label: "Finishing touches" },
];

const STEP_MS = 1800;
const MAX_PROGRESS = 92;

/** Cycles through icon/label pairs while a plan-generation request is in flight. */
export function GeneratingPlanLoader({ done = false }: { done?: boolean }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    if (done) return;
    const stepTimer = setInterval(() => setIndex((i) => (i + 1) % STEPS.length), STEP_MS);
    const progressTimer = setInterval(() => setProgress((p) => Math.min(MAX_PROGRESS, p + 2)), STEP_MS / 3);
    return () => {
      clearInterval(stepTimer);
      clearInterval(progressTimer);
    };
  }, [done]);

  const { icon: Icon, label } = STEPS[done ? STEPS.length - 1 : index];

  return (
    <Card className="flex flex-col items-center gap-4 border-accent/30 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon size={26} className={done ? undefined : "animate-pulse"} />
      </div>
      <div>
        <div className="font-semibold">{done ? "Your workout plan is ready" : label}</div>
        {!done && <div className="mt-0.5 text-xs text-text-muted">This can take a little while — don&apos;t close this screen.</div>}
      </div>
      <ProgressBar value={done ? 100 : progress} max={100} className="w-full max-w-xs" />
    </Card>
  );
}
