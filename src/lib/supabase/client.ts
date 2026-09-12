import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;

/**
 * A build-time on/off switch for the whole auth system, same role `DEXIE_CLOUD_URL` used to play
 * in db.ts: unset in any environment where Supabase hasn't been configured yet, in which case the
 * app falls back to a single implicit local account with no login (see AuthProvider's
 * `LocalOnlyGate`).
 */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Only constructed when both env vars are present — every caller must check `SUPABASE_CONFIGURED`
 * (or go through AuthGate, which already does) before touching this, since `createClient` throws
 * on an empty URL.
 */
export const supabase: SupabaseClient | null = SUPABASE_CONFIGURED
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string)
  : null;
