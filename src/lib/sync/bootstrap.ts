import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import { materializeCustomExercises } from "@/lib/db/seed";
import { SYNCED_TABLES, FULL_REPLACE_TABLES } from "./tables";
import { pushEverything } from "./push";
import { pullChanges } from "./pull";
import { withRemoteWritesSuppressed } from "./outbox";

export type BootstrapOutcome = "joined" | "claimed" | "waiting";

/**
 * Attempted on every sync cycle until it resolves (see engine.ts), rather than once — a device
 * can't always tell in one shot which side of the race it's on. Decides which direction the very
 * first sync goes for this device+account:
 *
 *  - Remote already has rows -> some other device got there first: this is a new device joining
 *    an already-synced account. ensureSeeded() already created a fresh local
 *    appSettings/workoutPlans/workoutDays/workoutDayExercises with device-random ids before this
 *    ever runs, so those are wiped first — otherwise they'd sit alongside the real pulled rows and
 *    break both "one settings row" and every id workoutSessions/exerciseSets reference. Then pull
 *    everything down. Outcome: "joined".
 *
 *  - Remote is empty AND this device has real, already-onboarded data (a completed profile or at
 *    least one workout) -> nobody has synced this account yet; this device's data becomes the seed
 *    of truth. Outcome: "claimed".
 *
 *  - Remote is empty AND this device is itself still blank/freshly-seeded -> genuinely ambiguous:
 *    maybe this really is a brand-new account, or maybe another device with the real history just
 *    hasn't run its own first sync yet (exactly the case that bit us: an old session left open
 *    from before sync existed, only pushing once it next reloads). A blank device must NEVER win
 *    this race by uploading its empty defaults as "the truth" — that would silently overwrite a
 *    real account with nothing. So it does nothing and waits: outcome "waiting", retried next
 *    cycle, until either remote gets real data (then it joins) or this device gets onboarded
 *    itself (then it claims).
 */
export async function attemptBootstrap(instance: VshapeDB, userId: string): Promise<BootstrapOutcome> {
  if (!supabase) return "waiting";

  const { count, error } = await supabase.from("sync_rows").select("row_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;

  if (count && count > 0) {
    await withRemoteWritesSuppressed(async () => {
      for (const tableName of FULL_REPLACE_TABLES) {
        await instance.table(tableName).clear();
      }
    });
    await pullChanges(instance, userId, null);
    await materializeCustomExercises();
    return "joined";
  }

  const settings = await instance.table("appSettings").toCollection().first();
  const hasRealData = Boolean(settings?.onboardingCompletedAt) || (await instance.table("workoutSessions").count()) > 0;
  if (!hasRealData) return "waiting";

  await pushEverything(instance, userId, SYNCED_TABLES);
  return "claimed";
}
