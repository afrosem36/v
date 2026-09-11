import { NextResponse } from "next/server";
import { findAccountByEmail, deleteAccountRow } from "@/lib/server/accountsDb";
import { verifyPassword } from "@/lib/server/passwordHash";

export const runtime = "nodejs";

/** Requires the password again — deleting the Postgres row is what frees the email up for reuse. */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const account = await findAccountByEmail(email);
  const genericFailure = NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  if (!account) return genericFailure;

  const valid = await verifyPassword(password, account.password_hash, account.password_salt);
  if (!valid) return genericFailure;

  await deleteAccountRow(email);
  return NextResponse.json({ ok: true });
}
