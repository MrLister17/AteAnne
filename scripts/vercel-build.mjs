#!/usr/bin/env node
// Vercel build: generate the Prisma client, apply migrations for PRODUCTION
// deployments (or when MIGRATE_ON_BUILD=1, e.g. a preview with its own
// database branch), then build Next.js. Preview builds never migrate the
// production database by default.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const required = ["DATABASE_URL", "JOIN_CODE_HASH_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n✖ Missing environment variables: ${missing.join(", ")}.\n  Add them in Vercel → Project → Settings → Environment Variables (see docs/deploy-vercel.md).\n`);
  process.exit(1);
}
if ((process.env.JOIN_CODE_HASH_KEY ?? "").length < 32) {
  console.error("\n✖ JOIN_CODE_HASH_KEY must be at least 32 characters (use: openssl rand -base64 32).\n");
  process.exit(1);
}

run("npx prisma generate");
if (process.env.VERCEL_ENV === "production" || process.env.MIGRATE_ON_BUILD === "1") {
  console.log("Applying database migrations…");
  run("npx prisma migrate deploy");
} else {
  console.log(`Skipping migrations for VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} (set MIGRATE_ON_BUILD=1 to enable).`);
}
run("npx next build");
