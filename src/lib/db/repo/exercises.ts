import { db } from "@/lib/db/db";
import type { Exercise, EquipmentKey, MuscleGroupKey } from "@/types/domain";

export async function getExercisesByPrimaryMuscle(muscle: MuscleGroupKey): Promise<Exercise[]> {
  return db.exercises.where("primaryMuscle").equals(muscle).sortBy("name");
}

export async function getAllExercises(): Promise<Exercise[]> {
  return db.exercises.orderBy("name").toArray();
}

export async function getAvailableEquipmentKeys(): Promise<Set<EquipmentKey>> {
  const rows = await db.userEquipment.filter((e) => e.available).toArray();
  return new Set(rows.map((r) => r.equipmentKey));
}

export function isExerciseAvailable(exercise: Exercise, available: Set<EquipmentKey>): boolean {
  return exercise.equipment.every((eq) => available.has(eq));
}

export interface ResolvedExercise {
  exercise: Exercise;
  wasSubstituted: boolean;
  original: Exercise;
}

/**
 * If the prescribed exercise needs equipment this gym doesn't have, walk its alternative
 * chain (best first) until one is fully doable, falling back to bodyweight-only picks.
 */
export async function resolveAvailableExercise(exerciseId: string): Promise<ResolvedExercise | null> {
  const available = await getAvailableEquipmentKeys();
  const original = await db.exercises.get(exerciseId);
  if (!original) return null;

  if (isExerciseAvailable(original, available)) {
    return { exercise: original, wasSubstituted: false, original };
  }

  const visited = new Set<string>([original.id]);
  let queue = [...original.alternativeExerciseIds];
  while (queue.length > 0) {
    const candidateId = queue.shift()!;
    if (visited.has(candidateId)) continue;
    visited.add(candidateId);
    const candidate = await db.exercises.get(candidateId);
    if (!candidate) continue;
    if (isExerciseAvailable(candidate, available)) {
      return { exercise: candidate, wasSubstituted: true, original };
    }
    queue = [...queue, ...candidate.alternativeExerciseIds];
  }

  // Nothing in the chain is fully equipped — surface the original; UI shows a warning instead of blocking the workout.
  return { exercise: original, wasSubstituted: false, original };
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}

export async function getExercisesByIds(ids: string[]): Promise<Exercise[]> {
  const results = await db.exercises.bulkGet(ids);
  return results.filter((e): e is Exercise => e != null);
}

export async function getAlternatives(exercise: Exercise): Promise<Exercise[]> {
  return getExercisesByIds(exercise.alternativeExerciseIds);
}

/**
 * Looked up by the `equipmentKey` field, not a derived id — userEquipment rows get a random id
 * at seed time (see seed/index.ts), since a shared literal like `ue_${key}` would collide across
 * every account in this Dexie Cloud database.
 */
export async function setEquipmentAvailability(key: EquipmentKey, available: boolean): Promise<void> {
  await db.userEquipment.where("equipmentKey").equals(key).modify({ available, updatedAt: new Date().toISOString() });
}
