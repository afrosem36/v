"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, LogOut, UserRound, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useAuth } from "@/lib/auth/AuthProvider";
import { deleteAccountEverywhere } from "@/lib/auth/accounts";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import { GOALS } from "@/lib/coach/goals";
import { getSettings, updateSettings } from "@/lib/db/repo/settings";
import { getLatestBodyWeight, upsertBodyWeight } from "@/lib/db/repo/body";
import { getWorkoutCounts, getWeeklyGymStats } from "@/lib/db/repo/analytics";
import { getCompletedSessions } from "@/lib/db/repo/workouts";
import { computeBMI, bmiCategory } from "@/lib/engine/body-metrics";
import { kgToDisplay, displayToKg, formatDuration } from "@/lib/utils/format";
import { todayStr, formatShortDate } from "@/lib/utils/date";
import type { Gender } from "@/types/domain";
import type { TrainingGoal } from "@/types/domain";

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-base outline-none placeholder:text-text-faint focus:border-accent";

const GENDER_OPTIONS = (["male", "female", "other"] as Gender[]).map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) }));

export default function ProfilePage() {
  const router = useRouter();
  const { user, db, signOut } = useAuth();

  const data = useLiveQuery(async () => {
    const [settings, weight, counts, completed] = await Promise.all([
      getSettings(),
      getLatestBodyWeight(),
      getWorkoutCounts(),
      getCompletedSessions(500),
    ]);
    const weekStats = await getWeeklyGymStats(weight?.weightKg ?? null);
    return { settings, weight, counts, totalWorkouts: completed.length, firstWorkout: completed[completed.length - 1], weekStats };
  }, []);

  const [name, setName] = useState(user.name);
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [gender, setGender] = useState<Gender>(user.gender);
  const [goal, setGoal] = useState<TrainingGoal | null>(user.goal);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const { settings, weight, counts, totalWorkouts, firstWorkout, weekStats } = data;
  const bmi = weight && settings.heightCm ? computeBMI(weight.weightKg, settings.heightCm) : null;

  async function handleSaveProfile() {
    await updateSettings({
      name: name.trim() || user.name,
      dateOfBirth: dateOfBirth || null,
      phone: phone.trim() || null,
      gender,
      goal,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleDeleteAccount() {
    if (!confirm(`Delete every workout logged on this device? This cannot be undone.`)) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      const result = await deleteAccountEverywhere(db, user.knownAccountId);
      if (!result.ok) {
        setDeleteError(result.error ?? "Something went wrong.");
        return;
      }
      window.location.reload();
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <UserRound size={22} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tracking-tight">{user.name}</div>
          <div className="truncate text-sm text-text-muted">{user.email}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <CardLabel>Workouts</CardLabel>
          <div className="mt-1 text-lg font-bold">{totalWorkouts}</div>
          <div className="text-[11px] text-text-faint">{counts.thisMonth} this month</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Gym time</CardLabel>
          <div className="mt-1 text-lg font-bold">{formatDuration(weekStats.totalMinutes)}</div>
          <div className="text-[11px] text-text-faint">this week</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Weight</CardLabel>
          <div className="mt-1 text-lg font-bold">{weight ? `${kgToDisplay(weight.weightKg, settings.units)} ${settings.units}` : "—"}</div>
          <div className="text-[11px] text-text-faint">{bmi ? `BMI ${bmi} · ${bmiCategory(bmi)}` : "add height for BMI"}</div>
        </Card>
        <Card className="text-center">
          <CardLabel>Training since</CardLabel>
          <div className="mt-1 text-lg font-bold">{firstWorkout ? formatShortDate(firstWorkout.startedAt) : "—"}</div>
          <div className="text-[11px] text-text-faint">first logged workout</div>
        </Card>
      </div>

      <Link href="/coach?mode=update">
        <Card className="border-accent/40 bg-accent/10 active:brightness-95">
          <div className="flex items-center gap-3">
            <RefreshCw size={18} className="shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="font-semibold">Update my workout plan</div>
              <div className="mt-0.5 text-xs text-text-muted">
                Builds a ChatGPT prompt containing every lift and weight you&apos;ve logged, what&apos;s stalled, your weight trend and
                your height — so the next 6 months are written from your actual numbers.
              </div>
            </div>
            <ChevronRight size={16} className="ml-auto shrink-0 text-text-faint" />
          </div>
        </Card>
      </Link>

      <Card>
        <CardLabel>Your details</CardLabel>
        <div className="mt-3 flex flex-col gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-muted">Date of birth</span>
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-muted">Phone</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </label>
          <div>
            <span className="mb-1.5 block text-xs text-text-muted">Gender</span>
            <SegmentedControl options={GENDER_OPTIONS} value={gender} onChange={setGender} size="md" />
          </div>
          <Button fullWidth onClick={handleSaveProfile}>
            {saved ? "Saved" : "Save details"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardLabel>Body</CardLabel>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Height</div>
            <NumberStepper
              value={settings.heightCm ?? 170}
              onChange={(v) => updateSettings({ heightCm: Math.round(v) })}
              step={1}
              min={100}
              max={250}
              decimals={0}
              suffix="cm"
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Current weight</div>
            <NumberStepper
              value={weight ? kgToDisplay(weight.weightKg, settings.units) : 70}
              onChange={(v) => upsertBodyWeight(todayStr(), displayToKg(v, settings.units), null)}
              step={0.1}
              min={20}
              max={400}
              decimals={1}
              suffix={settings.units}
              size="md"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Goal weight</div>
            <NumberStepper
              value={settings.goalWeightKg != null ? kgToDisplay(settings.goalWeightKg, settings.units) : 70}
              onChange={(v) => updateSettings({ goalWeightKg: displayToKg(v, settings.units) })}
              step={0.5}
              min={20}
              max={400}
              decimals={1}
              suffix={settings.units}
              size="md"
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Training goal</CardLabel>
        <div className="mt-2 flex flex-col gap-2">
          {GOALS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGoal(g.key)}
              className={`rounded-xl border px-3 py-2.5 text-left ${goal === g.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}
            >
              <span className="block text-sm font-medium">{g.label}</span>
              <span className="block text-xs text-text-muted">{g.blurb}</span>
            </button>
          ))}
        </div>
        <Button fullWidth variant="secondary" className="mt-3" onClick={handleSaveProfile}>
          Save goal
        </Button>
      </Card>

      <Button variant="secondary" fullWidth onClick={signOut}>
        <LogOut size={16} />
        Sign out
      </Button>

      <Card className="border-danger/30">
        <CardLabel>Danger Zone</CardLabel>
        <p className="mt-1 text-xs text-text-muted">
          Permanently removes every workout logged on this device
          {SUPABASE_CONFIGURED ? " and signs you out. You can sign back in with the same Google account." : "."}
        </p>

        {!confirmingDelete ? (
          <Button variant="danger" fullWidth className="mt-3" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={16} />
            Delete account
          </Button>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {deleteError && <div className="text-xs text-danger">{deleteError}</div>}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" fullWidth disabled={deleteBusy} onClick={handleDeleteAccount}>
                {deleteBusy ? "Deleting…" : "Confirm delete"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
