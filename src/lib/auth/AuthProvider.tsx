"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { openTrainingDb, DEXIE_CLOUD_URL, LEGACY_DB_NAME, type VshapeDB } from "@/lib/db/db";
import { ensureSeeded } from "@/lib/db/seed";
import { getSettings } from "@/lib/db/repo/settings";
import { listKnownAccounts, nextDbName, rememberAccount, touchLastLogin } from "./accounts";
import { ProfileIntakeForm } from "@/components/auth/ProfileIntakeForm";
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
  switchAccount: (opts: { emailHint?: string }) => Promise<void>;
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
    switchAccount: async () => {},
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------- Dexie Cloud configured: email + one-time-code login, multi-account ----------------

type Phase = "checking" | "signed-out" | "authenticating" | "ready";

function describeAuthError(err: unknown): string {
  if (err instanceof Error) return err.message || "Sign-in was cancelled.";
  return "Sign-in was cancelled.";
}

function CloudAuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [database, setDatabase] = useState<VshapeDB | null>(null);
  const [knownAccountId, setKnownAccountId] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  const [email, setEmail] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  /** Opens the given account's database and proves identity with Dexie Cloud's own login. */
  async function activate(dbName: string, emailHint?: string): Promise<void> {
    setAuthError(null);
    setPhase("authenticating");
    const opened = openTrainingDb(dbName);
    // Resolves near-instantly with no prompt if this database already holds a valid session
    // (Dexie Cloud caches a crypto key locally after the first verification); otherwise its
    // built-in modal asks for the email and a one-time code. Throws if the person cancels it.
    await opened.cloud.login(emailHint ? { email: emailHint } : undefined);
    setDatabase(opened);
    await ensureSeeded();

    const cloudEmail = opened.cloud.currentUser.value?.email ?? emailHint ?? "";
    const settings = await getSettings();
    const known = await rememberAccount(cloudEmail, settings.name || cloudEmail, dbName);
    await touchLastLogin(known.id);

    setEmail(cloudEmail);
    setKnownAccountId(known.id);
    setKnownAccounts(await listKnownAccounts());
    setPhase("ready");
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
        await activate(accounts[0].dbName, accounts[0].email);
      } catch (err) {
        setDatabase(null);
        setAuthError(describeAuthError(err));
        setPhase("signed-out");
      }
    })();
    // Runs once on mount only — later switches go through the screen's own handlers.
  }, []);

  if (phase === "checking") return <LoadingScreen label="Loading…" />;
  if (phase === "authenticating") return <LoadingScreen label="Verifying your account…" />;

  if (phase === "signed-out" || !database || !knownAccountId) {
    return (
      <SignedOutScreen
        knownAccounts={knownAccounts}
        error={authError}
        onPick={async (account) => {
          try {
            await activate(account.dbName, account.email);
          } catch (err) {
            setDatabase(null);
            setAuthError(describeAuthError(err));
            setPhase("signed-out");
          }
        }}
        onContinue={async (typedEmail) => {
          try {
            await activate(await nextDbName(), typedEmail || undefined);
          } catch (err) {
            setDatabase(null);
            setAuthError(describeAuthError(err));
            setPhase("signed-out");
          }
        }}
      />
    );
  }

  return (
    <CloudReady
      database={database}
      knownAccountId={knownAccountId}
      knownAccounts={knownAccounts}
      email={email}
      onSwitchAccount={async (emailHint) => {
        const existing = emailHint ? knownAccounts.find((a) => a.email === emailHint.trim().toLowerCase()) : undefined;
        await activate(existing ? existing.dbName : await nextDbName(), emailHint);
      }}
    >
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
  onSwitchAccount,
  children,
}: {
  database: VshapeDB;
  knownAccountId: string;
  knownAccounts: KnownAccount[];
  email: string;
  onSwitchAccount: (emailHint?: string) => Promise<void>;
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
      database.cloud.logout().finally(() => window.location.reload());
    },
    switchAccount: async (opts) => {
      await onSwitchAccount(opts.emailHint);
      window.location.reload();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function SignedOutScreen({
  knownAccounts,
  error,
  onPick,
  onContinue,
}: {
  knownAccounts: KnownAccount[];
  error: string | null;
  onPick: (account: KnownAccount) => Promise<void>;
  onContinue: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Vshape</h1>
      <p className="text-sm leading-relaxed text-text-muted">
        Sign in with your email — you&apos;ll get a one-time code, no password to remember. The same email shows the same training
        on every device.
      </p>

      {knownAccounts.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          {knownAccounts.map((account) => (
            <button
              key={account.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onPick(account);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-left disabled:opacity-40"
            >
              <div className="font-medium">{account.name || account.email}</div>
              <div className="text-xs text-text-muted">{account.email}</div>
            </button>
          ))}
          <div className="text-xs text-text-faint">or use a different email below</div>
        </div>
      )}

      <input
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="username"
        className="h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-base outline-none placeholder:text-text-faint focus:border-accent"
      />
      {error && <div className="w-full rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onContinue(email);
          } finally {
            setBusy(false);
          }
        }}
        className="h-14 w-full rounded-2xl bg-accent text-base font-semibold text-accent-foreground disabled:opacity-40"
      >
        {busy ? "Opening…" : "Continue"}
      </button>
      <p className="text-xs text-text-faint">Everything you log stays yours — Vshape has no ads, no tracking, no data resale.</p>
    </div>
  );
}
