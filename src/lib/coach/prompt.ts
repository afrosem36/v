import { goalByKey, SPLIT_STYLES, EXPERIENCE_LEVELS } from "./goals";
import { CONTRACT_VERSION, type IntakeAnswers } from "./contract";
import type { TrainingHistorySummary } from "./history";
import type { Exercise } from "@/types/domain";

interface BuildPromptInput {
  intake: IntakeAnswers;
  /** The exercises this gym can actually do — ChatGPT is told to prefer these ids. */
  library: Pick<Exercise, "id" | "name" | "primaryMuscle" | "equipment">[];
  availableEquipment: string[];
}

const BLOCK_COUNT = 6;
const WEEKS_PER_BLOCK = 4;

function describeSplit(key: string): string {
  const split = SPLIT_STYLES.find((s) => s.key === key);
  if (!split || split.key === "auto") return "no strong preference — pick the split that best fits the goal and the available days";
  return `${split.label} (${split.description})`;
}

function describeExperience(key: string): string {
  return EXPERIENCE_LEVELS.find((e) => e.key === key)?.description ?? key;
}

/**
 * Builds the single block of text the user pastes into ChatGPT. Everything the app needs to
 * import the answer is stated here, including the exact JSON shape and the exercise ids it can
 * reference — the importer validates against the same contract, so anything vague here shows up
 * later as an import error.
 */
