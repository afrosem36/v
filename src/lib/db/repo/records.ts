import { db } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import { detectNewPRs, type PRCheckResult } from "@/lib/engine/pr";
import type { ExerciseSet, PersonalRecord, PRType } from "@/types/domain";

export async function getPRsForExercise(exerciseId: string): Promise<PersonalRecord[]> {
  return db.personalRecords.where("exerciseId").equals(exerciseId).toArray();
}

/** Call once per exercise right after a session is completed. Persists any records broken and returns them. */
export async function evaluateAndSavePRs(exerciseId: string, sessionId: string, newSets: ExerciseSet[]): Promise<PRCheckResult[]> {
  const existing = await getPRsForExercise(exerciseId);
  const results = detectNewPRs(newSets, existing);
  const now = new Date().toISOString();

  for (const r of results) {
    if (!r.isNewPR) continue;
    const existingOfType = existing.find((p) => p.type === r.type);
    const record: PersonalRecord = {
      id: existingOfType?.id ?? newId("pr"),
      exerciseId,
      type: r.type,
      value: r.value,
      weightKg: r.weightKg,
      reps: r.reps,
      achievedAt: now,
      sessionId,
      isBaseline: !r.celebrate,
    };
    await db.personalRecords.put(record);
  }

  return results.filter((r) => r.celebrate);
}

/**
 * Replays every completed session for one exercise, oldest first, rebuilding its records from
 * nothing. Editing or deleting a logged set can only make records go down, and no incremental
 * update can do that correctly — the record it beat is long gone. Cheap enough to just redo:
 * one exercise's history is tens of sets, not thousands.
 */
export async function rebuildPRsForExercise(exerciseId: string): Promise<void> {
  const [sets, completedSessions] = await Promise.all([
    db.exerciseSets.where("exerciseId").equals(exerciseId).toArray(),
    db.workoutSessions.where("status").equals("completed").toArray(),
  ]);
  const completedIds = new Set(completedSessions.map((s) => s.id));

  const bySession = new Map<string, ExerciseSet[]>();
  for (const set of sets) {
    if (set.isWarmup || !completedIds.has(set.sessionId)) continue;
    const bucket = bySession.get(set.sessionId) ?? [];
    bucket.push(set);
    bySession.set(set.sessionId, bucket);
  }

  const ordered = [...bySession.entries()].sort(
    (a, b) => earliestCompletedAt(a[1]).localeCompare(earliestCompletedAt(b[1]))
  );

  await db.personalRecords.where("exerciseId").equals(exerciseId).delete();

  const accumulated = new Map<PRType, PersonalRecord>();
  for (const [sessionId, sessionSets] of ordered) {
    const results = detectNewPRs(sessionSets, [...accumulated.values()]);
    for (const r of results) {
      if (!r.isNewPR) continue;
      accumulated.set(r.type, {
        id: accumulated.get(r.type)?.id ?? newId("pr"),
        exerciseId,
        type: r.type,
        value: r.value,
        weightKg: r.weightKg,
        reps: r.reps,
        achievedAt: earliestCompletedAt(sessionSets),
        sessionId,
        isBaseline: !r.celebrate,
      });
    }
  }

  if (accumulated.size > 0) await db.personalRecords.bulkPut([...accumulated.values()]);
}

function earliestCompletedAt(sets: ExerciseSet[]): string {
  return sets.reduce((min, s) => (s.completedAt < min ? s.completedAt : min), sets[0].completedAt);
}

export async function getAllPRsByType(type: PRType): Promise<PersonalRecord[]> {
  return db.personalRecords.where("type").equals(type).toArray();
}

/** PRs worth celebrating from a session — excludes baseline records set on an exercise's first-ever outing. */
export async function getPRsForSession(sessionId: string): Promise<PersonalRecord[]> {
  const rows = await db.personalRecords.where("sessionId").equals(sessionId).toArray();
  return rows.filter((r) => !r.isBaseline);
}

export async function getMostRecentPR(): Promise<PersonalRecord | undefined> {
  const all = (await db.personalRecords.toArray()).filter((p) => !p.isBaseline);
  if (all.length === 0) return undefined;
  return all.reduce((latest, p) => (p.achievedAt > latest.achievedAt ? p : latest));
}
