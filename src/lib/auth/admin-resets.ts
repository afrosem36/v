/**
 * ── HOW TO RESET SOMEONE'S PASSWORD ──────────────────────────────────────────────────────
 *
 * There is no server, so nobody can email a reset link. When someone messages the support
 * number (see support.ts) because they're locked out:
 *
 *   1. Add an entry below with their email, a new password you make up, and today's date.
 *   2. Commit + deploy (or just `npm run build` for a local install).
 *   3. Tell them the new password over WhatsApp.
 *
 * Next time they open the app on that device, the reset is applied automatically and they are
 * asked to change the password to something only they know. `issuedAt` is what makes a reset
 * fire exactly once — bump it to re-issue a password for the same person later.
 *
 * Entries only work on a device where that account already exists; an account lives on the
 * phone it was created on. Leave the array empty in normal operation.
 */
export interface AdminPasswordReset {
  email: string;
  newPassword: string;
  /** ISO date, e.g. "2026-09-11". Changing this re-applies the reset. */
  issuedAt: string;
}

export const ADMIN_PASSWORD_RESETS: AdminPasswordReset[] = [
  // { email: "friend@example.com", newPassword: "Gym-2026-temp", issuedAt: "2026-09-11" },
];
