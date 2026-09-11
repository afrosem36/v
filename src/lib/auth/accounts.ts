import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/utils/id";
import { LEGACY_DB_NAME, closeTrainingDb, currentTrainingDbName } from "@/lib/db/db";
import { hashPassword, randomSalt, safeEqual, isCryptoAvailable, INSECURE_CONTEXT_MESSAGE, DEFAULT_ITERATIONS } from "./crypto";
import { ADMIN_PASSWORD_RESETS } from "./admin-resets";
import type { AuthResult, SignUpInput, UserAccount } from "./types";

/**
 * The account registry. Shared across everyone on the device and deliberately tiny: emails,
 * password hashes, profile fields, and which training database belongs to whom.
 */
class AccountsDB extends Dexie {
  users!: EntityTable<UserAccount, "id">;

  constructor() {
    super("vshape-accounts");
    this.version(1).stores({ users: "id, &email, createdAt" });
  }
}

export const accountsDb = new AccountsDB();

const SESSION_KEY = "vshape.session.userId";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

/** Deliberately mild: this guards one person's gym log on their own phone, not a bank. */
export function passwordProblem(password: string): string | null {
  if (password.length < 6) return "Use at least 6 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

export async function listAccounts(): Promise<UserAccount[]> {
  return accountsDb.users.orderBy("createdAt").toArray();
}

export async function accountCount(): Promise<number> {
  return accountsDb.users.count();
}

export async function getAccount(id: string): Promise<UserAccount | undefined> {
  return accountsDb.users.get(id);
}

export async function findByEmail(email: string): Promise<UserAccount | undefined> {
  return accountsDb.users.where("email").equals(normalizeEmail(email)).first();
}

/**
 * The first account created on a device adopts the original "vshape" database, which is how
 * training data logged before accounts existed survives the upgrade. Everyone after that gets
 * a fresh, isolated database.
 */
async function nextDbName(): Promise<string> {
  const taken = new Set((await accountsDb.users.toArray()).map((u) => u.dbName));
  if (!taken.has(LEGACY_DB_NAME)) return LEGACY_DB_NAME;
  return `vshape-${newId("u").slice(2)}`;
}

export async function signUp(input: SignUpInput): Promise<AuthResult<UserAccount>> {
  if (!isCryptoAvailable()) return { ok: false, error: INSECURE_CONTEXT_MESSAGE };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: "That doesn't look like an email address." };
  if (!input.name.trim()) return { ok: false, error: "Your name is required." };

  const pwProblem = passwordProblem(input.password);
  if (pwProblem) return { ok: false, error: pwProblem };
  if (await findByEmail(email)) return { ok: false, error: "An account with that email already exists on this device." };

  const passwordSalt = randomSalt();
  const passwordHash = await hashPassword(input.password, passwordSalt);

  const user: UserAccount = {
    id: newId("user"),
    email,
    name: input.name.trim(),
    passwordHash,
    passwordSalt,
    iterations: DEFAULT_ITERATIONS,
    dbName: await nextDbName(),
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    phone: input.phone?.trim() || null,
    goal: input.goal,
    mustChangePassword: false,
    appliedResetAt: null,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };

  await accountsDb.users.add(user);
  return { ok: true, value: user };
}

export async function signIn(email: string, password: string): Promise<AuthResult<UserAccount>> {
  if (!isCryptoAvailable()) return { ok: false, error: INSECURE_CONTEXT_MESSAGE };

  const user = await findByEmail(email);
  // Same message either way — no probing for which emails have accounts.
  const genericFailure: AuthResult<UserAccount> = { ok: false, error: "Email or password is incorrect." };
  if (!user) return genericFailure;

  const attempt = await hashPassword(password, user.passwordSalt, user.iterations);
  if (!safeEqual(attempt, user.passwordHash)) return genericFailure;

  await accountsDb.users.update(user.id, { lastLoginAt: new Date().toISOString() });
  return { ok: true, value: { ...user, lastLoginAt: new Date().toISOString() } };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthResult<true>> {
  const user = await getAccount(userId);
  if (!user) return { ok: false, error: "Account not found." };

  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  const attempt = await hashPassword(currentPassword, user.passwordSalt, user.iterations);
  if (!safeEqual(attempt, user.passwordHash)) return { ok: false, error: "Current password is incorrect." };

  const passwordSalt = randomSalt();
  const passwordHash = await hashPassword(newPassword, passwordSalt);
  await accountsDb.users.update(userId, { passwordSalt, passwordHash, iterations: DEFAULT_ITERATIONS, mustChangePassword: false });
  return { ok: true, value: true };
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<UserAccount, "name" | "dateOfBirth" | "gender" | "phone" | "goal">>
): Promise<void> {
  await accountsDb.users.update(userId, patch);
}

export async function deleteAccount(userId: string): Promise<void> {
  const user = await getAccount(userId);
  if (!user) return;
  // An open connection would block the delete indefinitely.
  if (currentTrainingDbName() === user.dbName) closeTrainingDb();
  await Dexie.delete(user.dbName);
  await accountsDb.users.delete(userId);
  if (readSessionUserId() === userId) clearSession();
}

/**
 * Applies any password reset the maintainer added to admin-resets.ts. Runs on every boot;
 * `appliedResetAt` keeps a given reset from firing more than once.
 */
export async function applyAdminResets(): Promise<void> {
  if (ADMIN_PASSWORD_RESETS.length === 0 || !isCryptoAvailable()) return;

  for (const reset of ADMIN_PASSWORD_RESETS) {
    const user = await findByEmail(reset.email);
    if (!user || user.appliedResetAt === reset.issuedAt) continue;

    const passwordSalt = randomSalt();
    const passwordHash = await hashPassword(reset.newPassword, passwordSalt);
    await accountsDb.users.update(user.id, {
      passwordSalt,
      passwordHash,
      iterations: DEFAULT_ITERATIONS,
      mustChangePassword: true,
      appliedResetAt: reset.issuedAt,
    });
  }
}

// ---------------- Session persistence ----------------
// Just the account id: it names which local database to open, and the password hash it
// unlocks never leaves this device. Losing it to another script on the same origin would
// mean that script could already read IndexedDB directly.

export function readSessionUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeSession(userId: string): void {
  try {
    window.localStorage.setItem(SESSION_KEY, userId);
  } catch {
    // Private-mode storage refusal — the user stays signed in for this tab only.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to do
  }
}
