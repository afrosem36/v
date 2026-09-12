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
 */
export async function pullChanges(instance: VshapeDB, userId: string, sinceIso: string | null): Promise<void> {
  if (!supabase) return;

  let query = supabase.from("sync_rows").select("table_name,row_id,data,deleted,updated_at").eq("user_id", userId).order("updated_at", { ascending: true });
  query = sinceIso ? query.gt("updated_at", sinceIso) : query.gt("updated_at", EPOCH);
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return;

  const rows = data as SyncRow[];
  const outboxTable = instance.table<OutboxEntry, string>("syncOutbox");
  const pendingIds = new Set((await outboxTable.toArray()).map((e) => e.id));

  await withRemoteWritesSuppressed(async () => {
    for (const row of rows) {
      if (pendingIds.has(`${row.table_name}:${row.row_id}`)) continue;
      const table = instance.table(row.table_name);
      if (row.deleted) {
        await table.delete(row.row_id);
      } else {
        await table.put(row.data);
      }
    }
  });

  saveSyncCursor(instance.name, rows[rows.length - 1].updated_at);
}
