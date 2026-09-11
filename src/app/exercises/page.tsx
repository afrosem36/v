"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Search, SlidersHorizontal, Info } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/Card";
import { ExerciseInfoSheet } from "@/components/workout/ExerciseInfoSheet";
import { getAllExercises, getAvailableEquipmentKeys, isExerciseAvailable } from "@/lib/db/repo/exercises";
import { getStrengthProfile } from "@/lib/db/repo/analytics";
import { muscleLabel } from "@/components/charts/MuscleMap";
import type { Exercise, MuscleGroupKey } from "@/types/domain";

type Filter = "all" | "available" | "trained";

export default function ExerciseLibraryPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("available");
  const [muscle, setMuscle] = useState<MuscleGroupKey | "all">("all");
  const [info, setInfo] = useState<Exercise | null>(null);

  const data = useLiveQuery(async () => {
    const [exercises, available, strength] = await Promise.all([
      getAllExercises(),
      getAvailableEquipmentKeys(),
      getStrengthProfile(),
    ]);
    return {
      exercises,
      available,
      bestByExercise: new Map(strength.map((s) => [s.exerciseId, s])),
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.exercises.filter((e) => {
      if (muscle !== "all" && e.primaryMuscle !== muscle) return false;
      if (filter === "available" && !isExerciseAvailable(e, data.available)) return false;
      if (filter === "trained" && !data.bestByExercise.has(e.id)) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.primaryMuscle.includes(q)) return false;
      return true;
    });
  }, [data, query, filter, muscle]);

  if (!data) return <div className="p-5 pt-[calc(1.5rem+var(--safe-top))] text-sm text-text-muted">Loading…</div>;

  const muscles = [...new Set(data.exercises.map((e) => e.primaryMuscle))].sort((a, b) => muscleLabel(a).localeCompare(muscleLabel(b)));

  const grouped = new Map<MuscleGroupKey, Exercise[]>();
  for (const exercise of filtered) {
    const bucket = grouped.get(exercise.primaryMuscle) ?? [];
    bucket.push(exercise);
    grouped.set(exercise.primaryMuscle, bucket);
  }

  return (
    <div className="flex flex-col gap-4 p-5 pt-[calc(1.5rem+var(--safe-top))] pb-10">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-text-muted">
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="text-2xl font-bold tracking-tight">Exercise Library</div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          className="h-12 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-4 text-base outline-none placeholder:text-text-faint focus:border-accent"
        />
      </div>

      <div className="flex items-center gap-2">
        <SlidersHorizontal size={14} className="shrink-0 text-text-faint" />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
          {(
            [
              { key: "available", label: "My gym" },
              { key: "all", label: "Everything" },
              { key: "trained", label: "Trained" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                filter === f.key ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          onClick={() => setMuscle("all")}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
            muscle === "all" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
          }`}
        >
          All muscles
        </button>
        {muscles.map((m) => (
          <button
            key={m}
            onClick={() => setMuscle(m)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
              muscle === m ? "bg-accent text-accent-foreground" : "bg-surface-2 text-text-muted"
            }`}
          >
            {muscleLabel(m)}
          </button>
        ))}
      </div>

      <div className="text-xs text-text-muted">
        {filtered.length} {filtered.length === 1 ? "exercise" : "exercises"}
        {filter === "available" && " your gym can do"}
      </div>

      {[...grouped.entries()].map(([group, exercises]) => (
        <div key={group}>
          <CardLabel>{muscleLabel(group)}</CardLabel>
          <div className="mt-2 flex flex-col gap-2">
            {exercises.map((exercise) => {
              const best = data.bestByExercise.get(exercise.id);
              return (
                <Card key={exercise.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {exercise.name}
                      {exercise.isCustom && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent">custom</span>}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {exercise.isCompound ? "Compound" : "Isolation"} · {exercise.repRangeMin}-{exercise.repRangeMax} {exercise.repUnit}
                      {!isExerciseAvailable(exercise, data.available) && " · needs equipment you don't have"}
                    </div>
                    {best && (
                      <div className="mt-0.5 text-[11px] text-text-faint">
                        Best {best.bestWeightKg}kg × {best.bestReps} · est. 1RM {best.estimated1RM}kg
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setInfo(exercise)}
                    aria-label={`How to do ${exercise.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 active:brightness-90"
                  >
                    <Info size={16} />
                  </button>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      <ExerciseInfoSheet exercise={info} onClose={() => setInfo(null)} />
    </div>
  );
}
