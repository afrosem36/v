"use client";

import Link from "next/link";
import { Sparkles, ChevronRight, Timer, Flame, MessageCircle } from "lucide-react";
import { useHomeData } from "@/lib/hooks/useHomeData";
import { useAuth } from "@/lib/auth/AuthProvider";
import { greeting, formatDuration } from "@/lib/utils/format";
import { Card, CardLabel } from "@/components/ui/Card";
import { ActiveSessionBanner } from "@/components/dashboard/ActiveSessionBanner";
import { ReturnPromptBanner } from "@/components/dashboard/ReturnPromptBanner";
import { TodayWorkoutCard } from "@/components/dashboard/TodayWorkoutCard";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { WeekStrip } from "@/components/dashboard/WeekStrip";

export default function HomePage() {
  const data = useHomeData();
  const { user } = useAuth();

  if (!data) {
    return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;
  }

  const {
    today,
    rescheduled,
    estimatedMinutes,
    activeSession,
    activeSetCount,
    settings,
    steps,
    latestWeight,
    streak,
    recentPR,
    returnPrompt,
    weekStats,
    counts,
  } = data;

  const firstName = user.name.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))]">
      <div>
        <div className="text-2xl font-bold tracking-tight">
          {greeting()}, {firstName}
        </div>
        <div className="mt-0.5 text-sm text-text-muted">
          {counts.thisWeek} {counts.thisWeek === 1 ? "workout" : "workouts"} this week
          {weekStats.totalMinutes > 0 && ` · ${formatDuration(weekStats.totalMinutes)} in the gym`}
        </div>
      </div>

      <WeekStrip />

      <Link href="/partner">
        <Card className="flex items-center gap-3 border-accent/40 bg-accent/10 active:brightness-95">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <MessageCircle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Talk to your training partner</div>
            <div className="text-xs text-text-muted">Knows your data — ask it anything, or just say hi</div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-text-faint" />
        </Card>
      </Link>

      {activeSession && <ActiveSessionBanner session={activeSession} setCount={activeSetCount} />}
      {!activeSession && <ReturnPromptBanner prompt={returnPrompt} />}
      {!activeSession && <TodayWorkoutCard today={today} estimatedMinutes={estimatedMinutes} rescheduled={rescheduled} />}

      <QuickStats
        stepsToday={steps?.steps ?? 0}
        stepGoal={settings.stepGoal}
        streak={streak}
        recentPR={recentPR}
        latestWeightKg={latestWeight?.weightKg ?? null}
        unit={settings.units}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center gap-2 text-text-muted">
            <Timer size={16} />
            <CardLabel>Gym time</CardLabel>
          </div>
          <div className="mt-2 text-xl font-bold tabular-nums">{formatDuration(weekStats.totalMinutes)}</div>
          <div className="text-xs text-text-muted">this week</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-text-muted">
            <Flame size={16} />
            <CardLabel>Calories</CardLabel>
          </div>
          <div className="mt-2 text-xl font-bold tabular-nums">
            {weekStats.estimatedCalories > 0 ? weekStats.estimatedCalories.toLocaleString() : "—"}
          </div>
          <div className="text-xs text-text-muted">est. from training</div>
        </Card>
      </div>

      <Link href="/coach">
        <Card className="flex items-center justify-between border-accent/40 bg-accent/10 active:brightness-95">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-accent" />
            <div>
              <div className="font-semibold">Build my plan with ChatGPT</div>
              <div className="text-xs text-text-muted">A 6-month program shaped around your goal</div>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-faint" />
        </Card>
      </Link>
    </div>
  );
}
