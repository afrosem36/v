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

/** Shared by flushOutbox and pushEverything: chunks a batch of rows for Supabase's request-size limit and upserts each chunk. */
async function upsertRows(rows: SyncRowUpsert[]): Promise<void> {
  if (!supabase) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("sync_rows").upsert(chunk, { onConflict: "user_id,table_name,row_id" });
    if (error) throw error;
  }
}

/**
 * Sends every pending syncOutbox entry to Supabase, grouped by table. Only clears the outbox
 * entries whose table finished successfully — a failed table's batch (offline, transient error)
 * just retries next cycle, since `put()`-based enqueueing means an entry left behind is still
 * exactly "pending", not corrupted. Returns the outbox entry ids (already in `tableName:rowId`
 * form) still pending after this call, so callers that also need that — the pull path's "don't
 * let a remote row clobber an unflushed local edit" check, and the status pending-count — can
 * reuse it instead of re-querying the outbox table themselves.
 */
export async function flushOutbox(instance: VshapeDB, userId: string): Promise<Set<string>> {
  if (!supabase) return new Set();
  const outboxTable = instance.table<OutboxEntry, string>("syncOutbox");
  const pending = await outboxTable.toArray();
  if (pending.length === 0) return new Set();

  const remaining = new Set(pending.map((e) => e.id));
  const byTable = new Map<string, OutboxEntry[]>();
  for (const entry of pending) {
    const bucket = byTable.get(entry.tableName) ?? [];
    bucket.push(entry);
    byTable.set(entry.tableName, bucket);
  }

  for (const [tableName, entries] of byTable) {
    const table = instance.table(tableName);
    const deleteEntries = entries.filter((e) => e.op === "delete");
    const upsertEntries = entries.filter((e) => e.op === "upsert");
    const currentRows = upsertEntries.length > 0 ? await table.bulkGet(upsertEntries.map((e) => e.rowId)) : [];

    const rows: SyncRowUpsert[] = [];
    const settledIds: string[] = [];

    for (const entry of deleteEntries) {
      rows.push({ user_id: userId, table_name: tableName, row_id: entry.rowId, data: {}, deleted: true, updated_at: entry.ts });
      settledIds.push(entry.id);
    }
    upsertEntries.forEach((entry, i) => {
      const current = currentRows[i];
      // Stale: deleted again before this flush, or wiped by a bootstrap join — nothing to push, ever.
      settledIds.push(entry.id);
      if (current) rows.push({ user_id: userId, table_name: tableName, row_id: entry.rowId, data: current, deleted: false, updated_at: entry.ts });
    });

    if (rows.length > 0) await upsertRows(rows);
    await outboxTable.bulkDelete(settledIds);
    for (const id of settledIds) remaining.delete(id);
  }

  return remaining;
}

/** Pushes every row of every given table — used by bootstrap.ts, for a device establishing or merging in its own history. Tables are independent, so their pushes run concurrently. */
export async function pushEverything(instance: VshapeDB, userId: string, tableNames: readonly string[]): Promise<void> {
  if (!supabase) return;
  const now = new Date().toISOString();

  await Promise.all(
    tableNames.map(async (tableName) => {
      const table = instance.table(tableName);
      const rows = (await table.toArray()) as { id: string }[];
      if (rows.length === 0) return;
      await upsertRows(rows.map((row) => ({ user_id: userId, table_name: tableName, row_id: row.id, data: row, deleted: false, updated_at: now })));
    })
  );
}
