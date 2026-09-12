import type { Gender, Id, TrainingGoal } from "@/types/domain";

export type { Gender };

/**
 * A device-local pointer to a Supabase-authenticated identity this browser has used before —
 * just enough to know which local IndexedDB database belongs to which signed-in user, and to draw
 * a "signed in as..." label without opening every candidate database. It is NOT a security
 * boundary: identity is proven by Supabase's own session (see supabase.auth in
 * src/lib/supabase/client.ts), never by anything stored here. Losing or tampering with this row
 * only loses the local pointer, not access to anyone's data.
 */
export interface KnownAccount {
  id: Id;
  /** The Supabase auth user id — stable even if the person's Google email ever changes. */
  userId: string;
  email: string;
  name: string;
  dbName: string;
  lastLoginAt: string | null;
  /** Set once this device has completed the one-time initial push-up/pull-down handshake for this account. See src/lib/sync/bootstrap.ts. */
  syncBootstrappedAt?: string | null;
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
