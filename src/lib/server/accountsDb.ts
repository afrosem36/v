import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * The ONLY thing stored in Postgres: email + password hash. Every other piece of user data
 * (name, workouts, settings, everything) lives in Dexie Cloud, never here. This table exists
 * purely so a password can be verified from any device, which is the one thing a local-only
 * IndexedDB store structurally cannot do.
 */
function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}

let migrated = false;

async function ensureSchema(): Promise<void> {
  if (migrated) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  migrated = true;
}

export interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export async function findAccountByEmail(email: string): Promise<AccountRow | null> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`SELECT * FROM accounts WHERE email = ${email} LIMIT 1`) as AccountRow[];
  return rows[0] ?? null;
}

export async function createAccount(input: { id: string; email: string; passwordHash: string; passwordSalt: string }): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db`
    INSERT INTO accounts (id, email, password_hash, password_salt)
    VALUES (${input.id}, ${input.email}, ${input.passwordHash}, ${input.passwordSalt})
  `;
}

export async function deleteAccountRow(email: string): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db`DELETE FROM accounts WHERE email = ${email}`;
}
