import { execSync } from "node:child_process";
import "dotenv/config";
import { createPrisma } from "../../src/server/db";

/** Fresh, isolated E2E database (never the dev or production database). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  if (!url || url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set and differ from DATABASE_URL");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const db = createPrisma(url);
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.$disconnect();
}
