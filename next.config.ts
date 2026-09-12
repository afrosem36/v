import type { NextConfig } from "next";
import { execSync } from "node:child_process";

function getLastCommitISO(): string {
  try {
    return execSync("git log -1 --format=%cI").toString().trim();
  } catch {
    return new Date().toISOString();
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_LAST_COMMIT_ISO: getLastCommitISO(),
  },
  // Lets the dev server be reached from another device on the same network (e.g. testing the PWA
  // on a phone via its LAN IP) — dev-only, next build/start ignores this.
  allowedDevOrigins: ["192.168.29.6"],
};

export default nextConfig;
