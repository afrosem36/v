import type { VshapeDB } from "@/lib/db/db";
import { markSyncBootstrapped } from "@/lib/auth/accounts";
import { pendingOutboxCount } from "./outbox";
import { flushOutbox } from "./push";
import { pullChanges, getSyncCursor } from "./pull";
import { attemptBootstrap } from "./bootstrap";

const POLL_INTERVAL_MS = 25_000;

export interface SyncStatus {
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError: string | null;
  syncing: boolean;
  /** False while this device is still waiting to see whether it should push or pull first — see bootstrap.ts. */
  bootstrapped: boolean;
}

type Listener = (status: SyncStatus) => void;

let status: SyncStatus = { lastSyncedAt: null, pendingCount: 0, lastError: null, syncing: false, bootstrapped: false };
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
let activeCycle: (() => void) | null = null;

/** Triggers an immediate cycle on the currently-running engine, if any — used by the manual "sync now" button in Settings. Goes through the same bootstrap gate as the interval, so it can never leak a not-yet-resolved device's placeholder data early. */
export function triggerSyncNow(): void {
  activeCycle?.();
}

/**
 * Flips this session's in-memory "already bootstrapped" flag back off, so the next cycle
 * re-attempts the bootstrap race against Supabase's current state (see bootstrap.ts) instead of
 * assuming a decision made earlier in this session still holds. Pair with clearSyncBootstrapped()
 * (accounts.ts) so the reset also survives a reload — this alone only affects the running session.
 */
export function resetBootstrapState(): void {
  setStatus({ bootstrapped: false, lastError: null });
  activeCycle?.();
}

async function runCycle(instance: VshapeDB, userId: string, knownAccountId: string): Promise<void> {
  if (running) return;
  running = true;
  setStatus({ syncing: true });
  try {
    if (!status.bootstrapped) {
      const outcome = await attemptBootstrap(instance, userId);
      if (outcome === "waiting") {
        setStatus({ lastError: null, syncing: false });
        return;
      }
      await markSyncBootstrapped(knownAccountId);
      setStatus({ bootstrapped: true });
    }

    // Only push once this device has actually resolved which side of the bootstrap race it's on —
    // otherwise a still-"waiting" device's outbox (populated by ensureSeeded()'s own placeholder
    // writes, queued the moment its Dexie hooks were registered) would leak that placeholder data
    // up before attemptBootstrap ever gets to say no.
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

/**
 * Starts the periodic push/pull loop for the given device+account. `alreadyBootstrapped` comes
 * from KnownAccount.syncBootstrappedAt — skips re-attempting the bootstrap race on every sign-in
 * once it's already resolved. Idempotent — call stopSyncEngine() first if switching accounts.
 */
export function startSyncEngine(instance: VshapeDB, userId: string, knownAccountId: string, alreadyBootstrapped: boolean): void {
  stopSyncEngine();
  status = { lastSyncedAt: null, pendingCount: 0, lastError: null, syncing: false, bootstrapped: alreadyBootstrapped };

  const cycle = () => void runCycle(instance, userId, knownAccountId);
  activeCycle = cycle;
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
  activeCycle = null;
  status = { lastSyncedAt: null, pendingCount: 0, lastError: null, syncing: false, bootstrapped: false };
}
