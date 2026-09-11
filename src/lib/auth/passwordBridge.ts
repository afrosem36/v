/**
 * Smuggles a password from an explicit login call into Dexie Cloud's `fetchTokens` callback
 * (see db.ts), which Dexie invokes internally and whose parameters we don't control — it only
 * hands back the device's public key, not whatever a UI collected. One-shot by design: read
 * once, then cleared, so a stale password can never be reused for a later silent token refresh
 * (those go through Dexie Cloud's own cached refresh token instead, no password involved).
 */
let pending: { email: string; password: string } | null = null;

export function setPendingCredentials(email: string, password: string): void {
  pending = { email, password };
}

export function takePendingCredentials(): { email: string; password: string } | null {
  const value = pending;
  pending = null;
  return value;
}
