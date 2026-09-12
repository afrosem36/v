import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { VshapeDB } from "@/lib/db/db";
import { setSyncBootstrapped } from "@/lib/auth/accounts";
import { supabase } from "@/lib/supabase/client";
import { flushOutbox } from "./push";
import { pullChanges, getSyncCursor } from "./pull";
import { attemptBootstrap } from "./bootstrap";
import { onLocalWrite } from "./notify";

// Realtime + the on-write debounce below cover the fast path; this interval is just the fallback
// for whatever they miss (a dropped realtime connection, a local write whose debounce got lost to
// a tab close, etc.), so it can be fairly relaxed.
const FALLBACK_POLL_INTERVAL_MS = 45_000;
/** Coalesces a burst of local writes (e.g. logging several sets in a row) into one push shortly after the last one, instead of a network round-trip per set. */
const LOCAL_WRITE_DEBOUNCE_MS = 800;

export interface SyncStatus {
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError: string | null;
  syncing: boolean;
  /** False while this device is still waiting to see whether it should push or pull first — see bootstrap.ts. */
  bootstrapped: boolean;
  /** Whether the Supabase Realtime channel is currently connected — instant cross-device pulls only happen while this is true; otherwise the fallback interval still covers it. */
  realtimeConnected: boolean;
}

const initialStatus: SyncStatus = {
  lastSyncedAt: null,
  pendingCount: 0,
  lastError: null,
  syncing: false,
  bootstrapped: false,
  realtimeConnected: false,
};

/** Reactive sync status — same zustand pattern as src/store/active-workout-store.ts, so components just call this hook directly instead of a bespoke subscribe wrapper. */
export const useSyncStatusStore = create<SyncStatus>(() => ({ ...initialStatus }));

function setStatus(patch: Partial<SyncStatus>): void {
  useSyncStatusStore.setState(patch);
}

let timer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let onlineHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let unsubscribeLocalWrite: (() => void) | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let running = false;
let activeCycle: (() => void) | null = null;

/** Triggers an immediate cycle on the currently-running engine, if any — used by the manual "sync now" button in Settings. Goes through the same bootstrap gate as the interval, so it can never leak a not-yet-resolved device's placeholder data early. */
export function triggerSyncNow(): void {
  activeCycle?.();
}

/**
 * Flips this session's in-memory "already bootstrapped" flag back off, so the next cycle
 * re-attempts the bootstrap race against Supabase's current state (see bootstrap.ts) instead of
 * assuming a decision made earlier in this session still holds. Pair with setSyncBootstrapped(id,
 * null) (accounts.ts) so the reset also survives a reload — this alone only affects the running
 * session.
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
    if (!useSyncStatusStore.getState().bootstrapped) {
      const outcome = await attemptBootstrap(instance, userId);
      if (outcome === "waiting") {
        setStatus({ lastError: null, syncing: false });
        return;
      }
      await setSyncBootstrapped(knownAccountId, new Date().toISOString());
      setStatus({ bootstrapped: true });
    }

    // Only push once this device has actually resolved which side of the bootstrap race it's on —
    // otherwise a still-"waiting" device's outbox (populated by ensureSeeded()'s own placeholder
    // writes, queued the moment its Dexie hooks were registered) would leak that placeholder data
    // up before attemptBootstrap ever gets to say no.
    const pendingIds = await flushOutbox(instance, userId);
    await pullChanges(instance, userId, getSyncCursor(instance.name), pendingIds);
    setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null, pendingCount: pendingIds.size });
  } catch (err) {
    setStatus({ lastError: err instanceof Error ? err.message : "Sync failed" });
  } finally {
    running = false;
    setStatus({ syncing: false });
  }
}

/**
 * Subscribes to Postgres changes on this user's own sync_rows (RLS still applies to Realtime, so
 * this can never see another user's rows) and triggers an immediate cycle on any change — this is
 * what makes a write on one device show up on another in close to real time instead of waiting for
 * the fallback poll. Requires `sync_rows` to be added to the `supabase_realtime` publication (see
 * schema.sql) — if it isn't, this subscription simply never fires and the fallback interval alone
 * still keeps things eventually consistent, so there's no hard dependency on it being enabled.
 */
function subscribeRealtime(userId: string, cycle: () => void): RealtimeChannel | null {
  if (!supabase) return null;
  const channel = supabase
    .channel(`sync_rows:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "sync_rows", filter: `user_id=eq.${userId}` }, () => cycle())
    .subscribe((subStatus) => {
      setStatus({ realtimeConnected: subStatus === "SUBSCRIBED" });
    });
  return channel;
}

/**
 * Starts the sync engine for the given device+account: an immediate cycle, a Realtime
 * subscription for near-instant pulls, a short debounce that pushes shortly after any local write,
 * and a relaxed fallback interval plus reconnect/foreground triggers. `alreadyBootstrapped` comes
 * from KnownAccount.syncBootstrappedAt — skips re-attempting the bootstrap race on every sign-in
 * once it's already resolved. Idempotent — call stopSyncEngine() first if switching accounts.
 */
export function startSyncEngine(instance: VshapeDB, userId: string, knownAccountId: string, alreadyBootstrapped: boolean): void {
  stopSyncEngine();
  useSyncStatusStore.setState({ ...initialStatus, bootstrapped: alreadyBootstrapped });

  const cycle = () => void runCycle(instance, userId, knownAccountId);
  activeCycle = cycle;

  timer = setInterval(cycle, FALLBACK_POLL_INTERVAL_MS);
  onlineHandler = cycle;
  visibilityHandler = () => {
    if (document.visibilityState === "visible") cycle();
  };
  window.addEventListener("online", onlineHandler);
  document.addEventListener("visibilitychange", visibilityHandler);

  unsubscribeLocalWrite = onLocalWrite(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(cycle, LOCAL_WRITE_DEBOUNCE_MS);
  });

  realtimeChannel = subscribeRealtime(userId, cycle);

  cycle();
}

export function stopSyncEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  if (onlineHandler) window.removeEventListener("online", onlineHandler);
  if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  onlineHandler = null;
  visibilityHandler = null;
  unsubscribeLocalWrite?.();
  unsubscribeLocalWrite = null;
  if (realtimeChannel) void supabase?.removeChannel(realtimeChannel);
  realtimeChannel = null;
  activeCycle = null;
  useSyncStatusStore.setState({ ...initialStatus });
}
