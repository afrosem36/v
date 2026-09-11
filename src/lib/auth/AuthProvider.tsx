"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { openTrainingDb, DEXIE_CLOUD_URL, LEGACY_DB_NAME, type VshapeDB } from "@/lib/db/db";
import { ensureSeeded } from "@/lib/db/seed";
import { getSettings } from "@/lib/db/repo/settings";
import { listKnownAccounts, nextDbName, rememberAccount, touchLastLogin } from "./accounts";
import { setPendingCredentials, takePendingCredentials } from "./passwordBridge";
import { ProfileIntakeForm } from "@/components/auth/ProfileIntakeForm";
import { SignedOutScreen } from "@/components/auth/SignedOutScreen";
import type { KnownAccount } from "./types";
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
  knownAccounts: KnownAccount[];
  signOut: () => void;
  /** No-op when Dexie Cloud isn't configured — there's nothing to switch between. */
  switchAccount: (opts: { emailHint?: string }) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}

/**
 * Two entirely separate code paths rather than one component with an `if` in the middle:
 * DEXIE_CLOUD_URL is a build-time constant, so whichever branch mounts stays mounted for the
 * app's whole life, but keeping them as distinct components makes it obvious neither one calls
 * hooks conditionally.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  return DEXIE_CLOUD_URL ? <CloudAuthGate>{children}</CloudAuthGate> : <LocalOnlyGate>{children}</LocalOnlyGate>;
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="text-sm font-medium tracking-wide text-text-muted">{label}</div>
    </div>
  );
}

// ---------------- No Dexie Cloud configured: single implicit local account, no login ----------------

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
    knownAccounts: [],
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
    switchAccount: () => {},
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------- Dexie Cloud configured: email + password, bridged to a real Dexie Cloud session ----------------

type Phase = "checking" | "signed-out" | "authenticating" | "ready";

function CloudAuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [database, setDatabase] = useState<VshapeDB | null>(null);
  const [knownAccountId, setKnownAccountId] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  const [email, setEmail] = useState("");
  const [prefillEmail, setPrefillEmail] = useState("");

  /**
   * Opens the given account's database and proves identity. With a password: verified against
   * Postgres server-side, then bridged to a real Dexie Cloud session (see fetchTokens in db.ts).
   * Without one: a bare attempt to resume whatever session Dexie Cloud already has cached
   * locally for this database — resolves silently if it's still valid, throws if not (expired,
   * or genuinely never logged in here), which callers treat as "ask for the password again",
   * not as an error worth alarming anyone over.
   *
   * Deliberately calls login() with NO hint. Dexie Cloud only takes its "already logged in,
   * nothing to do" fast path when no email/userId hint is given — passing one (even just to be
   * explicit) forces it to re-authenticate on every call, which defeats silent resume entirely.
   * Our own fetchTokens (db.ts) never reads that hint anyway; it uses the smuggled credentials
   * below instead, so there's nothing lost by leaving it out.
   */
  async function activate(dbName: string, accountEmail: string, password?: string): Promise<void> {
    setPhase("authenticating");
    const opened = openTrainingDb(dbName);
    if (password) setPendingCredentials(accountEmail, password);
    try {
      await opened.cloud.login();
    } finally {
      takePendingCredentials(); // clears it whether or not fetchTokens consumed it
    }
    setDatabase(opened);
    await ensureSeeded();

    const settings = await getSettings();
    const known = await rememberAccount(accountEmail, settings.name || accountEmail, dbName);
    await touchLastLogin(known.id);

    setEmail(accountEmail);
    setKnownAccountId(known.id);
    setKnownAccounts(await listKnownAccounts());
    setPhase("ready");
  }

  async function signUpAndActivate(dbName: string, accountEmail: string, password: string): Promise<void> {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Couldn't create that account.");
    }
    await activate(dbName, accountEmail, password);
  }

  /** Drops back to the sign-in screen without a page reload — unmounting `children` here cleans
   * up every live query in the app before the database underneath them can change. */
  function resetToSignedOut(emailHint?: string) {
    setDatabase(null);
    setKnownAccountId(null);
    setPrefillEmail(emailHint ?? "");
    setPhase("signed-out");
  }

  useEffect(() => {
    (async () => {
      const accounts = await listKnownAccounts();
      setKnownAccounts(accounts);
      if (accounts.length === 0) {
        setPhase("signed-out");
        return;
      }
      try {
        await activate(accounts[0].dbName, accounts[0].email); // no password — silent resume only
      } catch {
        setDatabase(null);
        setPrefillEmail(accounts[0].email);
        setPhase("signed-out");
      }
    })();
    // Runs once on mount only — later switches go through resetToSignedOut + a fresh submit.
  }, []);

  if (phase === "checking") return <LoadingScreen label="Loading…" />;
  if (phase === "authenticating") return <LoadingScreen label="Verifying your account…" />;

  if (phase === "signed-out" || !database || !knownAccountId) {
    // activate()/signUpAndActivate() set phase to "authenticating" as soon as they start; if
    // either throws, phase must be put back to "signed-out" here or the app is stuck showing
    // the loading screen forever with no way back to this form — SignedOutScreen's own catch
    // only updates its *local* error state, which is invisible while phase hides it from render.
    return (
      <SignedOutScreen
        knownAccounts={knownAccounts}
        prefillEmail={prefillEmail}
        onSignIn={async (typedEmail, password) => {
          const normalized = typedEmail.trim().toLowerCase();
          const existing = knownAccounts.find((a) => a.email === normalized);
          try {
            await activate(existing ? existing.dbName : await nextDbName(), normalized, password);
          } catch (err) {
            setPhase("signed-out");
            throw err;
          }
        }}
        onSignUp={async (typedEmail, password) => {
          try {
            await signUpAndActivate(await nextDbName(), typedEmail.trim().toLowerCase(), password);
          } catch (err) {
            setPhase("signed-out");
            throw err;
          }
        }}
      />
    );
  }

  return (
    <CloudReady database={database} knownAccountId={knownAccountId} knownAccounts={knownAccounts} email={email} onSignedOut={resetToSignedOut}>
      {children}
    </CloudReady>
  );
}

/** Mounted only once a database is open and Dexie Cloud has verified an identity for it. */
function CloudReady({
  database,
  knownAccountId,
  knownAccounts,
  email,
  onSignedOut,
  children,
}: {
  database: VshapeDB;
  knownAccountId: string;
  knownAccounts: KnownAccount[];
  email: string;
  onSignedOut: (emailHint?: string) => void;
  children: React.ReactNode;
}) {
  const settings = useLiveQuery(() => getSettings(), [database]);

  if (!settings) return <LoadingScreen label="Loading…" />;

  if (!settings.name.trim()) {
    return <ProfileIntakeForm />;
  }

  const value: AuthContextValue = {
    db: database,
    knownAccounts,
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
      database.cloud.logout().finally(() => onSignedOut());
    },
    switchAccount: (opts) => onSignedOut(opts.emailHint),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
