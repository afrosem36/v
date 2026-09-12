"use client";

import { useEffect } from "react";
import { AuthGate } from "@/lib/auth/AuthProvider";
import { OnboardingGate } from "@/components/OnboardingGate";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { requestPersistentStorage } from "@/lib/pwa/persist-storage";
import { finalizeStaleSessions } from "@/lib/db/repo/workouts";

export function AppBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker();
    requestPersistentStorage();
  }, []);

  return (
    <AuthGate>
      <SessionHousekeeping />
      <OnboardingGate>{children}</OnboardingGate>
    </AuthGate>
  );
}

/**
 * Closes out workouts left open on an earlier day, once per app start. Without it a session
 * opened on Tuesday and never finished stays active forever and swallows every later attempt to
 * start a different day's workout.
 *
 * Deferred via setTimeout rather than called directly from the effect: this write (completing or
 * abandoning a stale session) runs at the exact same moment every useLiveQuery on the page is also
 * mounting (useHomeData's dashboard query among them), and Dexie propagates its "this code is
 * inside a useLiveQuery querier, read-only" tracking through the Promise microtask chain of
 * whatever's running when a write fires — not just the current transaction. A write that inherits
 * that tag gets rejected with "ReadOnlyError: Readwrite transaction in liveQuery context", blamed
 * on whichever querier's zone was ambient even though that querier itself never wrote anything.
 * Same fix as the sync engine's first cycle (src/lib/sync/engine.ts) and its outbox hook
 * (src/lib/sync/outbox.ts) needed for the same reason: setTimeout starts a genuinely fresh
 * macrotask with no ambient Dexie zone, since Dexie's zone propagation never crosses it.
 */
function SessionHousekeeping() {
  useEffect(() => {
    setTimeout(() => {
      finalizeStaleSessions();
    }, 0);
  }, []);
  return null;
}
