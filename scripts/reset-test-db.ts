/** Truncate the TEST database only. Refuses if it equals DATABASE_URL or NODE_ENV=production. */
import "dotenv/config";
import { createPrisma } from "../src/server/db";

const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
  console.error("Refusing: TEST_DATABASE_URL must be set, differ from DATABASE_URL, and NODE_ENV must not be production.");
  process.exit(1);
}
const db = createPrisma(url);
const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
console.log(`Truncated ${tables.length} tables in the test database.`);
await db.$disconnect();
