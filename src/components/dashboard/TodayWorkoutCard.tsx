"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CalendarSync, Dumbbell } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChooseWorkoutSheet } from "@/components/workout/ChooseWorkoutSheet";
import { startWorkoutForDay } from "@/lib/db/repo/workouts";
import { formatDuration } from "@/lib/utils/format";
import type { WorkoutDay } from "@/types/domain";

const TIME_BUDGETS = [20, 30, 45, 60];

interface TodayWorkoutCardProps {
  today: WorkoutDay | undefined;
  estimatedMinutes: number;
  /** True when today's routine came from a one-off reschedule rather than the weekly plan. */
  rescheduled?: boolean;
}

export function TodayWorkoutCard({ today, estimatedMinutes, rescheduled }: TodayWorkoutCardProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  async function handleStart(budgetMinutes: number | null) {
    if (!today || starting) return;
    setStarting(true);
    try {
      const session = await startWorkoutForDay(today, { timeBudgetMinutes: budgetMinutes, pinToToday: false });
      router.push(`/workout/active?session=${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  if (!today || today.isRestDay) {
    return (
      <>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Today</div>
          <div className="mt-1 text-xl font-bold">Rest &amp; Recovery</div>
          <p className="mt-2 text-sm text-text-muted">
            No scheduled training today. Recovery is part of the program — light walking is fine if you want to move.
          </p>
          <Button variant="secondary" fullWidth className="mt-3" onClick={() => setChooseOpen(true)}>
            <Dumbbell size={16} />
            Train something anyway
          </Button>
        </Card>
        <ChooseWorkoutSheet open={chooseOpen} onClose={() => setChooseOpen(false)} todayDayId={today?.id ?? null} />
      </>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Today</div>
        {rescheduled && <div className="text-[11px] font-medium text-accent">Rescheduled</div>}
      </div>
      <div className="mt-1 text-xl font-bold">{today.label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
        <Clock size={14} />
        Estimated {formatDuration(estimatedMinutes)}
      </div>

      <Button className="mt-4" fullWidth size="lg" disabled={starting} onClick={() => handleStart(null)}>
        Start Workout
      </Button>

      <div className="mt-2 flex items-center justify-between">
        <button className="text-sm font-medium text-text-muted active:text-text" onClick={() => setSheetOpen(true)}>
          Short on time?
        </button>
        <button className="flex items-center gap-1.5 text-sm font-medium text-text-muted active:text-text" onClick={() => setChooseOpen(true)}>
          <CalendarSync size={14} />
          Do another day
        </button>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Short Workout">
        <p className="pb-3 text-sm text-text-muted">
          We&apos;ll prioritize the most important exercises and drop optional ones to fit your time.
        </p>
        <div className="grid grid-cols-2 gap-3 pb-4">
          {TIME_BUDGETS.map((m) => (
            <button
              key={m}
              disabled={starting}
              onClick={() => handleStart(m)}
              className="h-16 rounded-xl border border-border bg-surface-2 text-lg font-bold active:brightness-90"
            >
              {m} min
            </button>
          ))}
        </div>
      </BottomSheet>

      <ChooseWorkoutSheet open={chooseOpen} onClose={() => setChooseOpen(false)} todayDayId={today.id} />
    </Card>
  );
}
