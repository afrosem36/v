"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarClock, Check, Clock } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  getActiveSession,
  getAllWorkoutDays,
  getSessionSets,
  startWorkoutForDay,
  abandonSession,
  completeSession,
} from "@/lib/db/repo/workouts";
import { DOW_SHORT } from "@/lib/utils/date";
import type { WorkoutDay } from "@/types/domain";

const TIME_BUDGETS = [20, 30, 45, 60];

interface ChooseWorkoutSheetProps {
  open: boolean;
  onClose: () => void;
  /** Highlighted as "scheduled today" in the list. */
  todayDayId?: string | null;
}

/**
 * Lets the user train *any* routine today, not just the one the weekly plan puts on this
 * weekday. Skipping Tuesday and wanting to do Wednesday's session — or catching Tuesday's up on
 * Wednesday — is the normal case, not an edge case.
 */
export function ChooseWorkoutSheet({ open, onClose, todayDayId }: ChooseWorkoutSheetProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<WorkoutDay | null>(null);
  const [starting, setStarting] = useState(false);

  const data = useLiveQuery(async () => {
    if (!open) return undefined;
    const [days, active] = await Promise.all([getAllWorkoutDays(), getActiveSession()]);
    const activeSetCount = active ? (await getSessionSets(active.id)).length : 0;
    return { days, active, activeSetCount };
  }, [open]);

  async function start(day: WorkoutDay, budget: number | null) {
    if (starting) return;

    const active = data?.active;
    if (active) {
      const keep = confirm(
        `"${active.label}" is still open with ${data?.activeSetCount ?? 0} set(s) logged.\n\n` +
          `OK — finish that one first and go to it.\nCancel — put it away and start "${day.label}" instead.`
      );
      if (keep) {
        onClose();
        router.push(`/workout/active?session=${active.id}`);
        return;
      }
      // Their call: keep the work if any was logged, otherwise drop the empty session.
      if ((data?.activeSetCount ?? 0) > 0) await completeSession(active.id);
      else await abandonSession(active.id);
    }

    setStarting(true);
    try {
      const session = await startWorkoutForDay(day, { timeBudgetMinutes: budget });
      onClose();
      router.push(`/workout/active?session=${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={selected ? selected.label : "Choose a workout"}>
      {!selected && (
        <div className="flex flex-col gap-2 pb-4">
          <p className="text-sm text-text-muted">
            Train whichever session you want today — missing a day never locks you out of the rest of the week.
          </p>
          {data?.days.map((day) => (
            <button
              key={day.id}
              onClick={() => setSelected(day)}
              className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 text-left active:brightness-90"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 text-xs font-semibold uppercase text-text-faint">{DOW_SHORT[day.dayOfWeek]}</span>
                <div>
                  <div className="font-medium">{day.label}</div>
                  {day.isRestDay && <div className="text-[11px] text-text-faint">Rest day in your plan</div>}
                </div>
              </div>
              {day.id === todayDayId && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
                  <Check size={12} /> Today
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3 pb-4">
          <button onClick={() => setSelected(null)} className="self-start text-xs font-medium text-text-muted">
            ← Pick a different day
          </button>

          <Button size="lg" fullWidth disabled={starting} onClick={() => start(selected, null)}>
            <CalendarClock size={16} />
            Start full session
          </Button>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
              <Clock size={13} />
              Short on time? We keep the priority lifts and drop the optional ones.
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TIME_BUDGETS.map((m) => (
                <button
                  key={m}
                  disabled={starting}
                  onClick={() => start(selected, m)}
                  className="h-12 rounded-xl border border-border bg-surface-2 text-sm font-semibold active:brightness-90 disabled:opacity-40"
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
