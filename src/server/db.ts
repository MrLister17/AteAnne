import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { config } from "./config";

export type Db = PrismaClient;
/** Interactive-transaction client. */
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const globalForPrisma = globalThis as unknown as { __ateannePrisma?: PrismaClient };

export function createPrisma(url = config().DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** One client per process (survives Next.js dev hot reloads). */
export function prisma(): PrismaClient {
  if (!globalForPrisma.__ateannePrisma) globalForPrisma.__ateannePrisma = createPrisma();
  return globalForPrisma.__ateannePrisma;
}
