/**
 * Synthetic demo seed — the nine-person "Mark paid; Juan skipped the rice"
 * dinner from the specification, driven through the real services so every
 * rule is enforced. Prints a recovery key per person: open /recover in a
 * browser profile and paste one to become that person.
 *
 * Refuses to run when NODE_ENV=production unless ALLOW_PRODUCTION_SEED=1.
 * All names and amounts are synthetic; no real receipt data is used.
 */
import "dotenv/config";
import { AppContainer } from "../src/server/container";
import { createPrisma } from "../src/server/db";
import { LocalDiskStorage } from "../src/server/storage/PrivateStorage";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
  console.error("Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=1 only for a disposable demo.");
  process.exit(1);
}

const people = ["Mark", "Juan", "Ana", "Ben", "Carlo", "Dani", "Elle", "Franco", "Gina"];
const solo: Record<string, number> = { Mark: 35000, Juan: 25000, Ana: 30000, Ben: 40000, Carlo: 20000, Dani: 30000, Elle: 25000, Franco: 35000, Gina: 40000 };

async function main() {
  const db = createPrisma(process.env.DATABASE_URL!);
  const app = new AppContainer(db, new LocalDiskStorage(process.env.PRIVATE_UPLOAD_DIR ?? "./storage/uploads"), process.env.JOIN_CODE_HASH_KEY!);
  const process_ = { RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED };
  process.env.RATE_LIMIT_DISABLED = "1";

  const actors: Record<string, string> = {};
  const members: Record<string, string> = {};
  const keys: Record<string, string> = {};

  actors.Mark = (await app.sessions.issueForNewActor()).actorId;
  const created = await app.events.create(actors.Mark, { title: "Sample dinner (synthetic demo)", note: "Sample data for trying the app. Not real people or money.", displayName: "Mark", intent: "PAID_EXPENSE" });
  members.Mark = created.memberId;
  keys.Mark = created.recoveryKey;
  for (const name of people.slice(1)) {
    actors[name] = (await app.sessions.issueForNewActor()).actorId;
    const j = await app.events.join(actors[name], { code: created.joinCode, displayName: name }, "seed");
    members[name] = j.memberId;
    keys[name] = j.recoveryKey!;
  }

  const lines = [
    { label: "Shared dishes (kare-kare, sinigang, pancit)", quantity: 1, amount: "180000", mode: "SHARED" as const },
    { label: "Extra rice (3 bowls, shared by 8)", quantity: 3, amount: "18000", mode: "SHARED" as const },
    ...people.map((p) => ({ label: `${p}'s meal`, quantity: 1, amount: String(solo[p]), mode: "UNITS" as const })),
  ];
  const { receiptId } = await app.receipts.create(actors.Mark, created.eventId, {
    label: "Kusina (synthetic)",
    payerMemberId: members.Mark,
    payable: "525800",
    lines,
    adjustments: [{ kind: "SERVICE", label: "Service charge", amount: "47800", eligibleLineIndexes: null }],
  });
  await app.receipts.acknowledgeFunding(actors.Mark, receiptId, { receiptVersion: 1, amount: "525800" });
  for (const p of people) await app.events.updateMe(actors[p], created.eventId, { entryComplete: true });
  let view = await app.queries.view(actors.Mark, created.eventId);
  await app.events.transition(actors.Mark, created.eventId, { target: "ALLOCATING", expectedFinancialVersion: view.event.financialVersion });

  view = await app.queries.view(actors.Mark, created.eventId);
  const r = view.receipts[0];
  for (const p of people) {
    const mine = await app.queries.view(actors[p], created.eventId);
    const claims = [
      { lineId: r.lines[0].id, units: 1 },
      ...(p === "Juan" ? [] : [{ lineId: r.lines[1].id, units: 1 }]),
      { lineId: r.lines.find((l) => l.label === `${p}'s meal`)!.id, units: 1 },
    ];
    await app.receipts.saveClaims(actors[p], receiptId, { receiptVersion: r.version, expectedClaimVersion: mine.me.claimVersion, status: "finish", claims });
  }
  view = await app.queries.view(actors.Mark, created.eventId);
  await app.events.transition(actors.Mark, created.eventId, { target: "REVIEWING", expectedFinancialVersion: view.event.financialVersion });
  view = await app.queries.view(actors.Mark, created.eventId);

  console.log("\nSeeded SYNTHETIC demo event (now in Reviewing).");
  console.log("Nets (centavos):", Object.fromEntries(view.calculation.positions.map((p) => [view.members.find((m) => m.id === p.memberId)!.displayName, p.net])));
  console.log("\nTo act as someone: open http://localhost:3000/recover in a separate browser profile and paste their key.\n");
  for (const p of people) console.log(`${p.padEnd(7)} ${keys[p]}`);
  process.env.RATE_LIMIT_DISABLED = process_.RATE_LIMIT_DISABLED;
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
