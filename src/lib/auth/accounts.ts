import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/utils/id";
import { LEGACY_DB_NAME, closeTrainingDb, currentTrainingDbName, type VshapeDB } from "@/lib/db/db";
import { supabase } from "@/lib/supabase/client";
import type { KnownAccount } from "./types";

/**
 * The local "which accounts have signed in on this device" shortcut list. Deliberately not an
 * authentication store — see KnownAccount's own comment. Shared across every account's separate
 * training database.
 */
class AccountsDB extends Dexie {
  known!: EntityTable<KnownAccount, "id">;

  constructor() {
    super("vshape-accounts");
    this.version(1).stores({ known: "id, &email, lastLoginAt" });
    // v2: keyed by the Supabase auth user id instead of email — Google accounts are looked up by a
    // stable id, which (unlike email) can never change out from under a signed-in session.
    this.version(2).stores({ known: "id, &userId, lastLoginAt" });
  }
}

export const accountsDb = new AccountsDB();

export async function listKnownAccounts(): Promise<KnownAccount[]> {
  return accountsDb.known.orderBy("lastLoginAt").reverse().toArray();
}

export async function findKnownAccountByUserId(userId: string): Promise<KnownAccount | undefined> {
  return accountsDb.known.where("userId").equals(userId).first();
}

/**
 * The first account on a device adopts the original "vshape" database name, which is how
 * training data logged before accounts existed survives the upgrade. Every account after that
 * gets a fresh, isolated database name.
 *
 * Only rows with a `userId` count as "taken" — a row from the old email/password system (pre
 * Google/Supabase) has no `userId` at all (it predates that field), and treating it as a live
 * claim on "vshape" is exactly what silently handed a brand-new empty database to the first
 * Google sign-in on a device that already had real local training data. Those old rows are dead
 * weight now (the identity they pointed to no longer authenticates), so they're ignored here.
 */
export async function nextDbName(): Promise<string> {
  const accounts = await listKnownAccounts();
  const taken = new Set(accounts.filter((a) => a.userId).map((a) => a.dbName));
  if (!taken.has(LEGACY_DB_NAME)) return LEGACY_DB_NAME;
  return `vshape-${newId("u").slice(2)}`;
}

/** Called once Supabase resolves a signed-in user for the given local database. */
export async function rememberAccount(userId: string, email: string, name: string, dbName: string): Promise<KnownAccount> {
  const existing = await findKnownAccountByUserId(userId);
  const now = new Date().toISOString();

  if (existing) {
    await accountsDb.known.update(existing.id, { email, name, dbName, lastLoginAt: now });
    return { ...existing, email, name, dbName, lastLoginAt: now };
  }

  const account: KnownAccount = { id: newId("acct"), userId, email, name, dbName, lastLoginAt: now };
  await accountsDb.known.add(account);
  return account;
}

export async function touchLastLogin(id: string): Promise<void> {
  await accountsDb.known.update(id, { lastLoginAt: new Date().toISOString() });
}

export async function markSyncBootstrapped(id: string): Promise<void> {
  await accountsDb.known.update(id, { syncBootstrappedAt: new Date().toISOString() });
}

/**
 * Resets only the local "have I already done my first push/pull" bookkeeping flag — never
 * touches any actual training data. Used by the manual "force full resync" action in Settings,
 * for when this device's bootstrap resolved against a Supabase state that's since changed (e.g.
 * the sync_rows table was cleared/reset) and needs to re-run against the current remote state.
 */
export async function clearSyncBootstrapped(id: string): Promise<void> {
  await accountsDb.known.update(id, { syncBootstrappedAt: null });
}

/** Removes the device shortcut only — does not touch the account's real data anywhere else. */
export async function forgetKnownAccount(id: string): Promise<void> {
  await accountsDb.known.delete(id);
}

/**
 * Wipes this device's copy of the account's training data and signs out of Supabase. This does
 * NOT delete the underlying Supabase auth identity — Supabase's client SDK has no "delete my own
 * account" call; that needs a server-side call with the service-role key, which is a deliberately
 * out-of-scope addition for this pass (see the Google/Supabase migration plan's Phase 1 notes).
 * Until that exists, "Delete account" only clears this device; the person can still sign back in
 * with the same Google account afterward.
 */
export async function deleteAccountEverywhere(db: VshapeDB, knownAccountId: string): Promise<{ ok: boolean; error?: string }> {
  const dbName = db.name;
  if (currentTrainingDbName() === dbName) closeTrainingDb();
  await Dexie.delete(dbName);
  await forgetKnownAccount(knownAccountId);
  if (supabase) await supabase.auth.signOut().catch(() => {});
  return { ok: true };
}
