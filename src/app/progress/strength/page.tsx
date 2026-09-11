"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Calculator, Dumbbell } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { getStrengthProfile } from "@/lib/db/repo/analytics";
import { getSettings } from "@/lib/db/repo/settings";
import { estimate1RM } from "@/lib/engine/pr";
import { calculatePlates, percentagesOf1RM, DEFAULT_PLATES_KG } from "@/lib/engine/weight-math";
import { formatShortDate } from "@/lib/utils/date";

export default function StrengthPage() {
  const router = useRouter();

  const data = useLiveQuery(async () => {
    const [strength, settings] = await Promise.all([getStrengthProfile(), getSettings()]);
    return { strength, settings };
  }, []);

  const [calcWeight, setCalcWeight] = useState(60);
  const [calcReps, setCalcReps] = useState(8);
  const [plateTarget, setPlateTarget] = useState(60);
  const [barWeight, setBarWeight] = useState(20);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const estimated = Math.round(estimate1RM(calcWeight, calcReps) * 10) / 10;
  const breakdown = calculatePlates(plateTarget, barWeight, DEFAULT_PLATES_KG);

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="text-2xl font-bold tracking-tight">Strength</div>

      <Card>
        <CardLabel>Estimated 1RM by exercise</CardLabel>
        <p className="mt-1 text-[11px] text-text-faint">
          From your best logged set at 12 reps or fewer. An estimate for programming, not a number to go and attempt.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {data.strength.length === 0 && <p className="text-sm text-text-muted">Log a few weighted sets and this fills in.</p>}
          {data.strength.map((s) => (
            <div key={s.exerciseId} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="text-[11px] text-text-faint">
                  {s.bestWeightKg}kg × {s.bestReps} · {formatShortDate(s.lastPerformed)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-bold tabular-nums">{s.estimated1RM}kg</div>
                <div className="text-[10px] uppercase tracking-wide text-text-faint">est. 1RM</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <Calculator size={16} className="text-accent" />
          <CardLabel>1RM calculator</CardLabel>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Weight</div>
            <NumberStepper value={calcWeight} onChange={setCalcWeight} step={2.5} max={500} decimals={1} size="md" />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Reps</div>
            <NumberStepper value={calcReps} onChange={setCalcReps} step={1} min={1} max={12} decimals={0} size="md" />
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-surface-2 p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{estimated} kg</div>
          <div className="text-[11px] text-text-muted">estimated one-rep max</div>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          {percentagesOf1RM(estimated).map((row) => (
            <div key={row.percent} className="flex items-center justify-between text-xs">
              <span className="w-10 text-text-muted">{row.percent}%</span>
              <span className="flex-1 font-medium tabular-nums">{row.weightKg} kg</span>
              <span className="text-text-faint">~{row.reps} reps</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <Dumbbell size={16} className="text-accent" />
          <CardLabel>Plate calculator</CardLabel>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Target total</div>
            <NumberStepper value={plateTarget} onChange={setPlateTarget} step={2.5} max={500} decimals={1} size="md" />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Bar weight</div>
            <NumberStepper value={barWeight} onChange={setBarWeight} step={2.5} max={50} decimals={1} size="md" />
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-text-muted">Load each side with</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {breakdown.perSide.length === 0 && <span className="text-sm text-text-muted">Just the bar.</span>}
            {breakdown.perSide.map((plate, i) => (
              <span key={`${plate}-${i}`} className="rounded-lg bg-accent/20 px-2.5 py-1 text-sm font-semibold text-accent tabular-nums">
                {plate}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-text-muted">
            = {breakdown.achievedTotalKg} kg total
            {breakdown.shortfallKg > 0 && ` · ${breakdown.shortfallKg} kg short of your target with these plates`}
          </div>
        </div>
      </Card>
    </div>
  );
}
