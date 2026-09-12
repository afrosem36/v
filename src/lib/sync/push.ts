import type { VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import type { OutboxEntry } from "./outbox";

const BATCH_SIZE = 500;

interface SyncRowUpsert {
  user_id: string;
  table_name: string;
  row_id: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
}

/**
 * Sends every pending syncOutbox entry to Supabase, grouped by table and chunked for large
 * batches (the initial backfill can be thousands of rows). Only clears the outbox entries that
 * actually made it — a failed batch (offline, transient error) just retries next cycle, since
 * `put()`-based enqueueing means an entry left behind is still exactly "pending", not corrupted.
 */
export async function flushOutbox(instance: VshapeDB, userId: string): Promise<void> {
  if (!supabase) return;
  const outboxTable = instance.table<OutboxEntry, string>("syncOutbox");
  const pending = await outboxTable.toArray();
  if (pending.length === 0) return;

  const byTable = new Map<string, OutboxEntry[]>();
  for (const entry of pending) {
    const bucket = byTable.get(entry.tableName) ?? [];
    bucket.push(entry);
    byTable.set(entry.tableName, bucket);
  }

  for (const [tableName, entries] of byTable) {
    const table = instance.table(tableName);
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const rows: SyncRowUpsert[] = [];
      const sentIds: string[] = [];

      for (const entry of chunk) {
        if (entry.op === "delete") {
          rows.push({ user_id: userId, table_name: tableName, row_id: entry.rowId, data: {}, deleted: true, updated_at: entry.ts });
          sentIds.push(entry.id);
          continue;
        }
        const current = await table.get(entry.rowId);
        if (!current) continue; // deleted again before this flush — nothing to push, drop the stale upsert
        rows.push({ user_id: userId, table_name: tableName, row_id: entry.rowId, data: current, deleted: false, updated_at: entry.ts });
        sentIds.push(entry.id);
      }

      if (rows.length === 0) continue;
      const { error } = await supabase.from("sync_rows").upsert(rows, { onConflict: "user_id,table_name,row_id" });
      if (error) throw error;
      await outboxTable.bulkDelete(sentIds);
    }
  }
}

/** Enqueues and pushes every row of every synced table — used once, by bootstrap.ts, for a device that's never synced before. */
export async function pushEverything(instance: VshapeDB, userId: string, tableNames: readonly string[]): Promise<void> {
  if (!supabase) return;
  const now = new Date().toISOString();

  for (const tableName of tableNames) {
    const table = instance.table(tableName);
    const rows = await table.toArray();
    if (rows.length === 0) continue;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE) as { id: string }[];
      const payload: SyncRowUpsert[] = chunk.map((row) => ({
        user_id: userId,
        table_name: tableName,
        row_id: row.id,
        data: row,
        deleted: false,
        updated_at: now,
      }));
      const { error } = await supabase.from("sync_rows").upsert(payload, { onConflict: "user_id,table_name,row_id" });
      if (error) throw error;
    }
  }
}
