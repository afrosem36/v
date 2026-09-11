/**
 * Finds Dexie Cloud users that have no matching row in the Postgres accounts table — the safe
 * definition of "test/orphaned account" for this app. Exists because of a real incident: an
 * earlier ad-hoc cleanup script decided what to delete by checking a single hardcoded email
 * literal, which meant a second, legitimate identity for that same real person (created later,
 * under the password system, with a different Dexie Cloud userId) looked exactly like a leftover
 * test account and got deleted by mistake.
 *
 * This script cannot make that mistake: it always cross-references the actual source of truth
 * (Postgres) before calling anything an orphan, and it never deletes anything without --delete
 * AND a second, explicit --yes-really-delete-all-orphans confirmation on the same command line.
 * Default behavior is report-only.
 *
 * Usage (from the repo root, with Node 20.6+ for --env-file support):
 *   node --env-file=.env.local scripts/dexie-cloud-orphans.mjs
 *   node --env-file=.env.local scripts/dexie-cloud-orphans.mjs --delete --yes-really-delete-all-orphans
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
const DEXIE_CLOUD_URL = process.env.NEXT_PUBLIC_DEXIE_CLOUD_URL;
const CLIENT_ID = process.env.DEXIE_CLOUD_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXIE_CLOUD_CLIENT_SECRET;

function requireEnv() {
  const missing = [
    !DATABASE_URL && "DATABASE_URL",
    !DEXIE_CLOUD_URL && "NEXT_PUBLIC_DEXIE_CLOUD_URL",
    !CLIENT_ID && "DEXIE_CLOUD_CLIENT_ID",
    !CLIENT_SECRET && "DEXIE_CLOUD_CLIENT_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}. Run with: node --env-file=.env.local ${process.argv[1]}`);
    process.exit(1);
  }
}

async function getAdminToken() {
  const res = await fetch(`${DEXIE_CLOUD_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scopes: ["ACCESS_DB", "GLOBAL_READ", "GLOBAL_WRITE"],
    }),
  });
  if (!res.ok) throw new Error(`Admin token request failed (${res.status}): ${await res.text()}`);
  const { accessToken } = await res.json();
  return accessToken;
}

async function getDexieCloudUsers(adminToken) {
  const res = await fetch(`${DEXIE_CLOUD_URL}/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!res.ok) throw new Error(`Listing users failed (${res.status}): ${await res.text()}`);
  const { data } = await res.json();
  return data;
}

async function getPostgresAccountIds() {
  const sql = neon(DATABASE_URL);
  const rows = await sql`SELECT id, email FROM accounts`;
  return { ids: new Set(rows.map((r) => r.id)), byId: new Map(rows.map((r) => [r.id, r.email])) };
}

async function main() {
  requireEnv();
  const deleteRequested = process.argv.includes("--delete");
  const confirmed = process.argv.includes("--yes-really-delete-all-orphans");

  const [adminToken, accounts] = await Promise.all([getAdminToken(), getPostgresAccountIds()]);
  const users = await getDexieCloudUsers(adminToken);

  const orphans = users.filter((u) => !accounts.ids.has(u.userId));
  const real = users.filter((u) => accounts.ids.has(u.userId));

  console.log(`Dexie Cloud users: ${users.length}`);
  console.log(`  Matched to a real Postgres account (kept, never touched): ${real.length}`);
  for (const u of real) console.log(`    - ${u.userId} (${accounts.byId.get(u.userId)}) [${u.type}]`);

  console.log(`  No matching Postgres account (orphan candidates): ${orphans.length}`);
  for (const u of orphans) console.log(`    - ${u.userId} [${u.type}], created ${u.created}, last login ${u.lastLogin}`);

  if (orphans.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!deleteRequested) {
    console.log("\nReport-only. Re-run with --delete --yes-really-delete-all-orphans to actually remove the orphans above.");
    return;
  }
  if (!confirmed) {
    console.log("\n--delete was given without --yes-really-delete-all-orphans — refusing to delete anything.");
    return;
  }

  for (const u of orphans) {
    const res = await fetch(`${DEXIE_CLOUD_URL}/users/${encodeURIComponent(u.userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log(`Deleted ${u.userId}: ${res.status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
