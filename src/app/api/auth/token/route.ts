import { NextResponse } from "next/server";
import { findAccountByEmail } from "@/lib/server/accountsDb";
import { verifyPassword } from "@/lib/server/passwordHash";
import { mintDexieCloudToken } from "@/lib/server/dexieCloudToken";

export const runtime = "nodejs";

/**
 * The bridge: verifies a password against Postgres, then — only on success — mints a real
 * Dexie Cloud session bound to the device's public key. This is what fetchTokens (see db.ts)
 * calls on every sign-in; Dexie Cloud's own client library caches the resulting session locally
 * afterward, so this only runs again once that cache is gone (logout, or a new device).
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; publicKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const publicKey = body.publicKey ?? "";

  if (!email || !password || !publicKey) {
    return NextResponse.json({ error: "Missing email, password, or device key." }, { status: 400 });
  }

  const account = await findAccountByEmail(email);
  // Same generic message either way — no confirming which emails have accounts.
  const genericFailure = NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  if (!account) return genericFailure;

  const valid = await verifyPassword(password, account.password_hash, account.password_salt);
  if (!valid) return genericFailure;

  try {
    const token = await mintDexieCloudToken({ userId: account.id, email, publicKey });
    return NextResponse.json(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in is temporarily unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
