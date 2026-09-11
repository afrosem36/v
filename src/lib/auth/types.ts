import type { Id, TrainingGoal } from "@/types/domain";

export type Gender = "male" | "female" | "other" | "unspecified";

/**
 * One row per person who can log in on this device. Training data never lives here — each
 * account points at its own IndexedDB database via `dbName`.
 */
export interface UserAccount {
  id: Id;
  /** Lower-cased, trimmed. Unique. */
  email: string;
  name: string;
  /** PBKDF2-SHA256, base64. Never logged, never exported. */
  passwordHash: string;
  passwordSalt: string;
  iterations: number;
  dbName: string;
  dateOfBirth: string | null; // yyyy-mm-dd
  gender: Gender;
  phone: string | null;
  goal: TrainingGoal | null;
  /** Set when a password came from an admin reset — the app asks them to change it at next login. */
  mustChangePassword: boolean;
  /** `issuedAt` of the last admin reset already applied, so the same reset isn't re-applied forever. */
  appliedResetAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  goal: TrainingGoal | null;
  heightCm: number | null;
  weightKg: number | null;
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: string };
