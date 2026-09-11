import { db } from "@/lib/db/db";
import { SETTINGS_ID } from "@/lib/db/seed";
import type { AppSettings } from "@/types/domain";

export async function getSettings(): Promise<AppSettings> {
  const s = await db.appSettings.get(SETTINGS_ID);
  if (!s) throw new Error("Settings not seeded yet");
  return s;
}

export async function updateSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<void> {
  await db.appSettings.update(SETTINGS_ID, patch);
}

/**
 * Called by anything that edits the weekly program. Once stamped, library version bumps stop
 * re-applying the stock program over the user's own (see seed/index.ts).
 */
export async function markPlanCustomized(): Promise<void> {
  const settings = await db.appSettings.get(SETTINGS_ID);
  if (!settings || settings.planCustomizedAt) return;
  await db.appSettings.update(SETTINGS_ID, { planCustomizedAt: new Date().toISOString() });
}
