import { goalByKey } from "./goals";
import type { CoachBlock, CoachExercise, CoachPlanBundle, CoachRoutine } from "./contract";
import { estimateWorkoutMinutes } from "@/lib/engine/time-estimate";
import type { Exercise, MuscleGroupKey } from "@/types/domain";

/**
 * Evidence-based weekly working-set ranges per muscle. Deliberately wide: the point is to catch
 * a plan that gives shoulders 2 sets or chest 34, not to nudge someone from 14 to 15.
 */
const VOLUME_RANGE: Record<MuscleGroupKey, { min: number; max: number }> = {
  chest: { min: 8, max: 22 },
  upper_chest: { min: 4, max: 16 },
  lats: { min: 8, max: 24 },
  traps: { min: 3, max: 16 },
  rear_delts: { min: 4, max: 20 },
  lateral_delts: { min: 6, max: 26 },
  front_delts: { min: 2, max: 14 },
  biceps: { min: 5, max: 20 },
  triceps: { min: 5, max: 20 },
  forearms: { min: 0, max: 12 },
  quads: { min: 6, max: 20 },
  hamstrings: { min: 5, max: 18 },
  glutes: { min: 4, max: 18 },
  calves: { min: 4, max: 18 },
  core: { min: 3, max: 20 },
  full_body: { min: 0, max: 40 },
};

/** Priority muscles for the chosen goal have to clear this, not just the generic minimum. */
const PRIORITY_MIN_SETS = 10;

export interface ImprovementReport {
  bundle: CoachPlanBundle;
  improvements: string[];
  warnings: string[];
  /** Weekly set count per muscle for the first block, for the review screen. */
  weeklyVolume: { muscle: MuscleGroupKey; sets: number; status: "low" | "ok" | "high" }[];
}

