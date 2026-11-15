import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Migrations prefer a direct (unpooled) connection when the host provides one
 * (e.g. Neon/Vercel Postgres: DATABASE_URL_UNPOOLED). `prisma generate` needs no
 * database, so a missing URL is allowed here; `migrate` will fail loudly instead.
 */
const url = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  ...(url ? { datasource: { url } } : {}),
});
