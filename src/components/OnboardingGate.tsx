"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles, LogOut } from "lucide-react";
import { CoachPlanFlow } from "@/components/coach/CoachPlanFlow";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSettings, updateSettings } from "@/lib/db/repo/settings";
import { getCompletedSessions } from "@/lib/db/repo/workouts";

/**
 * A new account has no program until ChatGPT writes one, so the app stays behind this until a
 * plan has been imported and applied. Accounts that already have logged training keep their
 * existing program and are marked complete on the spot — this gate is for new sign-ups, not a
 * wall in front of someone's own history.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();

  // Read-only: Dexie runs a live query inside a readonly transaction, so writing from in here
  // throws ReadOnlyError. The backfill write happens in the effect below instead.
  const state = useLiveQuery(async () => {
    const settings = await getSettings();
    if (settings.onboardingCompletedAt) return { needsOnboarding: false, shouldBackfill: false };

    const completed = await getCompletedSessions(1);
    // Pre-existing training data means this account is already up and running.
    return { needsOnboarding: completed.length === 0, shouldBackfill: completed.length > 0 };
  }, []);

  const shouldBackfill = state?.shouldBackfill ?? false;
  useEffect(() => {
    if (shouldBackfill) updateSettings({ onboardingCompletedAt: new Date().toISOString() });
  }, [shouldBackfill]);

  if (!state) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <div className="text-sm font-medium tracking-wide text-text-muted">Loading…</div>
      </div>
    );
  }

  if (!state.needsOnboarding) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-5 pb-12 pt-[calc(2rem+var(--safe-top))]">
      <div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Sparkles size={22} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Let&apos;s build your program, {user.name.trim().split(/\s+/)[0]}</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Vshape doesn&apos;t hand you a generic routine. Answer a few questions, send the prompt to ChatGPT with a photo if you want
          one, and paste the plan back here. Your app checks it, fixes what needs fixing, and builds your training week from it.
        </p>
      </div>

      <CoachPlanFlow
        mode="new"
        onboarding
        onApplied={async () => {
          await updateSettings({ onboardingCompletedAt: new Date().toISOString() });
        }}
      />

      <button onClick={signOut} className="mt-2 flex items-center justify-center gap-1.5 text-sm font-medium text-text-faint active:text-text">
        <LogOut size={14} />
        Sign out
      </button>
    </div>
  );
}
