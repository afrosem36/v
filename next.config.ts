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
};

export default nextConfig;
