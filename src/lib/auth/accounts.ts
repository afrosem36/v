import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/utils/id";
import { LEGACY_DB_NAME, DEXIE_CLOUD_URL, closeTrainingDb, currentTrainingDbName, type VshapeDB } from "@/lib/db/db";
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
  }
}

export const accountsDb = new AccountsDB();

export async function listKnownAccounts(): Promise<KnownAccount[]> {
  return accountsDb.known.orderBy("lastLoginAt").reverse().toArray();
}

export async function findKnownAccountByEmail(email: string): Promise<KnownAccount | undefined> {
  return accountsDb.known.where("email").equals(email.trim().toLowerCase()).first();
}

/**
 * The first account on a device adopts the original "vshape" database name, which is how
 * training data logged before accounts existed survives the upgrade. Every account after that
 * gets a fresh, isolated database name — chosen before the person's email is even known, since
 * Dexie Cloud's own login (not this app) is what proves which email it belongs to.
 */
export async function nextDbName(): Promise<string> {
  const taken = new Set((await listKnownAccounts()).map((a) => a.dbName));
  if (!taken.has(LEGACY_DB_NAME)) return LEGACY_DB_NAME;
  return `vshape-${newId("u").slice(2)}`;
}

/** Called once db.cloud.currentUser resolves with a verified email for the given local database. */
export async function rememberAccount(email: string, name: string, dbName: string): Promise<KnownAccount> {
  const normalized = email.trim().toLowerCase();
  const existing = await findKnownAccountByEmail(normalized);
  const now = new Date().toISOString();

  if (existing) {
    await accountsDb.known.update(existing.id, { name, dbName, lastLoginAt: now });
    return { ...existing, name, dbName, lastLoginAt: now };
  }

  const account: KnownAccount = { id: newId("acct"), email: normalized, name, dbName, lastLoginAt: now };
  await accountsDb.known.add(account);
  return account;
}

export async function touchLastLogin(id: string): Promise<void> {
  await accountsDb.known.update(id, { lastLoginAt: new Date().toISOString() });
}

/** Removes the device shortcut only — does not touch the account's real data in Dexie Cloud. */
export async function forgetKnownAccount(id: string): Promise<void> {
  await accountsDb.known.delete(id);
}

/**
 * Full account deletion: removes the Postgres accounts row (password re-checked server-side —
 * this is what actually frees the email up for reuse), removes the person's Dexie Cloud account
 * and data, then clears the local copy. `db` must be the specific account's open, logged-in
 * VshapeDB instance — its own currentUser carries the token the Dexie Cloud call needs.
 */
export async function deleteAccountEverywhere(db: VshapeDB, knownAccountId: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  // No Dexie Cloud configured means no Postgres account and no password to check either — just
  // wipe the single local database, matching the original pre-accounts behavior.
  if (!DEXIE_CLOUD_URL) {
    await Dexie.delete(db.name);
    closeTrainingDb();
    return { ok: true };
  }

  const res = await fetch("/api/auth/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? "Couldn't verify your password." };
  }

  const user = db.cloud?.currentUser.value;
  if (user?.userId && user?.accessToken) {
    await fetch(`${DEXIE_CLOUD_URL}/users/${user.userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user.accessToken}` },
    }).catch(() => {
      // Best-effort: if the server call fails, still remove the local copy below rather than
      // stranding the user unable to leave their own device.
    });
    await db.cloud.logout({ force: true }).catch(() => {});
  }

  const dbName = db.name;
  if (currentTrainingDbName() === dbName) closeTrainingDb();
  await Dexie.delete(dbName);
  await forgetKnownAccount(knownAccountId);
  return { ok: true };
}