export function buildCoachPrompt({ intake, library, availableEquipment }: BuildPromptInput): string {
  const goal = goalByKey(intake.goal);

  const about = [
    intake.ageYears != null ? `${intake.ageYears} years old` : null,
    intake.gender && intake.gender !== "unspecified" ? intake.gender : null,
    intake.heightCm != null ? `${intake.heightCm} cm tall` : null,
    intake.weightKg != null ? `currently ${intake.weightKg} kg` : null,
    intake.goalWeightKg != null ? `target weight ${intake.goalWeightKg} kg` : null,
    describeExperience(intake.experience),
  ]
    .filter(Boolean)
    .join(", ");

  const libraryLines = library.map((e) => `${e.id} | ${e.name} | ${e.primaryMuscle} | ${e.equipment.join("+") || "bodyweight"}`).join("\n");

  const photoLine = intake.includePhotoInstruction
    ? `I'm going to upload a photo of myself (shirtless / in shorts) in this chat before you answer. Look at it and let it shape the plan — say in "summary" what you actually saw (posture, which areas are lagging, rough body-fat range) and let that drive which muscles get the extra volume. If no photo is attached, plan from the numbers above and say so.\n\n`
    : "";

  return `You are acting as my professional strength and conditioning coach. You have written training programs for years and you are honest rather than flattering.

${photoLine}ABOUT ME
${about || "No profile details given."}

MY GOAL
I want to ${goal.brief}.

HOW I TRAIN
- ${intake.daysPerWeek} days per week
- About ${intake.sessionMinutes} minutes per session
- Split preference: ${describeSplit(intake.splitStyle)}
- Equipment available at my gym: ${availableEquipment.join(", ") || "bodyweight only"}
${intake.limitations.trim() ? `- Injuries / limitations: ${intake.limitations.trim()}\n` : ""}${intake.dislikes.trim() ? `- Exercises I don't want: ${intake.dislikes.trim()}\n` : ""}${intake.notes.trim() ? `- Other notes: ${intake.notes.trim()}\n` : ""}
WHAT I WANT BACK
A ${BLOCK_COUNT * WEEKS_PER_BLOCK}-week (roughly 6 month) program, organised as ${BLOCK_COUNT} blocks of ${WEEKS_PER_BLOCK} weeks. Each block has its own weekly schedule and should progress on the one before it — more volume, harder variations, or heavier rep targets — with one lighter deload week built in around the middle of the program. Suggested rep ranges for my goal are ${goal.repRange[0]}-${goal.repRange[1]} on most work. Cardio guidance for my goal: ${goal.cardioGuidance}.

RULES
1. Answer with ONE JSON object and nothing else. No explanation before it, no notes after it, no markdown code fence.
2. Use the exercise ids from the library below wherever one fits. Only invent an exercise if the library genuinely has nothing — then put it in "customExercises" and reference its id.
3. Schedule exactly ${intake.daysPerWeek} training days per week. Leave the other weekdays out of "week" — the app treats a missing weekday as a rest day.
4. Compounds before isolation inside each session. 3-8 exercises per session.
5. Do not prescribe weights. My app works out the load for every set from what I actually lifted last time. You choose the exercises, sets and rep ranges.
6. Every "why" is one or two plain sentences explaining why that exercise is in that slot for my goal.
7. As well as putting the JSON in your reply, also save it as a downloadable .txt file (e.g. plan.txt) so I can download it directly — I'm often on my phone and copying a reply this long doesn't work reliably.

EXACT JSON SHAPE
{
  "vshape_plan": ${CONTRACT_VERSION},
  "name": "short plan name",
  "summary": "3-5 sentences: the shape of the program, what changes across the blocks, and what I should expect to see by the end",
  "goal": "${intake.goal}",
  "daysPerWeek": ${intake.daysPerWeek},
  "blocks": [
    {
      "id": "b1",
      "name": "Block 1 - Foundation",
      "weekStart": 1,
      "weekEnd": ${WEEKS_PER_BLOCK},
      "focus": "one sentence on what this block is for",
      "week": { "1": "r1", "2": "r2", "4": "r3" },
      "routines": [
        {
          "id": "r1",
          "name": "Chest + Triceps",
          "why": "what this session is for",
          "exercises": [
            { "id": "ex_barbell_bench_press", "sets": 4, "repsMin": ${goal.repRange[0]}, "repsMax": ${goal.repRange[1]}, "restSeconds": ${goal.restSecondsCompound}, "priority": 1, "why": "why this lift, here" }
          ]
        }
      ]
    }
  ],
  "customExercises": [
    { "id": "cx1", "name": "Exercise name", "primaryMuscle": "lats", "equipment": ["dumbbell"], "instructions": "how to perform it" }
  ]
}

Keys in "week" are weekday numbers as strings: "0" Sunday, "1" Monday, "2" Tuesday, "3" Wednesday, "4" Thursday, "5" Friday, "6" Saturday. Values are routine ids from the same block. "priority" is 1 (never skip) to 5 (drop first when short on time). "primaryMuscle" must be one of: lats, lateral_delts, rear_delts, front_delts, traps, chest, upper_chest, biceps, triceps, forearms, quads, hamstrings, glutes, calves, core, full_body. Leave "customExercises" as an empty array if you don't need it.

MY EXERCISE LIBRARY (id | name | primary muscle | equipment)
${libraryLines}`;
}

/** Rough size guard so the UI can warn before someone pastes something ChatGPT will truncate. */
export function promptLength(prompt: string): number {
  return prompt.length;
}

/**
 * The "I've been training, write me the next program" prompt. Same JSON contract as the first
 * one, but the intake questionnaire is replaced by what actually happened: every lift, the
 * weights that moved, what stalled, adherence, and the body-weight trend. A coach who can see
 * that writes a materially better second program than one working from a questionnaire again.
 */
export function buildProgressReviewPrompt({
  intake,
  history,
  library,
  availableEquipment,
}: BuildPromptInput & { history: TrainingHistorySummary }): string {
  const goal = goalByKey(intake.goal);

  const about = [
    intake.ageYears != null ? `${intake.ageYears} years old` : null,
    intake.gender && intake.gender !== "unspecified" ? intake.gender : null,
    intake.heightCm != null ? `${intake.heightCm} cm` : null,
    intake.weightKg != null ? `${intake.weightKg} kg today` : null,
    intake.goalWeightKg != null ? `target ${intake.goalWeightKg} kg` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const programLines = history.currentProgram
    .map((p) => `- ${p.day} — ${p.label}: ${p.exercises.join("; ") || "no exercises"}`)
    .join("\n");

  const liftLines = history.exercises
    .slice(0, 30)
    .map((e) => {
      const parts = [
        `${e.sessionsLogged} session(s)`,
        `last: ${e.lastSession}`,
        `best: ${e.bestSet}`,
        e.estimated1RM != null ? `est 1RM ${e.estimated1RM}kg` : null,
        e.stalledSessions >= 2 ? `STALLED ${e.stalledSessions} sessions` : null,
        `${e.lastPerformedDaysAgo}d ago`,
      ].filter(Boolean);
      return `- ${e.name}: ${parts.join(" | ")}`;
    })
    .join("\n");

  const bodyLine = history.bodyWeightTrend
    ? `Body weight went ${history.bodyWeightTrend.startKg}kg → ${history.bodyWeightTrend.endKg}kg over ${history.bodyWeightTrend.days} days.`
    : "Not enough body-weight entries to show a trend.";

  const libraryLines = library.map((e) => `${e.id} | ${e.name} | ${e.primaryMuscle} | ${e.equipment.join("+") || "bodyweight"}`).join("\n");

  const photoLine = intake.includePhotoInstruction
    ? `I'm uploading a current photo of myself in this chat. Compare what you see against the training below — say in "summary" which areas have actually developed and which are lagging, and let that decide where the extra volume goes. If no photo is attached, work from the numbers and say so.\n\n`
    : "";

  return `You are acting as my professional strength and conditioning coach. You wrote my last program; now you're reviewing how it went and writing the next one. Be honest — if something wasn't working, say so.

${photoLine}ABOUT ME
${about || "No profile details recorded."}
Goal: I want to ${goal.brief}.

HOW TRAINING HAS ACTUALLY GONE
- ${history.totalWorkouts} workouts logged over about ${history.weeksTracked} week(s)
- Recently averaging ${history.workoutsPerWeekRecent} workouts a week${history.avgSessionMinutes > 0 ? `, ${history.avgSessionMinutes} min a session` : ""}
- ${bodyLine}
${history.avgDailySteps != null ? `- Averaging ${history.avgDailySteps.toLocaleString()} steps a day\n` : ""}${history.untrainedRecently.length > 0 ? `- Not trained at all in the last 4 weeks: ${history.untrainedRecently.join(", ")}\n` : ""}
MY CURRENT PROGRAM
${programLines || "No program recorded."}

EVERY LIFT I'VE LOGGED
${liftLines || "Nothing logged yet."}

WHAT I WANT
A fresh ${BLOCK_COUNT * WEEKS_PER_BLOCK}-week program in ${BLOCK_COUNT} blocks of ${WEEKS_PER_BLOCK} weeks, built on what the numbers above show. Specifically:
- Anything marked STALLED needs a real change — a different variation, a different rep range, or a deload — not the same prescription again.
- Keep what's clearly progressing.
- Fix anything the training has been neglecting.
- ${intake.daysPerWeek} days a week, about ${intake.sessionMinutes} minutes a session.
- Equipment available at my gym: ${availableEquipment.join(", ") || "bodyweight only"}.
${intake.limitations.trim() ? `- Injuries / limitations: ${intake.limitations.trim()}\n` : ""}${intake.dislikes.trim() ? `- Exercises I don't want: ${intake.dislikes.trim()}\n` : ""}${intake.notes.trim() ? `- Other notes: ${intake.notes.trim()}\n` : ""}
RULES
1. Answer with ONE JSON object and nothing else. No text before it, no notes after it, no markdown fence.
2. Use exercise ids from the library below. Only invent one if the library has nothing suitable, and then put it in "customExercises".
3. Schedule exactly ${intake.daysPerWeek} training days a week. Weekdays you leave out of "week" are rest days.
4. Do not prescribe weights — my app computes every set's load from what I actually lifted. You choose exercises, sets and rep ranges.
5. In each "why", name the thing in my data that drove the decision — the stall, the missing muscle, the trend. Not "it's good for you".
6. As well as putting the JSON in your reply, also save it as a downloadable .txt file (e.g. plan.txt) so I can download it directly — I'm often on my phone and copying a reply this long doesn't work reliably.

EXACT JSON SHAPE
{
  "vshape_plan": ${CONTRACT_VERSION},
  "name": "short plan name",
  "summary": "3-5 sentences: what the last block of training shows, what changes in this program and why",
  "goal": "${intake.goal}",
  "daysPerWeek": ${intake.daysPerWeek},
  "blocks": [
    {
      "id": "b1",
      "name": "Block 1 - ...",
      "weekStart": 1,
      "weekEnd": ${WEEKS_PER_BLOCK},
      "focus": "one sentence on what this block is for",
      "week": { "1": "r1", "2": "r2", "4": "r3" },
      "routines": [
        {
          "id": "r1",
          "name": "Chest + Triceps",
          "why": "what this session is for",
          "exercises": [
            { "id": "ex_barbell_bench_press", "sets": 4, "repsMin": ${goal.repRange[0]}, "repsMax": ${goal.repRange[1]}, "restSeconds": ${goal.restSecondsCompound}, "priority": 1, "why": "why this lift, here, given my numbers" }
          ]
        }
      ]
    }
  ],
  "customExercises": []
}

Keys in "week" are weekday numbers as strings: "0" Sunday through "6" Saturday. "priority" is 1 (never skip) to 5 (drop first when short on time).

MY EXERCISE LIBRARY (id | name | primary muscle | equipment)
${libraryLines}`;
}
