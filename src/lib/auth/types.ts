import type { Gender, Id, TrainingGoal } from "@/types/domain";

export type { Gender };

/**
 * A device-local pointer to an account this browser has used before — just enough to draw a
 * "continue as..." chip without opening every candidate database. It is NOT a security
 * boundary: identity is proven by Dexie Cloud's own email-code login (see db.cloud in db.ts),
 * never by anything stored here. Losing or tampering with this row only loses the shortcut, not
 * access to anyone's data.
 */
export interface KnownAccount {
  id: Id;
  email: string;
  name: string;
  dbName: string;
  lastLoginAt: string | null;
}

export interface ProfileInput {
  name: string;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  goal: TrainingGoal | null;
  heightCm: number | null;
  weightKg: number | null;
}
