import type { VshapeDB } from "@/lib/db/db";
import { pendingOutboxCount } from "./outbox";
import { flushOutbox } from "./push";
import { pullChanges, getSyncCursor } from "./pull";

const POLL_INTERVAL_MS = 25_000;

export interface SyncStatus {
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError: string | null;
  syncing: boolean;
}

type Listener = (status: SyncStatus) => void;

let status: SyncStatus = { lastSyncedAt: null, pendingCount: 0, lastError: null, syncing: false };
const listeners = new Set<Listener>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const l of listeners) l(status);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let timer: ReturnType<typeof setInterval> | null = null;
let onlineHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let running = false;

async function runCycle(instance: VshapeDB, userId: string): Promise<void> {
  if (running) return;
  running = true;
  setStatus({ syncing: true });
  try {
    await flushOutbox(instance, userId);
    await pullChanges(instance, userId, getSyncCursor(instance.name));
    setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null, pendingCount: await pendingOutboxCount(instance) });
  } catch (err) {
    setStatus({ lastError: err instanceof Error ? err.message : "Sync failed" });
  } finally {
    running = false;
    setStatus({ syncing: false });
  }
}

/** Starts the periodic push/pull loop for the given device+account. Idempotent — call stopSyncEngine() first if switching accounts. */
export function startSyncEngine(instance: VshapeDB, userId: string): void {
  stopSyncEngine();

  const cycle = () => void runCycle(instance, userId);
  timer = setInterval(cycle, POLL_INTERVAL_MS);
  onlineHandler = cycle;
  visibilityHandler = () => {
    if (document.visibilityState === "visible") cycle();
  };
  window.addEventListener("online", onlineHandler);
  document.addEventListener("visibilitychange", visibilityHandler);

  cycle();
}

export function stopSyncEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onlineHandler) window.removeEventListener("online", onlineHandler);
  if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  onlineHandler = null;
  visibilityHandler = null;
  status = { lastSyncedAt: null, pendingCount: 0, lastError: null, syncing: false };
}
