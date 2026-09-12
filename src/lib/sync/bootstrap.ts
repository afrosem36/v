import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import { materializeCustomExercises } from "@/lib/db/seed";
import type { WorkoutDay, WorkoutSession } from "@/types/domain";
import { SYNCED_TABLES, FULL_REPLACE_TABLES } from "./tables";
import { pushEverything } from "./push";
import { pullChanges } from "./pull";
import { withRemoteTableCleared } from "./outbox";

export type BootstrapOutcome = "joined" | "claimed" | "waiting";

const MERGE_UP_TABLES = SYNCED_TABLES.filter((t) => !FULL_REPLACE_TABLES.includes(t));

/**
 * A device joining an already-synced account wipes its own device-random-id
 * appSettings/workoutPlans/workoutDays/workoutDayExercises and replaces them with the pulled real
 * ones (see attemptBootstrap below) — but any pre-existing local workoutSessions still point at
 * the just-wiped, now-nonexistent workoutDay ids. Left alone, that's a silent dangling reference
 * (broken day labels in history/schedule views) merged up into the shared account. Nulling it out
 * (WorkoutSession.workoutDayId is nullable — a session can already exist without one, e.g. an
 * ad-hoc workout) keeps the session and its sets/PRs intact and drops only the broken pointer.
 */
async function reconcileDanglingWorkoutDayIds(instance: VshapeDB): Promise<void> {
  const days = await instance.table<WorkoutDay, string>("workoutDays").toArray();
  const existingDayIds = new Set(days.map((d) => d.id));

  const sessions = await instance.table<WorkoutSession, string>("workoutSessions").toArray();
  const dangling = sessions.filter((s) => s.workoutDayId != null && !existingDayIds.has(s.workoutDayId));
  if (dangling.length === 0) return;

  await instance.table<WorkoutSession, string>("workoutSessions").bulkPut(dangling.map((s) => ({ ...s, workoutDayId: null })));
}

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
 *    everything down, reconcile any now-dangling workoutSessions.workoutDayId, and push this
 *    device's own pre-existing rows for every OTHER synced table — a device can easily have real
 *    history of its own from before it ever synced (logged before this feature shipped, or logged
 *    on a second device that hadn't joined yet), and that history has its own distinct row ids, so
 *    merging it up is always additive, never a collision with what was just pulled. Outcome:
 *    "joined".
 *
 *  - Remote is empty AND this device has real, already-used data in any of the tables it would
 *    merge up (not just a completed profile or a workout session — body weight, steps, custom
 *    exercises, etc. all count) -> nobody has synced this account yet; this device's data becomes
 *    the seed of truth. Outcome: "claimed".
 *
 *  - Remote is empty AND this device is itself still blank/freshly-seeded -> genuinely ambiguous:
 *    maybe this really is a brand-new account, or maybe another device with the real history just
 *    hasn't run its own first sync yet (exactly the case that bit us: an old session left open
 *    from before sync existed, only pushing once it next reloads). A blank device must NEVER win
 *    this race by uploading its empty defaults as "the truth" — that would silently overwrite a
 *    real account with nothing. So it does nothing and waits: outcome "waiting", retried next
 *    cycle, until either remote gets real data (then it joins) or this device gets real data of
 *    its own (then it claims).
 */
export async function attemptBootstrap(instance: VshapeDB, userId: string): Promise<BootstrapOutcome> {
  if (!supabase) return "waiting";

  const { count, error } = await supabase.from("sync_rows").select("row_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;

  if (count && count > 0) {
    await Promise.all(FULL_REPLACE_TABLES.map((tableName) => withRemoteTableCleared(tableName, () => instance.table(tableName).clear())));
    await pullChanges(instance, userId, null, new Set());
    await materializeCustomExercises();
    await reconcileDanglingWorkoutDayIds(instance);
    await pushEverything(instance, userId, MERGE_UP_TABLES);
    return "joined";
  }

  const rowCounts = await Promise.all(MERGE_UP_TABLES.map((tableName) => instance.table(tableName).count()));
  const hasRealData = rowCounts.some((n) => n > 0);
  if (!hasRealData) return "waiting";

  await pushEverything(instance, userId, SYNCED_TABLES);
  return "claimed";
}
