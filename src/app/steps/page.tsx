"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Pencil } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { upsertDailySteps, getStepsInRange, averageSteps, getStepsForDate } from "@/lib/db/repo/body";
import { getSettings } from "@/lib/db/repo/settings";
import { todayStr, formatShortDate } from "@/lib/utils/date";
import { format, subDays } from "date-fns";

function useStepsData() {
  return useLiveQuery(async () => {
    const today = todayStr();
    const settings = await getSettings();
    const start30 = format(subDays(new Date(), 29), "yyyy-MM-dd");
    const range = await getStepsInRange(start30, today);
    const last7 = range.filter((r) => r.date >= format(subDays(new Date(), 6), "yyyy-MM-dd"));
    const todayEntry = await getStepsForDate(today);

    const days: { date: string; steps: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      const found = range.find((r) => r.date === d);
      days.push({ date: d, steps: found?.steps ?? 0 });
    }

    return {
      stepGoal: settings.stepGoal,
      todaySteps: todayEntry?.steps ?? 0,
      avg7: averageSteps(last7),
      avg30: averageSteps(range),
      days,
    };
  }, []);
}

export default function StepsPage() {
  const router = useRouter();
  const data = useStepsData();
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(0);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  async function saveToday(value: number) {
    await upsertDailySteps(todayStr(), value);
  }

  function openEdit(date: string, steps: number) {
    setEditDate(date);
    setEditValue(steps);
  }

  async function saveEdit() {
    if (!editDate) return;
    await upsertDailySteps(editDate, editValue);
    setEditDate(null);
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))]">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="text-2xl font-bold tracking-tight">Steps</div>

      <Card>
        <CardLabel>Today</CardLabel>
        <div className="mt-2">
          <NumberStepper
            value={data.todaySteps}
            onChange={saveToday}
            step={500}
            max={200_000}
            decimals={0}
            quickSteps={[1000, 2000, 5000]}
          />
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-text-muted">
            <span>{data.todaySteps.toLocaleString()}</span>
            <span>Goal {data.stepGoal.toLocaleString()}</span>
          </div>
          <ProgressBar value={data.todaySteps} max={data.stepGoal} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <CardLabel>7-day avg</CardLabel>
          <div className="mt-1 text-lg font-bold">{data.avg7.toLocaleString()}</div>
        </Card>
        <Card className="text-center">
          <CardLabel>30-day avg</CardLabel>
          <div className="mt-1 text-lg font-bold">{data.avg30.toLocaleString()}</div>
        </Card>
      </div>

      <div>
        <CardLabel>Recent Days</CardLabel>
        <div className="mt-2 flex flex-col gap-1.5">
          {data.days.map((d) => (
            <button
              key={d.date}
              onClick={() => openEdit(d.date, d.steps)}
              className="flex items-center justify-between rounded-xl bg-surface px-4 py-2.5 text-sm active:brightness-95"
            >
              <span className="text-text-muted">{formatShortDate(d.date)}</span>
              <span className="flex items-center gap-2 font-medium">
                {d.steps > 0 ? d.steps.toLocaleString() : "—"}
                <Pencil size={13} className="text-text-faint" />
              </span>
            </button>
          ))}
        </div>
      </div>

      <BottomSheet open={editDate != null} onClose={() => setEditDate(null)} title={editDate ? formatShortDate(editDate) : ""}>
        <div className="pb-4">
          <NumberStepper value={editValue} onChange={setEditValue} step={500} max={200_000} decimals={0} quickSteps={[1000, 2000, 5000]} />
          <Button fullWidth size="lg" className="mt-4" onClick={saveEdit}>
            Save
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
