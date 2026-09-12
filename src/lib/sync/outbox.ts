import Dexie, { type Table } from "dexie";
import type { VshapeDB } from "@/lib/db/db";
import { SYNCED_TABLES, type SyncedTableName } from "./tables";
import { notifyLocalWrite } from "./notify";

export interface OutboxEntry {
  /** Deterministic `${tableName}:${rowId}` — repeated edits before a flush coalesce into one entry. */
  id: string;
  tableName: SyncedTableName;
  rowId: string;
  op: "upsert" | "delete";
  ts: string;
}

/**
 * Tracks exactly which rows/tables are currently being written by the pull/bootstrap path, so the
 * creating/updating/deleting hooks below know to skip enqueueing just those — otherwise a pulled
 * row would immediately re-queue itself for push, an infinite pull->push->pull loop. Scoped this
 * narrowly (not a single blanket "a remote write is happening somewhere" flag) so a genuine local
 * write to an unrelated row during a pull/bootstrap's `await`s is never silently dropped.
 */
const applyingRemoteKeys = new Set<string>(); // `${tableName}:${rowId}`, for individual row apply (pull.ts)
const applyingRemoteTables = new Set<string>(); // tableName, for a whole-table clear (bootstrap.ts's FULL_REPLACE_TABLES wipe)

export async function withRemoteRowApplied(tableName: string, rowId: string, fn: () => Promise<void>): Promise<void> {
  const key = `${tableName}:${rowId}`;
  applyingRemoteKeys.add(key);
  try {
    await fn();
  } finally {
    applyingRemoteKeys.delete(key);
  }
}

export async function withRemoteTableCleared(tableName: string, fn: () => Promise<void>): Promise<void> {
  applyingRemoteTables.add(tableName);
  try {
    await fn();
  } finally {
    applyingRemoteTables.delete(tableName);
  }
}

/**
 * Registers Dexie hooks on every synced table so any local write (from any repo function,
 * unchanged) enqueues an outbox entry automatically — the standard Dexie pattern for building
 * a sync layer without touching every call site. Called once per opened database, only when
 * Supabase is configured (see openTrainingDb() in db.ts).
 */
export function registerSyncHooks(instance: VshapeDB): void {
  for (const tableName of SYNCED_TABLES) {
    const table = instance.table(tableName) as Table<{ id: string }, string>;
    const isSuppressed = (rowId: string) => applyingRemoteTables.has(tableName) || applyingRemoteKeys.has(`${tableName}:${rowId}`);

    table.hook("creating", (primKey) => {
      const rowId = String(primKey);
      if (isSuppressed(rowId)) return;
      enqueue(instance, tableName, rowId, "upsert");
    });

    table.hook("updating", (_mods, primKey) => {
      const rowId = String(primKey);
      if (isSuppressed(rowId)) return;
      enqueue(instance, tableName, rowId, "upsert");
    });

    table.hook("deleting", (primKey) => {
      const rowId = String(primKey);
      if (isSuppressed(rowId)) return;
      enqueue(instance, tableName, rowId, "delete");
    });
  }
}

function enqueue(instance: VshapeDB, tableName: SyncedTableName, rowId: string, op: "upsert" | "delete"): void {
  const entry: OutboxEntry = { id: `${tableName}:${rowId}`, tableName, rowId, op, ts: new Date().toISOString() };
  // Dexie propagates its ambient zone — both the current TRANSACTION and, separately, a "this code
  // is running inside a useLiveQuery querier, read-only" flag — through the Promise microtask
  // chain that's running whatever triggered this hook, including into code called from inside a
  // creating/updating/deleting hook. Two escapes are needed, not one:
  //  - Dexie.ignoreTransaction alone escapes the ambient transaction (repo functions rarely open
  //    one that includes syncOutbox — db.exerciseSets.add(set) is scoped to exerciseSets alone —
  //    so without it this put() would throw "table syncOutbox not part of transaction").
  //  - It does NOT escape Dexie's liveQuery read-only tracking, though: if the write that
  //    triggered this hook happened to run while some useLiveQuery's querier zone was still
  //    ambient, this put() would throw "ReadOnlyError: Readwrite transaction in liveQuery context"
  //    even with ignoreTransaction in place — hit for real once a page's dashboard liveQuery was
  //    running at the same time as an ordinary write elsewhere (e.g. finalizeStaleSessions()).
  //    setTimeout runs in a genuinely fresh macrotask with no ambient Dexie zone at all — Dexie's
  //    zone propagation only rides the Promise microtask chain, never setTimeout — so scheduling
  //    the actual write there instead of inline escapes both at once.
  setTimeout(() => {
    void Dexie.ignoreTransaction(() => instance.table("syncOutbox").put(entry))
      .then(() => notifyLocalWrite())
      .catch(() => {
        // best-effort — never let outbox bookkeeping break the actual write it's tracking
      });
  }, 0);
}