interface ImproveContext {
  library: Exercise[];
  sessionMinutes: number;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Matches whatever ChatGPT wrote against the real library: exact id, then exact name, then a
 * token-overlap score. "Incline DB Press" has to find "Incline Dumbbell Press" or the plan
 * arrives full of holes.
 */
export function resolveLibraryExercise(idOrName: string, name: string | undefined, library: Exercise[]): Exercise | null {
  const byId = library.find((e) => e.id === idOrName);
  if (byId) return byId;

  const candidates = [name, idOrName].filter((v): v is string => !!v);
  for (const candidate of candidates) {
    const target = normalizeName(candidate);
    const exact = library.find((e) => normalizeName(e.name) === target);
    if (exact) return exact;
  }

  let best: { exercise: Exercise; score: number } | null = null;
  for (const candidate of candidates) {
    const tokens = new Set(normalizeName(candidate).split(" ").filter((t) => t.length > 2));
    if (tokens.size === 0) continue;
    for (const exercise of library) {
      const libTokens = normalizeName(exercise.name).split(" ").filter((t) => t.length > 2);
      if (libTokens.length === 0) continue;
      const overlap = libTokens.filter((t) => tokens.has(t)).length;
      const score = overlap / Math.max(tokens.size, libTokens.length);
      if (score > 0.55 && (!best || score > best.score)) best = { exercise, score };
    }
  }

  return best?.exercise ?? null;
}

interface ResolvedExercise extends CoachExercise {
  library: Exercise;
}

/** Drops the resolved library row back off, leaving a plain contract exercise. */
function stripLibrary(resolved: ResolvedExercise): CoachExercise {
  const copy: Partial<ResolvedExercise> = { ...resolved };
  delete copy.library;
  return copy as CoachExercise;
}

function defaultPriority(exercise: Exercise, index: number): number {
  if (exercise.isCompound) return index === 0 ? 1 : 2;
  return index < 3 ? 3 : index < 5 ? 4 : 5;
}

function countWeeklySets(block: CoachBlock, resolvedByRoutine: Map<string, ResolvedExercise[]>): Map<MuscleGroupKey, number> {
  const counts = new Map<MuscleGroupKey, number>();
  const add = (muscle: MuscleGroupKey, sets: number) => counts.set(muscle, (counts.get(muscle) ?? 0) + sets);

  for (const routineId of Object.values(block.week)) {
    for (const ex of resolvedByRoutine.get(routineId) ?? []) {
      add(ex.library.primaryMuscle, ex.sets);
      // Secondary movers get partial credit — they're stimulated, just not the point of the lift.
      for (const secondary of ex.library.secondaryMuscles) add(secondary, ex.sets * 0.5);
    }
  }
  return counts;
}

/**
 * The app's own coaching pass over whatever ChatGPT produced. ChatGPT writes a plausible plan;
 * this is what makes it a plan this app can actually run — every exercise resolved to a real
 * library entry, volume inside sane weekly ranges, compounds first, and sessions that fit the
 * time the user said they have.
 */
export function improveCoachPlan(bundle: CoachPlanBundle, ctx: ImproveContext): ImprovementReport {
  const improvements: string[] = [];
  const warnings: string[] = [];
  const goal = goalByKey(bundle.goal);

  // Custom exercises ChatGPT defined are resolvable too, once they exist in the library.
  const customIds = new Set(bundle.customExercises.map((c) => c.id));

  const blocks: CoachBlock[] = bundle.blocks.map((block, blockIndex) => {
    const resolvedByRoutine = new Map<string, ResolvedExercise[]>();
    const droppedNames: string[] = [];

    const routines: CoachRoutine[] = block.routines.map((routine) => {
      const seen = new Set<string>();
      const resolved: ResolvedExercise[] = [];

      for (const ex of routine.exercises) {
        if (customIds.has(ex.id)) {
          // Custom exercises are created at apply time; carry them through untouched.
          const placeholder = bundle.customExercises.find((c) => c.id === ex.id)!;
          const pseudo: Exercise = {
            id: ex.id,
            name: placeholder.name,
            isCustom: true,
            primaryMuscle: placeholder.primaryMuscle,
            secondaryMuscles: [],
            equipment: placeholder.equipment,
            movementType: "isolation",
            isCompound: false,
            level: "beginner",
            loadType: "bodyweight",
            repUnit: "reps",
            repRangeMin: ex.repsMin,
            repRangeMax: ex.repsMax,
            recommendedSets: ex.sets,
            restSeconds: ex.restSeconds ?? goal.restSecondsIsolation,
            instructions: placeholder.instructions ?? "",
            formCues: [],
            commonMistakes: [],
            alternativeExerciseIds: [],
            createdAt: "",
            updatedAt: "",
          };
          resolved.push({ ...ex, library: pseudo });
          continue;
        }

        const match = resolveLibraryExercise(ex.id, ex.name, ctx.library);
        if (!match) {
          droppedNames.push(ex.name ?? ex.id);
          continue;
        }
        if (seen.has(match.id)) continue; // same lift twice in one session
        seen.add(match.id);
        resolved.push({ ...ex, id: match.id, name: match.name, library: match });
      }

      // Compounds first — the heavy work belongs where you're freshest.
      resolved.sort((a, b) => Number(b.library.isCompound) - Number(a.library.isCompound));

      resolvedByRoutine.set(routine.id, resolved);
      return { ...routine, exercises: resolved.map(stripLibrary) };
    });

    if (droppedNames.length > 0) {
      warnings.push(
        `${block.name}: ${droppedNames.length} exercise(s) had no match in your library and were dropped (${droppedNames.slice(0, 4).join(", ")}${droppedNames.length > 4 ? "…" : ""}).`
      );
    }

    // ---- rest, priority and rep-range defaults ----
    for (const routine of routines) {
      const resolved = resolvedByRoutine.get(routine.id) ?? [];
      routine.exercises.forEach((ex, i) => {
        const lib = resolved[i]?.library;
        if (ex.restSeconds == null) {
          ex.restSeconds = lib?.isCompound ? goal.restSecondsCompound : goal.restSecondsIsolation;
        }
        if (ex.priority == null && lib) ex.priority = defaultPriority(lib, i);
      });
    }

    // ---- weekly volume ----
    const counts = countWeeklySets(block, resolvedByRoutine);
    for (const [muscle, total] of counts) {
      const range = VOLUME_RANGE[muscle];
      if (!range) continue;

      if (total > range.max) {
        // Shave sets off the most optional exercises hitting that muscle until it's in range.
        let excess = Math.ceil(total - range.max);
        const candidates = routines
          .flatMap((r) => (resolvedByRoutine.get(r.id) ?? []).map((res, i) => ({ routine: r, index: i, resolved: res })))
          .filter((c) => c.resolved.library.primaryMuscle === muscle)
          .sort((a, b) => (b.resolved.priority ?? 3) - (a.resolved.priority ?? 3));

        for (const candidate of candidates) {
          if (excess <= 0) break;
          const ex = candidate.routine.exercises[candidate.index];
          const cut = Math.min(excess, Math.max(0, ex.sets - 2));
          if (cut <= 0) continue;
          ex.sets -= cut;
          excess -= cut;
        }
        if (excess < Math.ceil(total - range.max)) {
          improvements.push(`${block.name}: trimmed ${muscle.replace(/_/g, " ")} back to about ${range.max} weekly sets — past that is usually junk volume.`);
        }
      }
    }

    // Priority muscles for the goal have to actually get trained.
    for (const muscle of goal.priorityMuscles) {
      const total = counts.get(muscle) ?? 0;
      if (total >= PRIORITY_MIN_SETS) continue;

      const addition = ctx.library.find(
        (e) => e.primaryMuscle === muscle && !routines.some((r) => r.exercises.some((ex) => ex.id === e.id))
      );
      if (!addition) {
        warnings.push(`${block.name}: ${muscle.replace(/_/g, " ")} only gets ~${Math.round(total)} sets a week, which is light for your goal.`);
        continue;
      }

      // Add it to the session that already trains this muscle most, else the shortest session.
      const target =
        routines
          .map((r) => ({
            routine: r,
            hits: (resolvedByRoutine.get(r.id) ?? []).filter((res) => res.library.primaryMuscle === muscle).length,
            size: r.exercises.length,
          }))
          .sort((a, b) => b.hits - a.hits || a.size - b.size)[0] ?? null;

      if (!target || !Object.values(block.week).includes(target.routine.id)) continue;

      target.routine.exercises.push({
        id: addition.id,
        name: addition.name,
        sets: 3,
        repsMin: goal.repRange[0],
        repsMax: goal.repRange[1],
        restSeconds: addition.isCompound ? goal.restSecondsCompound : goal.restSecondsIsolation,
        priority: 2,
        why: `Added by your app: ${muscle.replace(/_/g, " ")} is a priority for a ${goal.label.toLowerCase()} goal and the plan was light on it.`,
      });
      improvements.push(`${block.name}: added ${addition.name} — ${muscle.replace(/_/g, " ")} was under-trained for your goal.`);
    }

    // ---- session length ----
    for (const routine of routines) {
      const minutes = estimateWorkoutMinutes(routine.exercises.map((e) => ({ targetSets: e.sets, restSeconds: e.restSeconds ?? 90 })));
      if (minutes <= ctx.sessionMinutes + 12) continue;

      const sorted = [...routine.exercises].sort((a, b) => (b.priority ?? 3) - (a.priority ?? 3));
      let trimmed = 0;
      while (
        routine.exercises.length > 3 &&
        estimateWorkoutMinutes(routine.exercises.map((e) => ({ targetSets: e.sets, restSeconds: e.restSeconds ?? 90 }))) > ctx.sessionMinutes + 12
      ) {
        const drop = sorted.find((e) => routine.exercises.includes(e) && (e.priority ?? 3) >= 4);
        if (!drop) break;
        routine.exercises = routine.exercises.filter((e) => e !== drop);
        trimmed++;
      }
      if (trimmed > 0) {
        improvements.push(`"${routine.name}" ran about ${minutes} min against your ${ctx.sessionMinutes} min — dropped ${trimmed} optional exercise(s).`);
      } else if (minutes > ctx.sessionMinutes + 20) {
        warnings.push(`"${routine.name}" is estimated at ${minutes} min, well over the ${ctx.sessionMinutes} min you said you have.`);
      }
    }

    // ---- recovery: same muscle on back-to-back days ----
    if (blockIndex === 0) {
      const dayMuscles = new Map<number, Set<MuscleGroupKey>>();
      for (const [dayKey, routineId] of Object.entries(block.week)) {
        const muscles = new Set((resolvedByRoutine.get(routineId) ?? []).map((r) => r.library.primaryMuscle));
        dayMuscles.set(Number(dayKey), muscles);
      }
      for (const [day, muscles] of dayMuscles) {
        const next = dayMuscles.get((day + 1) % 7);
        if (!next) continue;
        const clash = [...muscles].filter((m) => next.has(m) && VOLUME_RANGE[m].max > 14);
        if (clash.length > 0) {
          warnings.push(`${clash.map((c) => c.replace(/_/g, " ")).join(" and ")} is trained on back-to-back days — fine occasionally, but recovery will lag if you always hit it hard.`);
        }
      }
    }

    const trainingDays = Object.keys(block.week).length;
    if (trainingDays === 7) {
      warnings.push(`${block.name} schedules all 7 days. At least one full rest day a week is where the adaptation actually happens.`);
    }

    return { ...block, routines };
  });

  const improved: CoachPlanBundle = { ...bundle, blocks };

  // Weekly volume summary for the review screen, based on the first block.
  const firstBlock = blocks[0];
  const firstResolved = new Map<string, ResolvedExercise[]>();
  for (const routine of firstBlock.routines) {
    firstResolved.set(
      routine.id,
      routine.exercises
        .map((ex) => {
          const lib = resolveLibraryExercise(ex.id, ex.name, ctx.library);
          return lib ? { ...ex, library: lib } : null;
        })
        .filter((v): v is ResolvedExercise => v !== null)
    );
  }
  const finalCounts = countWeeklySets(firstBlock, firstResolved);
  const weeklyVolume = [...finalCounts.entries()]
    .map(([muscle, sets]) => {
      const range = VOLUME_RANGE[muscle] ?? { min: 0, max: 99 };
      const isPriority = goal.priorityMuscles.includes(muscle);
      const min = isPriority ? Math.max(range.min, PRIORITY_MIN_SETS) : range.min;
      const status: "low" | "ok" | "high" = sets < min ? "low" : sets > range.max ? "high" : "ok";
      return { muscle, sets: Math.round(sets * 10) / 10, status };
    })
    .sort((a, b) => b.sets - a.sets);

  if (improvements.length === 0 && warnings.length === 0) {
    improvements.push("Plan checked against your library, weekly volume ranges and session length — nothing needed correcting.");
  }

  return { bundle: improved, improvements, warnings, weeklyVolume };
}
