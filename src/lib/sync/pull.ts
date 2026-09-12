import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import { withRemoteWritesSuppressed, type OutboxEntry } from "./outbox";

interface SyncRow {
  table_name: string;
  row_id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  updated_at: string;
}

const EPOCH = "1970-01-01T00:00:00.000Z";
/** Matches PostgREST's default max-rows-per-request cap — anything larger needs another page. */
const PAGE_SIZE = 1000;

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
 * one-time bootstrap pull) and applies it locally. A row with a pending, not-yet-pushed local
 * edit is skipped for this cycle — the local edit wins until it's flushed, converging on the
 * next round instead of needing per-field conflict resolution.
 *
 * Paginates with a fixed `since` filter and an offset per page (rather than advancing the cursor
 * per page) deliberately: pushEverything() stamps every row in one push with the exact same
 * `updated_at`, so a bootstrap join's full pull can easily have thousands of rows sharing a
 * timestamp — advancing a `>`-based cursor mid-pagination would risk silently skipping any
 * same-timestamp siblings that landed on the next page. The cursor actually saved for next time
 * is the max `updated_at` seen across every page of this call, once all of them are in.
 */
export async function pullChanges(instance: VshapeDB, userId: string, sinceIso: string | null): Promise<void> {
  if (!supabase) return;
  const since = sinceIso ?? EPOCH;

  const outboxTable = instance.table<OutboxEntry, string>("syncOutbox");
  const pendingIds = new Set((await outboxTable.toArray()).map((e) => e.id));

  let maxSeen = since;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("sync_rows")
      .select("table_name,row_id,data,deleted,updated_at")
      .eq("user_id", userId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    const rows = data as SyncRow[];
    await withRemoteWritesSuppressed(async () => {
      for (const row of rows) {
        if (row.updated_at > maxSeen) maxSeen = row.updated_at;
        if (pendingIds.has(`${row.table_name}:${row.row_id}`)) continue;
        const table = instance.table(row.table_name);
        if (row.deleted) {
          await table.delete(row.row_id);
        } else {
          await table.put(row.data);
        }
      }
    });

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (maxSeen !== since) saveSyncCursor(instance.name, maxSeen);
}
