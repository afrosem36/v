import type { MuscleGroupKey, TrainingGoal } from "@/types/domain";

export interface GoalDefinition {
  key: TrainingGoal;
  label: string;
  /** One line the user reads when picking. Written for someone who isn't a coach. */
  blurb: string;
  /** What we tell ChatGPT they're training for. */
  brief: string;
  repRange: [number, number];
  restSecondsCompound: number;
  restSecondsIsolation: number;
  cardioGuidance: string;
  /** Muscles that must clear the higher end of the weekly volume range for this goal. */
  priorityMuscles: MuscleGroupKey[];
}

export const GOALS: GoalDefinition[] = [
  {
    key: "vshape",
    label: "V-shape / wide back",
    blurb: "Broad shoulders and lats, tight waist — the classic V taper.",
    brief:
      "build a V-shaped physique: maximum width through the lats and lateral (side) delts, a strong upper chest, and a tight waist",
    repRange: [8, 14],
    restSecondsCompound: 150,
    restSecondsIsolation: 75,
    cardioGuidance: "2-3 easy sessions a week (walking or incline treadmill) to keep the waist tight without eating into recovery",
    priorityMuscles: ["lats", "lateral_delts", "upper_chest", "rear_delts"],
  },
  {
    key: "lean",
    label: "Lean / get thinner",
    blurb: "Drop fat, keep the muscle you have, look sharper in clothes.",
    brief: "lose body fat while holding on to muscle, ending up lean and defined rather than bigger",
    repRange: [10, 15],
    restSecondsCompound: 120,
    restSecondsIsolation: 60,
    cardioGuidance: "3-5 sessions of easy cardio plus a daily step target; keep the weights heavy enough to protect muscle",
    priorityMuscles: ["lats", "lateral_delts", "core"],
  },
  {
    key: "bulk",
    label: "Bulk / put on size",
    blurb: "Add muscle mass everywhere. Eat more, lift more.",
    brief: "gain muscle size across the whole body, prioritising the muscles that make a physique look big",
    repRange: [6, 12],
    restSecondsCompound: 180,
    restSecondsIsolation: 90,
    cardioGuidance: "keep cardio light — 1-2 easy sessions a week, enough for health without burning the surplus",
    priorityMuscles: ["chest", "lats", "quads", "lateral_delts"],
  },
  {
    key: "strength",
    label: "Strength",
    blurb: "Move heavier weight on the big lifts.",
    brief: "get stronger on the main compound lifts, with size as a welcome side effect",
    repRange: [4, 8],
    restSecondsCompound: 210,
    restSecondsIsolation: 120,
    cardioGuidance: "light conditioning twice a week, kept well away from heavy lower-body days",
    priorityMuscles: ["quads", "chest", "lats", "hamstrings"],
  },
  {
    key: "recomp",
    label: "Recomposition",
    blurb: "Lose fat and gain muscle at the same time.",
    brief: "lose fat and build muscle at the same time, changing shape more than changing scale weight",
    repRange: [8, 14],
    restSecondsCompound: 150,
    restSecondsIsolation: 75,
    cardioGuidance: "3 moderate cardio sessions a week alongside a solid daily step count",
    priorityMuscles: ["lats", "lateral_delts", "quads", "core"],
  },
  {
    key: "general",
    label: "General fitness",
    blurb: "Be fit, healthy and consistent. No specific look.",
    brief: "be generally fit, healthy and strong, with a routine that's realistic to keep up long-term",
    repRange: [8, 15],
    restSecondsCompound: 120,
    restSecondsIsolation: 60,
    cardioGuidance: "2-3 cardio sessions a week plus daily walking",
    priorityMuscles: ["lats", "quads", "core"],
  },
];

export function goalByKey(key: TrainingGoal): GoalDefinition {
  return GOALS.find((g) => g.key === key) ?? GOALS[0];
}

export interface SplitStyle {
  key: string;
  label: string;
  description: string;
  /** Days per week this split assumes. */
  days: number;
}

/** Offered as a preference, not a rule — the prompt tells ChatGPT it may deviate with a reason. */
export const SPLIT_STYLES: SplitStyle[] = [
  { key: "auto", label: "Let the coach decide", description: "Best split for my goal and the days I can train", days: 0 },
  { key: "ppl", label: "Push / Pull / Legs", description: "Chest+shoulders+triceps, back+biceps, legs — repeated twice", days: 6 },
  { key: "bro", label: "One muscle a day", description: "Mon chest, Tue back, Wed shoulders, Thu arms, Fri legs", days: 5 },
  { key: "upper_lower", label: "Upper / Lower", description: "Alternating upper-body and lower-body days", days: 4 },
  { key: "full_body", label: "Full body each session", description: "Everything trained every session — good for 3 days a week", days: 3 },
  { key: "chest_bi", label: "Chest+biceps, back+triceps", description: "Antagonist pairing across the week", days: 5 },
];

export const EXPERIENCE_LEVELS = [
  { key: "beginner", label: "Beginner", description: "Under 6 months of consistent lifting" },
  { key: "returning", label: "Coming back", description: "Trained before, had a long break" },
  { key: "intermediate", label: "Intermediate", description: "1-3 years, know the main lifts" },
  { key: "advanced", label: "Advanced", description: "3+ years of consistent training" },
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["key"];
