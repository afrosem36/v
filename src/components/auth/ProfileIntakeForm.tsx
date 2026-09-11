"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { updateSettings } from "@/lib/db/repo/settings";
import { upsertBodyWeight } from "@/lib/db/repo/body";
import { todayStr } from "@/lib/utils/date";
import { GOALS } from "@/lib/coach/goals";
import type { Gender, TrainingGoal } from "@/types/domain";

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-base outline-none placeholder:text-text-faint focus:border-accent";

/**
 * Runs once, right after a person's first successful sign-in: the details the old
 * password-based sign-up form used to collect, now saved straight to the synced `appSettings`
 * row instead of a local-only account table. Nothing here needs to be re-shown once
 * `settings.name` is non-empty — the parent live-query in AuthProvider stops rendering this the
 * moment that write lands.
 */
export function ProfileIntakeForm() {
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender>("unspecified");
  const [phone, setPhone] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await updateSettings({
        name: name.trim(),
        dateOfBirth: dateOfBirth || null,
        gender,
        phone: phone.trim() || null,
        goal,
        heightCm: heightCm ? Number(heightCm) : null,
      });
      if (weightKg) await upsertBodyWeight(todayStr(), Number(weightKg), null);
      // No further action needed — AuthProvider's live query re-renders past this form
      // automatically once settings.name is non-empty.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10 pt-[calc(3rem+var(--safe-top))]">
      <h1 className="text-2xl font-bold tracking-tight">Tell us about you</h1>
      <p className="mt-1 text-sm text-text-muted">One-time setup — this travels with your account to any other device you sign into.</p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-muted">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" className={inputClass} />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-muted">Date of birth</span>
          <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-text-muted">Gender</span>
          <p className="mb-1.5 text-[11px] text-text-faint">Only used to make calorie and body-composition estimates a bit less wrong.</p>
          <div className="grid grid-cols-3 gap-2">
            {(["male", "female", "other"] as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`h-11 rounded-xl border text-sm font-medium capitalize ${
                  gender === g ? "border-accent bg-accent/10 text-text" : "border-border bg-surface-2 text-text-muted"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">Height (cm)</span>
            <input
              type="number"
              inputMode="numeric"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="175"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">Weight (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="72"
              className={inputClass}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-muted">Phone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" autoComplete="tel" className={inputClass} />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-text-muted">What are you training for?</span>
          <div className="flex flex-col gap-2">
            {GOALS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGoal(g.key)}
                className={`rounded-xl border px-3 py-2.5 text-left ${goal === g.key ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}
              >
                <span className="block text-sm font-medium">{g.label}</span>
                <span className="block text-xs text-text-muted">{g.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" size="lg" fullWidth disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
