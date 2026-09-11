"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { openTrainingDb } from "@/lib/db/db";
import { ensureSeeded } from "@/lib/db/seed";
import {
  applyAdminResets,
  clearSession,
  getAccount,
  readSessionUserId,
  signIn as signInAccount,
  signUp as signUpAccount,
  writeSession,
} from "./accounts";
import { updateSettings } from "@/lib/db/repo/settings";
import { upsertBodyWeight } from "@/lib/db/repo/body";
import { todayStr } from "@/lib/utils/date";
import type { AuthResult, SignUpInput, UserAccount } from "./types";

interface AuthContextValue {
  user: UserAccount;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

type Status = "checking" | "signed-out" | "ready";

interface AuthGateProps {
  children: React.ReactNode;
  renderSignedOut: (api: {
    signIn: (email: string, password: string) => Promise<AuthResult<UserAccount>>;
    signUp: (input: SignUpInput) => Promise<AuthResult<UserAccount>>;
  }) => React.ReactNode;
}

/**
 * Resolves which account is active before any screen renders, opens that account's database,
 * and seeds it. Sign-in and sign-out both reload the page: every open Dexie live query is bound
 * to the previous database, and a hard reload is the only way to be certain none of them
 * survive into another person's session.
 */
export function AuthGate({ children, renderSignedOut }: AuthGateProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [user, setUser] = useState<UserAccount | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await applyAdminResets();
      const userId = readSessionUserId();
      const account = userId ? await getAccount(userId) : undefined;

      if (!account) {
        if (userId) clearSession();
        if (!cancelled) setStatus("signed-out");
        return;
      }

      openTrainingDb(account.dbName);
      await ensureSeeded();
      if (cancelled) return;
      setUser(account);
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInAccount(email, password);
    if (result.ok) {
      writeSession(result.value.id);
      window.location.reload();
    }
    return result;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const result = await signUpAccount(input);
    if (!result.ok) return result;

    // Seed the new account's own database, then land the intake numbers it collected.
    openTrainingDb(result.value.dbName);
    await ensureSeeded();
    if (input.heightCm != null) await updateSettings({ heightCm: input.heightCm });
    if (input.weightKg != null) await upsertBodyWeight(todayStr(), input.weightKg, null);

    writeSession(result.value.id);
    window.location.reload();
    return result;
  }, []);

  const refreshUser = useCallback(async () => {
    const current = readSessionUserId();
    if (!current) return;
    const fresh = await getAccount(current);
    if (fresh) setUser(fresh);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    window.location.reload();
  }, []);

  const value = useMemo(() => (user ? { user, signOut, refreshUser } : null), [user, signOut, refreshUser]);

  if (status === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <div className="text-sm font-medium tracking-wide text-text-muted">Loading…</div>
      </div>
    );
  }

  if (status === "signed-out" || !value) {
    return <>{renderSignedOut({ signIn, signUp })}</>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
