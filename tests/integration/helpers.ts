import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppContainer } from "@/server/container";
import { createPrisma } from "@/server/db";
import { LocalDiskStorage } from "@/server/storage/PrivateStorage";

export const TEST_KEY = "integration-test-join-code-hash-key-0123456789";

export function makeApp() {
  const db = createPrisma(process.env.TEST_DATABASE_URL!);
  const dir = mkdtempSync(path.join(os.tmpdir(), "ateanne-uploads-"));
  return { app: new AppContainer(db, new LocalDiskStorage(dir), TEST_KEY), db, dir };
}

export async function resetDb(db: ReturnType<typeof createPrisma>) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function newActor(app: AppContainer) {
  return (await app.sessions.issueForNewActor()).actorId;
}

export const pesos = (p: number) => String(Math.round(p * 100));

/** Owner + guests joined to one event. */
export async function eventWith(app: AppContainer, names: string[], title = "Dinner") {
  const owner = await newActor(app);
  const created = await app.events.create(owner, { title, displayName: names[0], intent: "PAID_EXPENSE" });
  const people: Record<string, { actorId: string; memberId: string }> = { [names[0]]: { actorId: owner, memberId: created.memberId } };
  for (const n of names.slice(1)) {
    const a = await newActor(app);
    const j = await app.events.join(a, { code: created.joinCode, displayName: n }, "ip");
    people[n] = { actorId: a, memberId: j.memberId };
  }
  return { eventId: created.eventId, joinCode: created.joinCode, people, owner };
}

export async function version(app: AppContainer, eventId: string, actorId: string) {
  return (await app.queries.view(actorId, eventId)).event.financialVersion;
}
