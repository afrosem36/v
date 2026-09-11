import { db } from "@/lib/db/db";
import type { AppSettings } from "@/types/domain";

/**
 * `appSettings` has exactly one row per account and no fixed id — see program.ts's warning on
 * why a shared literal id can never be written to a table Dexie Cloud syncs across accounts.
 * It's looked up as "whichever row this account's own database holds", not by a known key.
 */
export async function getSettings(): Promise<AppSettings> {
  const s = await db.appSettings.toCollection().first();
  if (!s) throw new Error("Settings not seeded yet");
  return s;
}

export async function updateSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<void> {
  await db.appSettings.toCollection().modify(patch);
}

/**
 * Called by anything that edits the weekly program. Once stamped, library version bumps stop
 * re-applying the stock program over the user's own (see seed/index.ts).
 */
export async function markPlanCustomized(): Promise<void> {
  const settings = await db.appSettings.toCollection().first();
  if (!settings || settings.planCustomizedAt) return;
  await db.appSettings.toCollection().modify({ planCustomizedAt: new Date().toISOString() });
}
