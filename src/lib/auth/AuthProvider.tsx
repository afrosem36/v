"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { openTrainingDb, LEGACY_DB_NAME, type VshapeDB } from "@/lib/db/db";
import { ensureSeeded } from "@/lib/db/seed";
import { getSettings } from "@/lib/db/repo/settings";
import { supabase, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import { findKnownAccountByUserId, nextDbName, rememberAccount, touchLastLogin } from "./accounts";
import { startSyncEngine, stopSyncEngine } from "@/lib/sync/engine";
import { ProfileIntakeForm } from "@/components/auth/ProfileIntakeForm";
import { SignedOutScreen } from "@/components/auth/SignedOutScreen";
import type { Gender, TrainingGoal } from "@/types/domain";

export interface AuthedUser {
  knownAccountId: string;
  email: string;
  name: string;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  goal: TrainingGoal | null;
}

interface AuthContextValue {
  user: AuthedUser;
  db: VshapeDB;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}

/**
 * Two entirely separate code paths rather than one component with an `if` in the middle:
 * SUPABASE_CONFIGURED is a build-time constant, so whichever branch mounts stays mounted for the
 * app's whole life, but keeping them as distinct components makes it obvious neither one calls
 * hooks conditionally.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  return SUPABASE_CONFIGURED ? <SupabaseAuthGate>{children}</SupabaseAuthGate> : <LocalOnlyGate>{children}</LocalOnlyGate>;
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="text-sm font-medium tracking-wide text-text-muted">{label}</div>
    </div>
  );
}

// ---------------- No Supabase configured: single implicit local account, no login ----------------

function LocalOnlyGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    openTrainingDb(LEGACY_DB_NAME);
    ensureSeeded().then(() => setReady(true));
  }, []);

  const settings = useLiveQuery(() => (ready ? getSettings() : undefined), [ready]);

  if (!ready || !settings) return <LoadingScreen label="Loading…" />;

  if (!settings.name.trim()) {
    return <ProfileIntakeForm />;
  }

  const value: AuthContextValue = {
    db: openTrainingDb(LEGACY_DB_NAME),
    user: {
      knownAccountId: "local",
      email: "",
      name: settings.name,
      dateOfBirth: settings.dateOfBirth,
      gender: settings.gender,
      phone: settings.phone,
      goal: settings.goal,
    },
    signOut: () => {},
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------- Supabase configured: Google sign-in ----------------

type Phase = "checking" | "signed-out" | "authenticating" | "ready";

/** Best-effort display name from whatever Google handed back — settings.name (see below) wins once it exists. */
function googleDisplayName(user: { user_metadata?: Record<string, unknown>; email?: string | null }): string {
  const meta = user.user_metadata ?? {};
  return (meta.full_name as string) || (meta.name as string) || user.email || "";
}

function SupabaseAuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [database, setDatabase] = useState<VshapeDB | null>(null);
  const [knownAccountId, setKnownAccountId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  // Supabase's client fires its own initial event AND getSession() would independently resolve
  // the same session — calling activate() from both raced to open/seed the same local database,
  // one call's openTrainingDb() closing the instance out from under the other's still-running
  // ensureSeeded() (DatabaseClosedError). These refs make activate() idempotent per user instead:
  // a second call for a user already active/activating is simply ignored, however many times
  // Supabase's events fire (including React Strict Mode's dev-only double effect invocation).
  const activatingUserIdRef = useRef<string | null>(null);
  const activatedUserIdRef = useRef<string | null>(null);

  /**
   * Opens (or creates) this Supabase user's local database and materializes it into
   * AuthContextValue. Supabase itself already proved identity by the time this runs — there's no
   * password/timeout dance here the way the old Dexie Cloud bridge needed, since Supabase's client
   * SDK owns the whole OAuth redirect + session-refresh lifecycle internally.
   */
  async function activate(userId: string, userEmail: string, displayNameHint: string): Promise<void> {
    if (activatingUserIdRef.current === userId || activatedUserIdRef.current === userId) return;
    activatingUserIdRef.current = userId;
    setPhase("authenticating");
    try {
      const existing = await findKnownAccountByUserId(userId);
      const dbName = existing?.dbName ?? (await nextDbName());
      const opened = openTrainingDb(dbName);
      await ensureSeeded();

      const settings = await getSettings();
      const known = await rememberAccount(userId, userEmail, settings.name || displayNameHint, dbName);
      await touchLastLogin(known.id);

      activatedUserIdRef.current = userId;
      setDatabase(opened);
      setEmail(userEmail);
      setKnownAccountId(known.id);
      setError(null);
      setPhase("ready");
      // Sync is always supplementary and never blocks sign-in — the same principle as the AI
      // coach calls elsewhere in the app. The engine itself retries the bootstrap race (push vs.
      // pull vs. wait — see sync/bootstrap.ts) every cycle until it resolves, so a transient
      // failure here (missing sync_rows table, offline) or a device that's still waiting to see
      // whether it should push or pull just tries again on the next cycle, not on the next sign-in.
      startSyncEngine(opened, userId, known.id, Boolean(known.syncBootstrappedAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong signing you in.");
      setDatabase(null);
      setKnownAccountId(null);
      setPhase("signed-out");
    } finally {
      activatingUserIdRef.current = null;
    }
  }

  useEffect(() => {
    if (!supabase) return;

    // onAuthStateChange alone covers every case: it fires once immediately with whatever session
    // already exists (event "INITIAL_SESSION", including right after the redirect back from
    // Google, since Supabase's client parses that URL before this subscription is even set up),
    // then again for any later sign-in/out/refresh. A separate getSession() call used to run
    // alongside this and raced it — removed rather than reconciled, since this one subscription is
    // a strict superset of what it provided.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        stopSyncEngine();
        activatedUserIdRef.current = null;
        setDatabase(null);
        setKnownAccountId(null);
        setPhase("signed-out");
        return;
      }
      if (session) {
        void activate(session.user.id, session.user.email ?? "", googleDisplayName(session.user));
      } else if (event === "INITIAL_SESSION") {
        setPhase("signed-out");
      }
    });

    return () => {
      subscription.unsubscribe();
      stopSyncEngine();
    };
    // Runs once on mount only — session changes after that come through onAuthStateChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignIn() {
    if (!supabase) return;
    setSigningIn(true);
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    // A successful call navigates away to Google immediately — this only ever runs on failure
    // (e.g. popup/redirect blocked), so there's no "reset signingIn on success" path needed.
    if (oauthError) {
      setError(oauthError.message);
      setSigningIn(false);
    }
  }

  if (phase === "checking") return <LoadingScreen label="Loading…" />;
  if (phase === "authenticating") return <LoadingScreen label="Signing you in…" />;

  if (phase === "signed-out" || !database || !knownAccountId) {
    return <SignedOutScreen onSignIn={handleSignIn} busy={signingIn} error={error} />;
  }

  return (
    <SupabaseReady database={database} knownAccountId={knownAccountId} email={email}>
      {children}
    </SupabaseReady>
  );
}

/** Mounted only once a database is open and Supabase has a verified session for it. */
function SupabaseReady({
  database,
  knownAccountId,
  email,
  children,
}: {
  database: VshapeDB;
  knownAccountId: string;
  email: string;
  children: React.ReactNode;
}) {
  const settings = useLiveQuery(() => getSettings(), [database]);

  if (!settings) return <LoadingScreen label="Loading…" />;

  if (!settings.name.trim()) {
    return <ProfileIntakeForm />;
  }

  const value: AuthContextValue = {
    db: database,
    user: {
      knownAccountId,
      email,
      name: settings.name,
      dateOfBirth: settings.dateOfBirth,
      gender: settings.gender,
      phone: settings.phone,
      goal: settings.goal,
    },
    signOut: () => {
      supabase?.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
