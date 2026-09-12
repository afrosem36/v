const CLIENT_TIMEOUT_MS = 12_000;

export interface FeedbackExerciseInput {
  name: string;
  action: string;
  targetRepMin: number;
  targetRepMax: number;
  sets: { weight: number; reps: number; rir: number | null }[];
}

export interface RecentSessionInput {
  date: string;
  label: string;
  primaryMuscles: string[];
  totalVolume: number;
  durationMin: number;
}

type CoachRequestBody =
  | { type: "feedback"; workoutLabel: string; exercises: FeedbackExerciseInput[] }
  | { type: "explain"; exerciseName: string; primaryMuscle: string; equipment: string[] }
  | { type: "adjust"; exerciseName: string; primaryMuscle: string; availableEquipment: string[]; discomfortNote: string }
  | { type: "notes"; rawNote: string; exerciseNames: string[] }
  | { type: "nutrition"; recentSessions: RecentSessionInput[] }
  | {
      type: "exercise_tip";
      exerciseName: string;
      targetRepMin: number;
      targetRepMax: number;
      targetRir: number | null;
      restSeconds: number;
      sets: { weight: number; reps: number; rir: number | null }[];
    };

/**
 * Always resolves — returns null on any failure (offline, Groq down, timeout, missing key).
 * Nothing calling this may treat null as an error state that blocks the UI; AI content is
 * always supplementary here.
 */
export async function askCoach(body: CoachRequestBody): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.text === "string" ? data.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
