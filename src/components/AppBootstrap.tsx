"use client";

import { useEffect } from "react";
import { AuthGate } from "@/lib/auth/AuthProvider";
import { AuthScreen } from "@/components/auth/AuthScreen";
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
    <AuthGate renderSignedOut={({ signIn, signUp }) => <AuthScreen signIn={signIn} signUp={signUp} />}>
      <SessionHousekeeping />
      <OnboardingGate>{children}</OnboardingGate>
    </AuthGate>
  );
}

/**
 * Closes out workouts left open on an earlier day, once per app start. Without it a session
 * opened on Tuesday and never finished stays active forever and swallows every later attempt to
 * start a different day's workout.
 */
function SessionHousekeeping() {
  useEffect(() => {
    finalizeStaleSessions();
  }, []);
  return null;
}
