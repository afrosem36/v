"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ChevronRight, Scale, Ruler, Flame, Timer } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { getSettings } from "@/lib/db/repo/settings";
import { getLatestBodyWeight, rollingAverageWeight, getBodyWeightsInRange, getFirstBodyFatEntry, getLatestBodyFatEntry } from "@/lib/db/repo/body";
import { getWeeklyGymStats } from "@/lib/db/repo/analytics";
import { computeBMI, bmiCategory, weightToGoal, fatMassKg } from "@/lib/engine/body-metrics";
import { kgToDisplay, formatWeight } from "@/lib/utils/format";
import { todayStr } from "@/lib/utils/date";
import { subDays, format } from "date-fns";

function useBodyDashboard() {
  return useLiveQuery(async () => {
    const settings = await getSettings();
    const latest = await getLatestBodyWeight();
    const start30 = format(subDays(new Date(), 29), "yyyy-MM-dd");
    const range = await getBodyWeightsInRange(start30, todayStr());
    const avg7 = rollingAverageWeight(range, 7);

    const firstFat = await getFirstBodyFatEntry();
    const latestFat = await getLatestBodyFatEntry();

    const gymStats = await getWeeklyGymStats(latest?.weightKg ?? null);

    return { settings, latest, avg7, firstFat, latestFat, gymStats };
  }, []);
}

export default function BodyMetricsPage() {
  const router = useRouter();
  const data = useBodyDashboard();

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const { settings, latest, avg7, firstFat, latestFat, gymStats } = data;
  const unit = settings.units;

  const bmi = latest && settings.heightCm ? computeBMI(latest.weightKg, settings.heightCm) : null;
  const goal = latest && settings.goalWeightKg != null ? weightToGoal(latest.weightKg, settings.goalWeightKg) : null;

  const fatLostKg =
    firstFat && latestFat && firstFat.id !== latestFat.id
      ? Math.round((fatMassKg(firstFat.weightKg, firstFat.bodyFatPercent!) - fatMassKg(latestFat.weightKg, latestFat.bodyFatPercent!)) * 10) / 10
      : null;

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="text-2xl font-bold tracking-tight">Body Metrics</div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <CardLabel>Weight</CardLabel>
          <div className="mt-1 text-lg font-bold">{latest ? formatWeight(latest.weightKg, unit) : "—"}</div>
          {avg7 != null && <div className="text-[11px] text-text-muted">{kgToDisplay(avg7, unit)} 7-day avg</div>}
        </Card>
        <Card className="text-center">
          <CardLabel>Height</CardLabel>
          <div className="mt-1 text-lg font-bold">{settings.heightCm != null ? `${settings.heightCm} cm` : "—"}</div>
          {settings.heightCm == null && (
            <Link href="/settings" className="text-[11px] text-accent">
              Set in Settings
            </Link>
          )}
        </Card>
        <Card className="text-center">
          <CardLabel>BMI</CardLabel>
          <div className="mt-1 text-lg font-bold">{bmi ?? "—"}</div>
          {bmi != null && <div className="text-[11px] text-text-muted">{bmiCategory(bmi)}</div>}
        </Card>
        <Card className="text-center">
          <CardLabel>{goal?.direction === "gain" ? "To gain" : "To lose"}</CardLabel>
          <div className="mt-1 text-lg font-bold">
            {goal == null ? "—" : goal.direction === "at_goal" ? "At goal" : formatWeight(goal.amountKg, unit)}
          </div>
          {settings.goalWeightKg == null && (
            <Link href="/settings" className="text-[11px] text-accent">
              Set a goal
            </Link>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-1.5 text-text-muted">
          <Flame size={14} />
          <CardLabel>Body Fat</CardLabel>
        </div>
        {latestFat ? (
          <div className="mt-2 flex items-center justify-between text-sm">
            <div>
              <div className="font-semibold">{latestFat.bodyFatPercent}%</div>
              <div className="text-xs text-text-muted">≈ {fatMassKg(latestFat.weightKg, latestFat.bodyFatPercent!)} kg fat mass</div>
            </div>
            {fatLostKg != null && (
              <div className="text-right">
                <div className={`font-semibold ${fatLostKg > 0 ? "text-success" : "text-text-muted"}`}>
                  {fatLostKg > 0 ? `-${fatLostKg}` : fatLostKg} kg
                </div>
                <div className="text-xs text-text-muted">since you started tracking</div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-text-muted">
            No body fat % logged yet. If your gym scale reads it, add it next time you{" "}
            <Link href="/weight" className="text-accent">
              log your weight
            </Link>
            .
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-1.5 text-text-muted">
          <Timer size={14} />
          <CardLabel>This Week at the Gym</CardLabel>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold">{gymStats.sessionCount}</div>
            <div className="text-[11px] text-text-muted">sessions</div>
          </div>
          <div>
            <div className="text-lg font-bold">
              {Math.floor(gymStats.totalMinutes / 60)}h {gymStats.totalMinutes % 60}m
            </div>
            <div className="text-[11px] text-text-muted">total time</div>
          </div>
          <div>
            <div className="text-lg font-bold">{gymStats.estimatedCalories || "—"}</div>
            <div className="text-[11px] text-text-muted">calories (est.)</div>
          </div>
        </div>
      </Card>

      <p className="px-0.5 text-xs text-text-muted">
        BMI and calorie figures are rough estimates for reference, not medical measurements — they don&apos;t account for muscle mass,
        body composition, or workout intensity.
      </p>

      <div className="flex flex-col gap-2">
        <Link href="/weight">
          <Card className="flex items-center justify-between active:brightness-95">
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-text-muted" />
              <span className="font-medium">Body Weight</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
        <Link href="/progress/measurements">
          <Card className="flex items-center justify-between active:brightness-95">
            <div className="flex items-center gap-2">
              <Ruler size={16} className="text-text-muted" />
              <span className="font-medium">Body Measurements</span>
            </div>
            <ChevronRight size={16} className="text-text-faint" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
