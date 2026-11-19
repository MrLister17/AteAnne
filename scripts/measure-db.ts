/**
 * Development-only database measurement (Sprint S9.4a).
 *
 * Builds one realistic synthetic event on the TEST database and records, for
 * the hot operations, how many SQL statements run, how long they take, how
 * many pool connections are checked out at the same time and how big the
 * JSON answer is. Nothing here is estimated: the numbers come from Prisma's
 * query events and node-postgres pool events.
 *
 *   npx tsx scripts/measure-db.ts            # prints a Markdown table
 *
 * Refuses to run against anything that is not a local *_test database, and
 * purges the synthetic event it created when it finishes.
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { AppContainer } from "../src/server/container";
import { postgresOptions } from "../src/server/PostgresOptions";
import { DatabaseStorage } from "../src/server/storage/PrivateStorage";

const url = process.env.TEST_DATABASE_URL ?? "";
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!dbName.endsWith("_test") || /supabase|pooler|neon\.tech|vercel/i.test(url)) {
  console.error("Refusing to run: TEST_DATABASE_URL must be a local *_test database.");
  process.exit(1);
}

const pool = new pg.Pool(postgresOptions(url));
let checkedOut = 0;
let maxCheckedOut = 0;
pool.on("acquire", () => {
  checkedOut++;
  maxCheckedOut = Math.max(maxCheckedOut, checkedOut);
});
pool.on("release", () => {
  checkedOut = Math.max(0, checkedOut - 1);
});

const db = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: "event", level: "query" }] });
let statements = 0;
db.$on("query", () => {
  statements++;
});
const app = new AppContainer(db, new DatabaseStorage(db), "measure-only-not-secret-join-code-hash-key-0123456789");

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const rows: { op: string; statements: number; ms: number; maxConnections: number; bytes: number | null }[] = [];

async function measure<T>(op: string, fn: () => Promise<T>, withBytes = false): Promise<T> {
  statements = 0;
  maxCheckedOut = checkedOut;
  const t0 = performance.now();
  const out = await fn();
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  rows.push({ op, statements, ms, maxConnections: maxCheckedOut, bytes: withBytes ? Buffer.byteLength(json(out)) : null });
  return out;
}

async function main() {
  // Setup runs without limits so it never trips the 30-saves-a-minute rule; measured writes run with limits ON.
  process.env.RATE_LIMIT_DISABLED = "1";
  const names = ["Mark", "Juan", "Paolo", "Ana", "Bea", "Carlo", "Dina", "Eli", "Fe", "Gio"];
  const ownerActor = (await app.sessions.issueForNewActor()).actorId;
  const created = await app.events.create(ownerActor, { title: "Measure trip", displayName: names[0], intent: "PAID_EXPENSE" });
  const people = [{ name: names[0], actorId: ownerActor, memberId: created.memberId }];
  for (const n of names.slice(1)) {
    const actorId = (await app.sessions.issueForNewActor()).actorId;
    const j = await app.events.join(actorId, { code: created.joinCode, displayName: n }, `ip-${n}`);
    people.push({ name: n, actorId, memberId: j.memberId });
  }
  const eventId = created.eventId;
  try {
    await run(eventId, ownerActor, people);
  } finally {
    process.env.RATE_LIMIT_DISABLED = "1";
    await db.$transaction((tx) => app.events.purge(tx, eventId));
  }
}

type Person = { name: string; actorId: string; memberId: string };

async function run(eventId: string, ownerActor: string, people: Person[]) {

  // 10 receipts × 8 lines, each paid (and so funding-confirmed) by its author.
  const receiptIds: string[] = [];
  for (let r = 0; r < 10; r++) {
    const payer = people[r % 4];
    // Every third line is sold by the piece (2 pieces, claimed by the first two people); the rest are shared.
    const lines = Array.from({ length: 8 }, (_, i) => ({ label: `Item ${r}-${i}`, quantity: i % 3 === 0 ? 2 : 1, amount: String(10_000 + i * 1_250), mode: (i % 3 === 0 ? "UNITS" : "SHARED") as "UNITS" | "SHARED" }));
    const payable = String(lines.reduce((a, l) => a + Number(l.amount), 0));
    const { receiptId } = await app.receipts.create(payer.actorId, eventId, { label: `Receipt ${r + 1}`, payerMemberId: payer.memberId, payable, lines, adjustments: [] });
    receiptIds.push(receiptId);
  }

  const claimAll = async (p: Person, receiptId: string) => {
    const view = await app.queries.view(p.actorId, eventId);
    const r = view.receipts.find((x) => x.id === receiptId)!;
    const idx = people.indexOf(p);
    const claims = r.lines.filter((l) => l.mode === "SHARED" || idx < l.quantity).map((l) => ({ lineId: l.id, units: 1 }));
    return app.receipts.saveClaims(p.actorId, receiptId, { receiptVersion: r.version, expectedClaimVersion: view.me.claimVersion, status: "finish", claims });
  };
  for (const p of people.slice(0, -1)) for (const rid of receiptIds) await claimAll(p, rid);
  const last = people[people.length - 1];
  for (const rid of receiptIds.slice(0, -1)) await claimAll(last, rid);
  for (const p of people) await app.events.updateMe(p.actorId, eventId, { entryComplete: true });

  // ---- Step 1 measurements (bill not frozen yet). Limits ON.
  delete process.env.RATE_LIMIT_DISABLED;
  await measure("Open event (step 1, member)", () => app.queries.view(last.actorId, eventId), true);
  await measure("Save claims (step 1)", () => claimAll(last, receiptIds[receiptIds.length - 1]));
  process.env.RATE_LIMIT_DISABLED = "1";
  await app.events.lockRoster(ownerActor, eventId); // closes joining; everyone is done → freezes by itself
  const frozen = await app.queries.view(ownerActor, eventId);
  if (frozen.event.phase !== "SETTLING") throw new Error(`expected SETTLING, got ${frozen.event.phase}: ${(frozen.gates.freeze?.blockers ?? []).slice(0, 5).join(" | ")}`);

  // Partial payments on every transfer, then confirm most of them.
  const edges = frozen.settlement!.edges;
  const actorOf = (memberId: string) => people.find((p) => p.memberId === memberId)!.actorId;
  const reportIds: { reportId: string; to: string }[] = [];
  for (const e of edges.slice(1)) {
    const half = (BigInt(e.amount) / 2n).toString();
    const { reportId } = await app.payments.report(actorOf(e.from), e.id, { amount: half, method: "CASH", note: "", idempotencyKey: `m-${e.id}` });
    reportIds.push({ reportId, to: e.to });
  }
  for (const r of reportIds.slice(1)) await app.payments.verify(actorOf(r.to), r.reportId, { expectedVersion: 1 });

  // ---- Step 2 measurements. Limits ON.
  delete process.env.RATE_LIMIT_DISABLED;
  const view2 = await measure("Open event (step 2, organizer)", () => app.queries.view(ownerActor, eventId), true);
  const target = view2.settlement!.edges[0];
  const rep = await measure("Report a payment", () => app.payments.report(actorOf(target.from), target.id, { amount: "100", method: "CASH", note: "", idempotencyKey: "m-measured" }));
  await measure("Confirm a payment", () => app.payments.verify(actorOf(target.to), rep.reportId, { expectedVersion: 1 }));
  await measure("Confirm a payment (from list)", () => app.payments.verify(actorOf(reportIds[0].to), reportIds[0].reportId, { expectedVersion: 1 }));

  console.log(`\nEvent: 10 people, 10 receipts × 8 lines, ${edges.length} transfers, ${reportIds.length + 1} payment reports. PostgreSQL ${dbName}.\n`);
  console.log("| Operation | SQL statements | Time (ms, local) | Max pool connections at once | JSON bytes |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const r of rows) console.log(`| ${r.op} | ${r.statements} | ${r.ms} | ${r.maxConnections} | ${r.bytes ?? "—"} |`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end().catch(() => undefined);
  });
