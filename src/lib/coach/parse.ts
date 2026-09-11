import { CONTRACT_VERSION, type CoachBlock, type CoachCustomExercise, type CoachExercise, type CoachPlanBundle, type CoachRoutine, type ValidationResult } from "./contract";
import { GOALS } from "./goals";
import type { EquipmentKey, MuscleGroupKey, TrainingGoal } from "@/types/domain";

const MUSCLE_KEYS: MuscleGroupKey[] = [
  "lateral_delts", "lats", "rear_delts", "upper_chest", "chest", "biceps", "triceps",
  "forearms", "quads", "hamstrings", "glutes", "calves", "core", "front_delts", "traps", "full_body",
];

const EQUIPMENT_KEYS: EquipmentKey[] = [
  "dumbbell", "barbell", "adjustable_bench", "flat_bench", "incline_bench", "squat_rack",
  "cable_machine", "lat_pulldown", "seated_cable_row", "leg_press", "leg_extension", "leg_curl",
  "chest_press_machine", "pec_deck", "shoulder_press_machine", "smith_machine", "pull_up_bar",
  "ez_curl_bar", "treadmill", "exercise_bike", "bodyweight",
];

const MAX_BLOCKS = 12;
const MAX_ROUTINES_PER_BLOCK = 7;
const MAX_EXERCISES_PER_ROUTINE = 12;

/**
 * Pulls the JSON object out of whatever got pasted. Models fence their JSON, apologise before
 * it, or sign off after it — none of which is worth making the user retry for.
 */
export function extractJSON(text: string): { value: unknown } | { error: string } {
  const raw = text.trim();
  if (!raw) return { error: "Nothing was pasted." };

  try {
    return { value: JSON.parse(raw) };
  } catch {
    /* keep looking */
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return { value: JSON.parse(fenced[1]) };
    } catch {
      /* keep looking */
    }
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return { value: JSON.parse(raw.slice(first, last + 1)) };
    } catch {
      /* give up */
    }
  }

  return { error: "That doesn't contain valid JSON. Copy ChatGPT's whole answer, starting at the first { and ending at the last }." };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const str = (v: unknown, max: number, fallback = ""): string => (isStr(v) ? v.trim().slice(0, max) : fallback);
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? Math.round(v) : typeof v === "string" ? Math.round(Number(v)) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Turns a pasted answer into a bundle the rest of the app can trust. Anything structural is a
 * hard error the user sees; anything merely sloppy (a rep range backwards, 14 sets on one
 * exercise) is repaired here and reported, because failing a whole 6-month plan over one typo
 * helps nobody.
 */
