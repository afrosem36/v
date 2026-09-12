import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import { withRemoteRowApplied } from "./outbox";
import { paginateSupabase } from "./paginate";

interface SyncRow {
  table_name: string;
  row_id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  updated_at: string;
}

const EPOCH = "1970-01-01T00:00:00.000Z";

function cursorKey(dbName: string): string {
  return `vshape:sync-cursor:${dbName}`;
}

export function getSyncCursor(dbName: string): string | null {
  try {
    return localStorage.getItem(cursorKey(dbName));
  } catch {
    return null;
  }
}

function saveSyncCursor(dbName: string, iso: string): void {
  try {
    localStorage.setItem(cursorKey(dbName), iso);
  } catch {
    // best-effort — worst case is one wasted full re-pull next time
  }
}

/**
 * Fetches every remote row changed since `sinceIso` (or everything, if null — used for the
 * one-time bootstrap pull) and applies it locally. `pendingIds` (the still-unflushed outbox entry
 * ids from this same cycle's flushOutbox() call, in the same `tableName:rowId` form) marks rows
 * with a pending, not-yet-pushed local edit — those are skipped for this cycle, so the local edit
 * wins until it's flushed, converging on the next round instead of needing per-field conflict
 * resolution.
 *
 * Paginates with a fixed `since` filter and an offset per page (rather than advancing the cursor
 * per page) deliberately: pushEverything() stamps every row in one push with the exact same
 * `updated_at`, so a bootstrap join's full pull can easily have thousands of rows sharing a
 * timestamp — advancing a `>`-based cursor mid-pagination would risk silently skipping any
 * same-timestamp siblings that landed on the next page. The cursor actually saved for next time
 * is the max `updated_at` seen across every page of this call, once all of them are in.
 */
export async function pullChanges(instance: VshapeDB, userId: string, sinceIso: string | null, pendingIds: Set<string>): Promise<void> {
  if (!supabase) return;
  const since = sinceIso ?? EPOCH;
  let maxSeen = since;

  await paginateSupabase<SyncRow>(
    async (start, end) => {
      const { data, error } = await supabase!
        .from("sync_rows")
        .select("table_name,row_id,data,deleted,updated_at")
        .eq("user_id", userId)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .range(start, end);
      if (error) throw error;
      return (data ?? []) as SyncRow[];
    },
    async (rows) => {
      for (const row of rows) {
        if (row.updated_at > maxSeen) maxSeen = row.updated_at;
        if (pendingIds.has(`${row.table_name}:${row.row_id}`)) continue;
        const table = instance.table(row.table_name);
        await withRemoteRowApplied(row.table_name, row.row_id, async () => {
          if (row.deleted) await table.delete(row.row_id);
          else await table.put(row.data);
        });
      }
    },
    true
  );

  if (maxSeen !== since) saveSyncCursor(instance.name, maxSeen);
}
