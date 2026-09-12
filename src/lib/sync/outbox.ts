import Dexie, { type Table } from "dexie";
import type { VshapeDB } from "@/lib/db/db";
import { SYNCED_TABLES, type SyncedTableName } from "./tables";

export interface OutboxEntry {
  /** Deterministic `${tableName}:${rowId}` — repeated edits before a flush coalesce into one entry. */
  id: string;
  tableName: SyncedTableName;
  rowId: string;
  op: "upsert" | "delete";
  ts: string;
}

/**
 * Set while the pull path is writing remote rows into Dexie, so the creating/updating/deleting
 * hooks below know to skip enqueueing — otherwise every pulled row would immediately re-queue
 * itself for push, in an infinite pull->push->pull loop.
 */
let isApplyingRemote = false;

export function withRemoteWritesSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  isApplyingRemote = true;
  return fn().finally(() => {
    isApplyingRemote = false;
  });
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

    table.hook("creating", (primKey) => {
      if (isApplyingRemote) return;
      void enqueue(instance, tableName, String(primKey), "upsert");
    });

    table.hook("updating", (_mods, primKey) => {
      if (isApplyingRemote) return;
      void enqueue(instance, tableName, String(primKey), "upsert");
    });

    table.hook("deleting", (primKey) => {
      if (isApplyingRemote) return;
      void enqueue(instance, tableName, String(primKey), "delete");
    });
  }
}

async function enqueue(instance: VshapeDB, tableName: SyncedTableName, rowId: string, op: "upsert" | "delete"): Promise<void> {
  const entry: OutboxEntry = { id: `${tableName}:${rowId}`, tableName, rowId, op, ts: new Date().toISOString() };
  // Dexie propagates its "current transaction" ambiently through the Promise chain that's running
  // it, including into code called from inside a creating/updating/deleting hook. Repo functions
  // almost never open a transaction that includes syncOutbox (e.g. db.exerciseSets.add(set) is
  // scoped to exerciseSets alone) — without Dexie.ignoreTransaction, the put() below would try to
  // enlist in that ambient transaction and throw ("table syncOutbox not part of transaction"),
  // which the try/catch here would previously have swallowed silently, so every single enqueue
  // attempt failed without ever surfacing an error. ignoreTransaction() makes this a genuinely
  // independent write with its own transaction, as Dexie's own docs prescribe for exactly this.
  try {
    await Dexie.ignoreTransaction(() => instance.table("syncOutbox").put(entry));
  } catch {
    // best-effort — never let outbox bookkeeping break the actual write it's tracking
  }
}

export async function pendingOutboxCount(instance: VshapeDB): Promise<number> {
  return instance.table("syncOutbox").count();
}
