/**
 * S9.4c/S9.4d (D57): rate limits with limits switched ON (every other suite
 * disables them).
 * - Financial saves are counted before the event transaction, so a write
 *   never needs a second pool connection while the event row is locked.
 * - Wrong join codes and recovery keys never create browser identities.
 * - A 429 says how long to wait, in the body and as Retry-After.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { AppContainer } from "@/server/container";
import { postgresOptions } from "@/server/PostgresOptions";
import { RateLimitedError } from "@/server/http/HttpError";
import { route } from "@/server/http/route";
import { LocalDiskStorage } from "@/server/storage/PrivateStorage";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventWith, makeApp, newActor, pesos, resetDb, TEST_KEY } from "./helpers";

const { app, db } = makeApp();
// One connection only: if a rate-limit hit ran inside an event transaction it would wait for a second one and fail.
const single = new PrismaClient({ adapter: new PrismaPg({ ...postgresOptions(process.env.TEST_DATABASE_URL!), max: 1, connectionTimeoutMillis: 5_000 }) });
const singleApp = new AppContainer(single, new LocalDiskStorage(mkdtempSync(path.join(os.tmpdir(), "ateanne-rl-"))), TEST_KEY);

beforeAll(async () => {
  await resetDb(db);
  delete process.env.RATE_LIMIT_DISABLED;
});
afterAll(async () => {
  process.env.RATE_LIMIT_DISABLED = "1";
  await single.$disconnect();
  await db.$disconnect();
});

describe("financial saves with limits on", () => {
  it("receipt save, claims and a payment report all work on a one-connection pool", async () => {
    const e = await eventWith(singleApp, ["Mark", "Ana"]);
    const P = e.people;
    const { receiptId } = await singleApp.receipts.create(P.Mark.actorId, e.eventId, {
      label: "Breakfast",
      payerMemberId: P.Mark.memberId,
      payable: pesos(1397),
      equalSplit: true,
      lines: [{ label: "Silog", quantity: 1, amount: pesos(1397), mode: "SHARED" }],
      adjustments: [],
    });
    for (const n of ["Mark", "Ana"]) await singleApp.events.updateMe(P[n].actorId, e.eventId, { entryComplete: true });
    await singleApp.events.lockRoster(P.Mark.actorId, e.eventId);
    for (const n of ["Mark", "Ana"]) {
      const v = await singleApp.queries.view(P[n].actorId, e.eventId);
      await singleApp.receipts.saveClaims(P[n].actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: v.me.claimVersion, status: "finish", claims: [], acceptEqualSplit: true });
    }
    const view = await singleApp.queries.view(P.Ana.actorId, e.eventId);
    expect(view.event.phase).toBe("SETTLING");
    const edge = view.settlement!.edges[0];
    expect(edge.amount).toBe(pesos(698.5));
    const { reportId } = await singleApp.payments.report(P.Ana.actorId, edge.id, { amount: pesos(400), method: "CASH", idempotencyKey: "rl-single-connection" });
    expect(reportId).toBeTruthy();
  });

  it("the 31st save in a minute by one person in one event gets a 429 that says how long to wait", async () => {
    const e = await eventWith(app, ["Mark"]);
    const save = () =>
      app.receipts.create(e.people.Mark.actorId, e.eventId, { label: "R", payerMemberId: e.people.Mark.memberId, payable: "100", lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }], adjustments: [] });
    // Receipts are capped at 25 per event, so fill the rest of the budget with updates of the first one.
    const first = await save();
    let version = 1;
    for (let i = 1; i < 30; i++) {
      const r = await app.receipts.update(e.people.Mark.actorId, first.receiptId, { expectedVersion: version, label: `R${i}`, payerMemberId: e.people.Mark.memberId, payable: "100", lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }], adjustments: [] });
      version = r.version;
    }
    const err = await save().then(
      () => null,
      (x: unknown) => x,
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    const limited = err as RateLimitedError;
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(limited.message).toBe("Too many tries, try again in 1 minute");
  });
});

describe("join and recover never create identities for wrong attempts", () => {
  it("21 wrong codes from one IP: 429 with no new Actor or Session rows; a right code still joins", async () => {
    const e = await eventWith(app, ["Mark"]);
    const ip = "ip-flood";
    const created = { actors: 0 };
    const lazy = () => {
      created.actors++;
      return newActor(app);
    };
    const before = { actors: await db.actor.count(), sessions: await db.session.count() };
    for (let i = 0; i < 20; i++) await expect(app.events.join(lazy, { code: "WRONG-CODE1", displayName: "X" }, ip)).rejects.toThrow(/does not match/);
    await expect(app.events.join(lazy, { code: "WRONG-CODE1", displayName: "X" }, ip)).rejects.toBeInstanceOf(RateLimitedError);
    expect(created.actors).toBe(0);
    expect(await db.actor.count()).toBe(before.actors);
    expect(await db.session.count()).toBe(before.sessions);
    // Someone else, from another network, with the right code.
    const joined = await app.events.join(lazy, { code: e.joinCode, displayName: "Ana" }, "ip-home");
    expect(joined.memberId).toBeTruthy();
    expect(created.actors).toBe(1);
  });

  it("a wrong recovery key creates nothing", async () => {
    let created = 0;
    const lazy = () => {
      created++;
      return newActor(app);
    };
    const before = await db.actor.count();
    await expect(app.recovery.redeem(lazy, { key: "AA-thisisnotarealkeyatall0000000000000000" }, "ip-recover")).rejects.toThrow(/not valid/);
    expect(created).toBe(0);
    expect(await db.actor.count()).toBe(before);
  });
});

describe("429 responses", () => {
  it("carry Retry-After and the wait in the JSON body", async () => {
    const handler = route(async () => {
      throw new RateLimitedError(90);
    });
    const res = await handler(new NextRequest("http://localhost:3000/api/test"), { params: Promise.resolve({}) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 90, message: "Too many tries, try again in 2 minutes" });
  });
});