export function validateCoachPlan(input: unknown): ValidationResult {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!isObj(input)) return { ok: false, errors: ["The pasted answer wasn't a JSON object."] };

  if (input.vshape_plan != null && Number(input.vshape_plan) !== CONTRACT_VERSION) {
    repairs.push(`Plan was written for contract v${input.vshape_plan}; importing it as v${CONTRACT_VERSION}.`);
  }

  const goalRaw = str(input.goal, 40).toLowerCase();
  const goal: TrainingGoal = (GOALS.find((g) => g.key === goalRaw)?.key ?? "vshape") as TrainingGoal;
  if (goalRaw && goal !== goalRaw) repairs.push(`Unknown goal "${goalRaw}" — treated as V-shape.`);

  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (rawBlocks.length === 0) errors.push('"blocks" is missing or empty — ChatGPT didn\'t return any training blocks.');

  const customExercises: CoachCustomExercise[] = (Array.isArray(input.customExercises) ? input.customExercises : [])
    .filter(isObj)
    .slice(0, 30)
    .map((c, i): CoachCustomExercise => {
      const muscle = str(c.primaryMuscle, 30) as MuscleGroupKey;
      const equipment = (Array.isArray(c.equipment) ? c.equipment : [])
        .filter((e): e is EquipmentKey => typeof e === "string" && EQUIPMENT_KEYS.includes(e as EquipmentKey));
      return {
        id: str(c.id, 40, `cx${i + 1}`),
        name: str(c.name, 80, `Custom exercise ${i + 1}`),
        primaryMuscle: MUSCLE_KEYS.includes(muscle) ? muscle : "full_body",
        equipment: equipment.length > 0 ? equipment : ["bodyweight"],
        instructions: str(c.instructions, 600) || undefined,
      };
    })
    .filter((c) => isStr(c.name));

  const blocks: CoachBlock[] = [];

  rawBlocks.slice(0, MAX_BLOCKS).forEach((rawBlock, bi) => {
    if (!isObj(rawBlock)) {
      errors.push(`blocks[${bi}] isn't an object.`);
      return;
    }

    const routines: CoachRoutine[] = [];
    const rawRoutines = Array.isArray(rawBlock.routines) ? rawBlock.routines : [];

    rawRoutines.slice(0, MAX_ROUTINES_PER_BLOCK).forEach((rawRoutine, ri) => {
      if (!isObj(rawRoutine)) return;
      const exercises: CoachExercise[] = [];
      const rawExercises = Array.isArray(rawRoutine.exercises) ? rawRoutine.exercises : [];

      rawExercises.slice(0, MAX_EXERCISES_PER_ROUTINE).forEach((rawEx) => {
        if (!isObj(rawEx)) return;
        const id = str(rawEx.id, 60);
        const name = str(rawEx.name, 80);
        if (!id && !name) return; // nothing to resolve against — drop silently

        let repsMin = int(rawEx.repsMin ?? rawEx.reps, 1, 60, 8);
        let repsMax = int(rawEx.repsMax ?? rawEx.reps, 1, 60, Math.max(repsMin, 12));
        if (repsMin > repsMax) {
          [repsMin, repsMax] = [repsMax, repsMin];
          repairs.push(`Rep range for "${name || id}" was backwards — swapped to ${repsMin}-${repsMax}.`);
        }

        exercises.push({
          id: id || name,
          name: name || undefined,
          sets: int(rawEx.sets, 1, 8, 3),
          repsMin,
          repsMax,
          restSeconds: rawEx.restSeconds != null ? int(rawEx.restSeconds, 15, 400, 90) : undefined,
          priority: rawEx.priority != null ? int(rawEx.priority, 1, 5, 3) : undefined,
          why: str(rawEx.why, 400) || undefined,
        });
      });

      if (exercises.length === 0) {
        repairs.push(`Routine "${str(rawRoutine.name, 40, `#${ri + 1}`)}" had no usable exercises and was dropped.`);
        return;
      }

      routines.push({
        id: str(rawRoutine.id, 40, `b${bi + 1}r${ri + 1}`),
        name: str(rawRoutine.name, 40, `Session ${ri + 1}`),
        why: str(rawRoutine.why, 400) || undefined,
        exercises,
      });
    });

    if (routines.length === 0) {
      errors.push(`Block ${bi + 1} ("${str(rawBlock.name, 40, "unnamed")}") has no usable sessions.`);
      return;
    }

    // The week may only point at routines this block actually defines.
    const known = new Set(routines.map((r) => r.id));
    const week: Record<string, string> = {};
    for (const [dayKey, routineId] of Object.entries(isObj(rawBlock.week) ? rawBlock.week : {})) {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        repairs.push(`Block ${bi + 1}: weekday "${dayKey}" isn't 0-6 and was ignored.`);
        continue;
      }
      if (typeof routineId !== "string" || !known.has(routineId)) {
        repairs.push(`Block ${bi + 1}: day ${dayKey} pointed at an unknown session and was left as rest.`);
        continue;
      }
      week[String(day)] = routineId;
    }

    if (Object.keys(week).length === 0) {
      // A block with sessions but no schedule is recoverable: lay them out across the week.
      const spread = [1, 2, 4, 5, 3, 6, 0];
      routines.forEach((r, i) => {
        if (i < spread.length) week[String(spread[i])] = r.id;
      });
      repairs.push(`Block ${bi + 1} had no weekly schedule — its ${routines.length} session(s) were spread across the week.`);
    }

    blocks.push({
      id: str(rawBlock.id, 40, `b${bi + 1}`),
      name: str(rawBlock.name, 60, `Block ${bi + 1}`),
      weekStart: int(rawBlock.weekStart, 1, 104, bi * 4 + 1),
      weekEnd: int(rawBlock.weekEnd, 1, 104, bi * 4 + 4),
      focus: str(rawBlock.focus, 300) || undefined,
      week,
      routines,
    });
  });

  if (blocks.length === 0 && errors.length === 0) {
    errors.push("No usable training blocks were found in that answer.");
  }
  if (errors.length > 0) return { ok: false, errors };

  const bundle: CoachPlanBundle = {
    vshape_plan: CONTRACT_VERSION,
    name: str(input.name, 60, "Coach plan"),
    summary: str(input.summary, 2000),
    goal,
    daysPerWeek: int(input.daysPerWeek, 1, 7, Object.keys(blocks[0].week).length || 4),
    blocks,
    customExercises,
  };

  return { ok: true, bundle, repairs };
}
