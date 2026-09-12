import { db } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import { findOneDeduped } from "@/lib/db/repo/dedupe";
import type { BodyWeight, BodyMeasurement, DailySteps, PhotoAngle, ProgressPhoto } from "@/types/domain";

// ---------------- Steps ----------------

export async function upsertDailySteps(date: string, steps: number): Promise<void> {
  const now = new Date().toISOString();
  const existing = await findOneDeduped(db.dailySteps, "date", date);
  if (existing) {
    await db.dailySteps.update(existing.id, { steps, updatedAt: now });
  } else {
    await db.dailySteps.add({ id: newId("steps"), date, steps, source: "manual", updatedAt: now });
  }
}

export async function getStepsInRange(startDate: string, endDate: string): Promise<DailySteps[]> {
  return db.dailySteps.where("date").between(startDate, endDate, true, true).sortBy("date");
}

export async function getStepsForDate(date: string): Promise<DailySteps | undefined> {
  return findOneDeduped(db.dailySteps, "date", date);
}

export function averageSteps(entries: DailySteps[]): number {
  if (entries.length === 0) return 0;
  return Math.round(entries.reduce((sum, e) => sum + e.steps, 0) / entries.length);
}

// ---------------- Body weight ----------------

export async function upsertBodyWeight(
  date: string,
  weightKg: number,
  notes: string | null,
  bodyFatPercent?: number | null
): Promise<void> {
  const existing = await findOneDeduped(db.bodyWeights, "date", date);
  if (existing) {
    const patch: Partial<BodyWeight> = { weightKg, notes };
    if (bodyFatPercent !== undefined) patch.bodyFatPercent = bodyFatPercent;
    await db.bodyWeights.update(existing.id, patch);
  } else {
    await db.bodyWeights.add({
      id: newId("bw"),
      date,
      weightKg,
      notes,
      bodyFatPercent: bodyFatPercent ?? null,
      createdAt: new Date().toISOString(),
    });
  }
}

/** Earliest-recorded body-fat % reading, used as the baseline for "fat lost since you started tracking." */
export async function getFirstBodyFatEntry(): Promise<BodyWeight | undefined> {
  const all = await db.bodyWeights.orderBy("date").toArray();
  return all.find((e) => e.bodyFatPercent != null);
}

export async function getLatestBodyFatEntry(): Promise<BodyWeight | undefined> {
  const all = await db.bodyWeights.orderBy("date").reverse().toArray();
  return all.find((e) => e.bodyFatPercent != null);
}

export async function getBodyWeightsInRange(startDate: string, endDate: string): Promise<BodyWeight[]> {
  return db.bodyWeights.where("date").between(startDate, endDate, true, true).sortBy("date");
}

export async function getLatestBodyWeight(): Promise<BodyWeight | undefined> {
  return db.bodyWeights.orderBy("date").last();
}

export function rollingAverageWeight(entries: BodyWeight[], windowDays: number): number | null {
  if (entries.length === 0) return null;
  const window = entries.slice(-windowDays);
  return Math.round((window.reduce((sum, e) => sum + e.weightKg, 0) / window.length) * 10) / 10;
}

// ---------------- Body measurements ----------------

export async function upsertBodyMeasurement(
  date: string,
  values: Pick<BodyMeasurement, "waistCm" | "chestCm" | "armsCm" | "thighsCm">
): Promise<void> {
  const existing = await findOneDeduped(db.bodyMeasurements, "date", date);
  if (existing) {
    await db.bodyMeasurements.update(existing.id, values);
  } else {
    await db.bodyMeasurements.add({ id: newId("bm"), date, ...values, createdAt: new Date().toISOString() });
  }
}

export async function getAllBodyMeasurements(): Promise<BodyMeasurement[]> {
  return db.bodyMeasurements.orderBy("date").toArray();
}

// ---------------- Progress photos ----------------

export async function addProgressPhoto(date: string, angle: PhotoAngle, blob: Blob): Promise<void> {
  const photo: ProgressPhoto = { id: newId("photo"), date, angle, blob, createdAt: new Date().toISOString() };
  await db.progressPhotos.add(photo);
}

export async function getAllProgressPhotos(): Promise<ProgressPhoto[]> {
  return db.progressPhotos.orderBy("date").reverse().toArray();
}

export async function deleteProgressPhoto(id: string): Promise<void> {
  await db.progressPhotos.delete(id);
}
