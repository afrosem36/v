import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import { materializeCustomExercises } from "@/lib/db/seed";
import { SYNCED_TABLES, FULL_REPLACE_TABLES } from "./tables";
import { pushEverything } from "./push";
import { pullChanges } from "./pull";
import { withRemoteWritesSuppressed } from "./outbox";

/**
 * Runs once per device per account, gated by KnownAccount.syncBootstrappedAt. Decides which
 * direction the very first sync goes:
 *  - Nobody has ever synced this account before -> this device's current local data (either a
 *    real, pre-existing install or a freshly-seeded empty one) becomes the seed of truth: push
 *    everything up.
 *  - Somebody has -> this is a new device joining an already-synced account. ensureSeeded()
 *    already created a fresh local appSettings/workoutPlans/workoutDays/workoutDayExercises with
 *    device-random ids before this ever runs, so those are wiped first — otherwise they'd sit
 *    alongside the real pulled rows and break both "one settings row" and every id that
 *    workoutSessions/exerciseSets reference. Then pull everything down.
 */
export async function bootstrapSyncIfNeeded(instance: VshapeDB, userId: string): Promise<void> {
  if (!supabase) return;

  const { count, error } = await supabase.from("sync_rows").select("row_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;

  if (!count || count === 0) {
    await pushEverything(instance, userId, SYNCED_TABLES);
    return;
  }

  await withRemoteWritesSuppressed(async () => {
    for (const tableName of FULL_REPLACE_TABLES) {
      await instance.table(tableName).clear();
    }
  });
  await pullChanges(instance, userId, null);
  await materializeCustomExercises();
}
