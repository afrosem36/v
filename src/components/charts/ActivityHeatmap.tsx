"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import type { HeatmapDay } from "@/lib/db/repo/analytics";

/**
 * A year of training at a glance. Columns are weeks (Monday at the top), shaded by how long
 * that day's session ran — the gaps are the point as much as the streaks are.
 */
export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  const { weeks, monthLabels, trainedDays } = useMemo(() => {
    if (days.length === 0) return { weeks: [] as (HeatmapDay | null)[][], monthLabels: [] as { index: number; label: string }[], trainedDays: 0 };

    // Pad the front so the first column starts on a Monday.
    const firstDow = parseISO(days[0].date).getDay();
    const leading = (firstDow + 6) % 7;
    const padded: (HeatmapDay | null)[] = [...Array<null>(leading).fill(null), ...days];

    const weeks: (HeatmapDay | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    const monthLabels: { index: number; label: string }[] = [];
    let lastMonth = "";
    weeks.forEach((week, index) => {
      const firstReal = week.find((d): d is HeatmapDay => d !== null);
      if (!firstReal) return;
      const month = format(parseISO(firstReal.date), "MMM");
      if (month !== lastMonth) {
        monthLabels.push({ index, label: month });
        lastMonth = month;
      }
    });

    return { weeks, monthLabels, trainedDays: days.filter((d) => d.minutes > 0 || d.sets > 0).length };
  }, [days]);

  function shade(day: HeatmapDay | null): string {
    if (!day) return "bg-transparent";
    if (day.minutes === 0 && day.sets === 0) return "bg-surface-2";
    if (day.minutes >= 75) return "bg-accent";
    if (day.minutes >= 45) return "bg-accent/70";
    if (day.minutes >= 20) return "bg-accent/45";
    return "bg-accent/25";
  }

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-block min-w-full">
          <div className="flex gap-[3px] pl-6 text-[9px] text-text-faint">
            {weeks.map((_, i) => {
              const label = monthLabels.find((m) => m.index === i);
              return (
                <div key={i} className="w-[10px] shrink-0">
                  {label?.label ?? ""}
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex gap-[3px]">
            <div className="flex w-5 shrink-0 flex-col gap-[3px] text-[9px] leading-[10px] text-text-faint">
              {["M", "", "W", "", "F", "", "S"].map((label, i) => (
                <div key={i} className="h-[10px]">
                  {label}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex shrink-0 flex-col gap-[3px]">
                {Array.from({ length: 7 }, (_, di) => {
                  const day = week[di] ?? null;
                  return (
                    <div
                      key={di}
                      className={`h-[10px] w-[10px] rounded-[2px] ${shade(day)}`}
                      title={day ? `${day.date}: ${day.minutes > 0 ? `${day.minutes} min, ` : ""}${day.sets} sets` : ""}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
        <span>{trainedDays} training days in the last year</span>
        <span className="flex items-center gap-1">
          Less
          <span className="h-[10px] w-[10px] rounded-[2px] bg-surface-2" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-accent/45" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-accent/70" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-accent" />
          More
        </span>
      </div>
    </div>
  );
}
