import "server-only";

/**
 * Mints a real Dexie Cloud session for a user this server has already verified — the
 * server-to-server half of Dexie Cloud's documented custom-auth pattern. client_id/secret come
 * from dexie-cloud.key (never sent to a browser); requesting one requires knowing them, which is
 * exactly what makes this safe to only ever call from a server.
 *
 * Endpoint and request shape confirmed against dexie-cloud-addon's own compiled source
 * (POST {databaseUrl}/token) and dexie-cloud-common's TokenRequest/TokenFinalResponse types —
 * not guessed from docs.
 */
export async function mintDexieCloudToken(params: { userId: string; email: string; publicKey: string }): Promise<unknown> {
  const databaseUrl = process.env.NEXT_PUBLIC_DEXIE_CLOUD_URL;
  const clientId = process.env.DEXIE_CLOUD_CLIENT_ID;
  const clientSecret = process.env.DEXIE_CLOUD_CLIENT_SECRET;
  if (!databaseUrl || !clientId || !clientSecret) {
    throw new Error("Dexie Cloud is not fully configured on this server.");
  }

  const res = await fetch(`${databaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      public_key: params.publicKey,
      scopes: ["ACCESS_DB"],
      claims: { sub: params.userId, email: params.email },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Dexie Cloud token request failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * New users authenticated via client_credentials default to a 30-day "eval" license — fine for
 * testing, but it would quietly expire a real account a month after signup. The free tier's 3
 * permanent "prod" seats have to be claimed with a separate, higher-privileged admin call; this
 * runs once, right after an account is created, so nobody ever hits that expiry.
 *
 * Best-effort by design: signup should not fail just because this couldn't run (e.g. the free
 * tier's 3-seat cap is already used) — the account still works under the eval grant, just with
 * the 30-day clock this call exists to avoid. Failures are surfaced via the return value so the
 * caller can log them without blocking signup.
 */
export async function promoteUserToProduction(userId: string): Promise<{ ok: boolean; error?: string }> {
  const databaseUrl = process.env.NEXT_PUBLIC_DEXIE_CLOUD_URL;
  const clientId = process.env.DEXIE_CLOUD_CLIENT_ID;
  const clientSecret = process.env.DEXIE_CLOUD_CLIENT_SECRET;
  if (!databaseUrl || !clientId || !clientSecret) {
    return { ok: false, error: "Dexie Cloud is not fully configured on this server." };
  }

  const adminTokenRes = await fetch(`${databaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scopes: ["ACCESS_DB", "GLOBAL_READ", "GLOBAL_WRITE"],
    }),
  });
  if (!adminTokenRes.ok) {
    return { ok: false, error: `Admin token request failed (${adminTokenRes.status}).` };
  }
  const adminToken = (await adminTokenRes.json()) as { accessToken?: string };
  if (!adminToken.accessToken) return { ok: false, error: "Admin token response had no accessToken." };

  const promoteRes = await fetch(`${databaseUrl}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken.accessToken}` },
    body: JSON.stringify([{ userId, type: "prod" }]),
  });
  if (!promoteRes.ok) {
    const body = await promoteRes.text().catch(() => promoteRes.statusText);
    return { ok: false, error: `Promotion to prod failed (${promoteRes.status}): ${body}` };
  }
  return { ok: true };
}
