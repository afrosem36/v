import { NextResponse } from "next/server";
import { createAccount, findAccountByEmail } from "@/lib/server/accountsDb";
import { hashPassword, passwordProblem, isValidEmail } from "@/lib/server/passwordHash";
import { promoteUserToProduction } from "@/lib/server/dexieCloudToken";
import { newId } from "@/lib/utils/id";

export const runtime = "nodejs";

/**
 * Creates the Postgres account row only — email + password hash. Nothing else. The client logs
 * in immediately afterward through the normal /api/auth/token path, which is what actually gets
 * them a Dexie Cloud session; keeping that as one shared path means signup and login can never
 * drift into two different definitions of "a valid session".
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!isValidEmail(email)) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  const pwProblem = passwordProblem(password);
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

  if (await findAccountByEmail(email)) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const id = newId("user");
  const { hash, salt } = await hashPassword(password);
  await createAccount({ id, email, passwordHash: hash, passwordSalt: salt });

  const promotion = await promoteUserToProduction(id);
  if (!promotion.ok) {
    // Not fatal — see promoteUserToProduction's own comment. Logged so a real capacity problem
    // (free tier's 3 seats already spoken for) is visible in server logs rather than silent.
    console.error(`[signup] Couldn't promote ${id} to prod: ${promotion.error}`);
  }

  return NextResponse.json({ ok: true });
}
