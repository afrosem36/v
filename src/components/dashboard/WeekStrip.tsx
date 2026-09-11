"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { addDays, startOfWeek } from "date-fns";
import { getAllWorkoutDays, getCompletedSessions, getScheduleOverridesInRange } from "@/lib/db/repo/workouts";
import { dateStr, todayStr, DOW_SHORT } from "@/lib/utils/date";
import type { DayOfWeek } from "@/types/domain";

/** Monday-to-Sunday glance: what's planned, what's done, where today sits. */
export function WeekStrip() {
  const week = useLiveQuery(async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const start = dateStr(weekStart);
    const end = dateStr(addDays(weekStart, 6));

    const [days, completed, overrides] = await Promise.all([
      getAllWorkoutDays(),
      getCompletedSessions(80),
      getScheduleOverridesInRange(start, end),
    ]);
    const doneDates = new Set(completed.map((s) => s.startedAt.slice(0, 10)));
    const overrideByDate = new Map(overrides.map((o) => [o.date, o]));

    return Array.from({ length: 7 }, (_, i) => {
      const date = dateStr(addDays(weekStart, i));
      const override = overrideByDate.get(date);
      const dow = ((i + 1) % 7) as DayOfWeek;
      const planned = override ? days.find((d) => d.id === override.workoutDayId) : days.find((d) => d.dayOfWeek === dow);
      return {
        date,
        dow,
        label: planned?.label ?? null,
        isRest: override ? override.workoutDayId == null : (planned?.isRestDay ?? true),
        done: doneDates.has(date),
        isToday: date === todayStr(),
        isPast: date < todayStr(),
      };
    });
  }, []);

  if (!week) return null;

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {week.map((d) => (
        <Link
          key={d.date}
          href="/plan"
          className={clsx(
            "flex flex-col items-center gap-1.5 rounded-xl border py-2 transition-colors",
            d.isToday ? "border-accent/60 bg-accent/10" : "border-border bg-surface"
          )}
        >
          <span className={clsx("text-[10px] font-semibold uppercase", d.isToday ? "text-accent" : "text-text-faint")}>
            {DOW_SHORT[d.dow]}
          </span>
          <span
            className={clsx(
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
              d.done
                ? "bg-success text-bg"
                : d.isRest
                  ? "bg-surface-2 text-text-faint"
                  : d.isPast
                    ? "border border-danger/40 text-danger/70"
                    : "border border-border text-text-muted"
            )}
            aria-label={d.done ? "Completed" : d.isRest ? "Rest" : "Planned"}
          >
            {d.done ? "✓" : d.isRest ? "·" : "!"}
          </span>
        </Link>
      ))}
    </div>
  );
}
