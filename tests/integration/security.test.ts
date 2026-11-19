/**
 * Authorization, isolation, concurrency, recovery and private-file checks
 * against real PostgreSQL. These are dishonest direct service calls — not
 * hidden buttons.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eventWith, makeApp, newActor, pesos, resetDb, TEST_KEY } from "./helpers";
import { AppContainer } from "@/server/container";
import { DatabaseStorage } from "@/server/storage/PrivateStorage";

const { app, db } = makeApp();

beforeAll(async () => resetDb(db));
afterAll(async () => db.$disconnect());

describe("event isolation and codes", () => {
  it("members of one event cannot read or write another", async () => {
    const a = await eventWith(app, ["Ana", "Ben"], "Pool party");
    const b = await eventWith(app, ["Cara"], "Lunch");
    await expect(app.queries.view(a.people.Ana.actorId, b.eventId)).rejects.toThrow(/not found/i);
    await expect(
      app.receipts.create(a.people.Ana.actorId, b.eventId, { label: "x", payerMemberId: a.people.Ana.memberId, payable: "100", lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }], adjustments: [] }),
    ).rejects.toThrow(/not found/i);
  });

  it("a payer must be on this event's roster (no foreign member IDs)", async () => {
    const a = await eventWith(app, ["Dan"]);
    const b = await eventWith(app, ["Eli"]);
    await expect(
      app.receipts.create(a.people.Dan.actorId, a.eventId, { label: "x", payerMemberId: b.people.Eli.memberId, payable: "100", lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }], adjustments: [] }),
    ).rejects.toThrow(/roster/);
  });

  it("join code grants no owner authority; rotated codes stop working", async () => {
    const e = await eventWith(app, ["Faye", "Gio"]);
    await expect(app.events.rotateCode(e.people.Gio.actorId, e.eventId)).rejects.toThrow(/organizer/);
    const { joinCode } = await app.events.rotateCode(e.people.Faye.actorId, e.eventId);
    const x = await newActor(app);
    await expect(app.events.join(x, { code: e.joinCode, displayName: "Old" }, "ip")).rejects.toThrow(/does not match/);
    await expect(app.events.join(x, { code: joinCode.toLowerCase(), displayName: "New" }, "ip")).resolves.toMatchObject({ eventId: e.eventId });
  });

  it("join code is stored only as an HMAC hash plus ciphertext", async () => {
    const e = await eventWith(app, ["Hana"]);
    const row = await db.event.findUniqueOrThrow({ where: { id: e.eventId } });
    expect(row.joinCodeHash).not.toContain(e.joinCode);
    expect(row.joinCodeCiphertext).not.toContain(e.joinCode);
    expect(JSON.stringify(row)).not.toContain(e.joinCode);
  });

  it("enforces the 20-person limit", async () => {
    const e = await eventWith(app, ["Owner"]);
    for (let i = 0; i < 19; i++) await app.events.join(await newActor(app), { code: e.joinCode, displayName: `P${i}` }, "ip");
    await expect(app.events.join(await newActor(app), { code: e.joinCode, displayName: "Too many" }, "ip")).rejects.toThrow(/20 people/);
  });
});

async function readyToClaim(e: Awaited<ReturnType<typeof eventWith>>, lines: { label: string; amount: number; qty: number; mode: "SHARED" | "UNITS" }[], payer = Object.keys(e.people)[0]) {
  const owner = Object.values(e.people)[0];
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const { receiptId } = await app.receipts.create(owner.actorId, e.eventId, {
    label: "Rice place",
    payerMemberId: e.people[payer].memberId,
    payable: pesos(total),
    lines: lines.map((l) => ({ label: l.label, quantity: l.qty, amount: pesos(l.amount), mode: l.mode })),
    adjustments: [],
  });
  await app.receipts.acknowledgeFunding(e.people[payer].actorId, receiptId, { receiptVersion: 1, amount: pesos(total) });
  for (const p of Object.values(e.people)) await app.events.updateMe(p.actorId, e.eventId, { entryComplete: true });
  await app.events.lockRoster(owner.actorId, e.eventId); // "Everyone's here"; nobody has claimed, so nothing freezes
  const view = await app.queries.view(owner.actorId, e.eventId);
  return { receiptId, lines: view.receipts[0].lines };
}

describe("claims", () => {
  it("concurrent unit claims can never over-allocate (409 for the loser)", async () => {
    const e = await eventWith(app, ["A", "B", "C", "D"]);
    const { receiptId, lines } = await readyToClaim(e, [{ label: "Rice", amount: 180, qty: 3, mode: "UNITS" }]);
    const results = await Promise.allSettled(
      ["A", "B", "C", "D"].map((n) => app.receipts.saveClaims(e.people[n].actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: 1, status: "finish", claims: [{ lineId: lines[0].id, units: 1 }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason.message)).toMatch(/Only 0 of 3/);
    const claims = await db.claim.findMany({ where: { lineId: lines[0].id } });
    expect(claims.reduce((a, c) => a + c.units, 0)).toBe(3);
  });

  it("nobody can save claims for another member (claims are always the caller's own)", async () => {
    const e = await eventWith(app, ["Owner2", "Guest2"]);
    const { receiptId, lines } = await readyToClaim(e, [{ label: "Meal", amount: 100, qty: 1, mode: "SHARED" }]);
    await app.receipts.saveClaims(e.people.Owner2.actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: 1, status: "finish", claims: [{ lineId: lines[0].id, units: 1 }] });
    const claims = await db.claim.findMany({ where: { lineId: lines[0].id } });
    expect(claims.map((c) => c.memberId)).toEqual([e.people.Owner2.memberId]);
    // stale claim version (another tab) → 409
    await expect(
      app.receipts.saveClaims(e.people.Owner2.actorId, receiptId, { receiptVersion: 1, expectedClaimVersion: 1, status: "none", claims: [] }),
    ).rejects.toThrow(/another tab/);
  });

  it("zero-basis service charge blocks review instead of splitting equally", async () => {
    const e = await eventWith(app, ["Z1", "Z2"]);
    const owner = e.people.Z1;
    const { receiptId } = await app.receipts.create(owner.actorId, e.eventId, {
      label: "Corkage",
      payerMemberId: owner.memberId,
      payable: "10100",
      lines: [
        { label: "Meal", quantity: 1, amount: "10000", mode: "SHARED" },
        { label: "Free water", quantity: 1, amount: "0", mode: "SHARED" },
      ],
      adjustments: [{ kind: "SERVICE", label: "Water service", amount: "100", eligibleLineIndexes: [1] }],
    });
    // Line-level basis is zero → entry reconciliation already flags it.
    const view = await app.queries.view(owner.actorId, e.eventId);
    expect(view.receipts.find((r) => r.id === receiptId)!.reconciliation.issues.join(" ")).toMatch(/cannot be split proportionally/);
  });
});

describe("recovery", () => {
  it("rebinds the same member, keeps their money, revokes the old browser", async () => {
    const e = await eventWith(app, ["Mark", "Juan"]);
    const juan = e.people.Juan;
    const { memberId, recoveryKey } = await (async () => {
      const a = await newActor(app);
      const r = await app.events.join(a, { code: (await app.events.rotateCode(e.people.Mark.actorId, e.eventId)).joinCode, displayName: "Paolo" }, "ip");
      return { memberId: r.memberId, recoveryKey: r.recoveryKey!, oldActor: a };
    })();
    const { receiptId } = await app.receipts.create(e.people.Mark.actorId, e.eventId, {
      label: "Snacks",
      payerMemberId: memberId,
      payable: "5000",
      lines: [{ label: "Chips", quantity: 1, amount: "5000", mode: "SHARED" }],
      adjustments: [],
    });
    const newBrowser = await newActor(app);
    const redeemed = await app.recovery.redeem(newBrowser, { key: recoveryKey }, "ip");
    expect(redeemed.memberId).toBe(memberId);
    const view = await app.queries.view(newBrowser, e.eventId);
    expect(view.me.memberId).toBe(memberId);
    expect(view.receipts.find((r) => r.id === receiptId)!.payerId).toBe(memberId);
    // Old key is single-use (rotated).
    await expect(app.recovery.redeem(await newActor(app), { key: recoveryKey }, "ip")).rejects.toThrow(/not valid/);
    // A browser that already controls a different member is refused, not merged.
    await expect(app.recovery.redeem(juan.actorId, { key: redeemed.recoveryKey }, "ip")).rejects.toThrow(/never merged/);
  });
});

describe("private images", () => {
  it("re-encodes, strips metadata, rejects non-images and blocks cross-event reads", async () => {
    const a = await eventWith(app, ["Img1", "Img2"]);
    const b = await eventWith(app, ["Other"]);
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff8800" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "SECRET-GPS-MARKER" } } })
      .toBuffer();
    expect(jpeg.includes(Buffer.from("SECRET-GPS-MARKER"))).toBe(true);
    // Payment QR is now the only image people upload (D54); it goes through the same safe pipeline.
    const { assetId } = await app.assets.upload(a.people.Img1.actorId, a.eventId, "QR", jpeg);
    const read = await app.assets.read(a.people.Img1.actorId, assetId);
    expect(read.mimeType).toBe("image/png");
    expect(read.bytes.includes(Buffer.from("SECRET-GPS-MARKER"))).toBe(false);
    await expect(app.assets.read(b.people.Other.actorId, assetId)).rejects.toThrow(/not found/i);
    await expect(app.assets.upload(a.people.Img1.actorId, a.eventId, "QR", Buffer.from("<svg onload=alert(1)></svg>"))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(app.assets.upload(a.people.Img1.actorId, a.eventId, "QR", Buffer.alloc(9 * 1024 * 1024))).rejects.toThrow(/8 MB/);
    const row = await db.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.storageKey).toMatch(/^[a-f0-9]{48}\.png$/);
  });

  it("new receipt photos are refused (410) and store nothing (D54)", async () => {
    const dbApp = new AppContainer(db, new DatabaseStorage(db), TEST_KEY);
    const e = await eventWith(dbApp, ["Np1", "Np2"]);
    const { receiptId } = await dbApp.receipts.create(e.people.Np1.actorId, e.eventId, {
      label: "Typed only",
      payerMemberId: e.people.Np1.memberId,
      payable: "100",
      lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }],
      adjustments: [],
    });
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#0a0" } }).jpeg().toBuffer();
    const assetsBefore = await db.asset.count();
    const blobsBefore = await db.assetBlob.count();
    await expect(dbApp.assets.upload(e.people.Np1.actorId, e.eventId, "RECEIPT", jpeg)).rejects.toMatchObject({ status: 410, code: "receipt_photos_off" });
    expect(await db.asset.count()).toBe(assetsBefore);
    expect(await db.assetBlob.count()).toBe(blobsBefore);
    expect((await db.receipt.findUniqueOrThrow({ where: { id: receiptId } })).imageAssetId).toBeNull();
  });

  it("an existing receipt photo still opens for members, not for others, and can be removed", async () => {
    const dbApp = new AppContainer(db, new DatabaseStorage(db), TEST_KEY);
    const e = await eventWith(dbApp, ["Db1", "Db2"]);
    const other = await eventWith(dbApp, ["Stranger"]);
    const { receiptId, storageKey, assetId } = await legacyPhoto(dbApp, e.eventId, e.people.Db1.actorId, e.people.Db1.memberId);
    expect(await db.assetBlob.count({ where: { key: storageKey } })).toBe(1);
    const read = await dbApp.assets.read(e.people.Db2.actorId, assetId);
    expect(read.mimeType).toBe("image/jpeg");
    expect(read.bytes.length).toBeGreaterThan(100);
    await expect(dbApp.assets.read(other.people.Stranger.actorId, assetId)).rejects.toThrow(/not found/i);
    await dbApp.assets.removeReceiptImage(e.people.Db1.actorId, receiptId);
    expect(await db.assetBlob.count({ where: { key: storageKey } })).toBe(0);
  });

  it("QR codes are visible only to their owner and people who owe them", async () => {
    const e = await eventWith(app, ["Q1", "Q2", "Q3"]);
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } }).png().toBuffer();
    const { assetId } = await app.assets.upload(e.people.Q1.actorId, e.eventId, "QR", png);
    await app.payments.setInstructions(e.people.Q1.actorId, e.eventId, { acceptsCash: true, keepQr: true }, assetId);
    await expect(app.assets.read(e.people.Q1.actorId, assetId)).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(app.assets.read(e.people.Q2.actorId, assetId)).rejects.toThrow(/not found/i);
  });

  // Last in this file: it runs the real cleanup job, which purges events older than 30 days.
  it("an existing receipt photo is deleted with its event by the 30-day purge", async () => {
    const dbApp = new AppContainer(db, new DatabaseStorage(db), TEST_KEY);
    const e = await eventWith(dbApp, ["Old1"]);
    const { storageKey } = await legacyPhoto(dbApp, e.eventId, e.people.Old1.actorId, e.people.Old1.memberId);
    await db.event.update({ where: { id: e.eventId }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const result = await dbApp.cleanup.run(new Date());
    expect(result.purgedEvents).toBe(1);
    expect(await db.assetBlob.count({ where: { key: storageKey } })).toBe(0);
    expect(await db.asset.count({ where: { eventId: e.eventId } })).toBe(0);
  });
});

/**
 * A receipt photo saved before v0.8.0, written straight to the database the way
 * the old upload did (the app no longer accepts new ones).
 */
async function legacyPhoto(dbApp: AppContainer, eventId: string, actorId: string, memberId: string) {
  const { receiptId } = await dbApp.receipts.create(actorId, eventId, {
    label: "Old photo receipt",
    payerMemberId: memberId,
    payable: "100",
    lines: [{ label: "x", quantity: 1, amount: "100", mode: "SHARED" }],
    adjustments: [],
  });
  const image = await dbApp.assets.process(await sharp({ create: { width: 40, height: 40, channels: 3, background: "#0a0" } }).jpeg().toBuffer(), "RECEIPT");
  const storageKey = await dbApp.storage.put(image.bytes, image.extension);
  const asset = await db.asset.create({ data: { eventId, ownerMemberId: memberId, kind: "RECEIPT", storageKey, mimeType: image.mimeType, byteSize: image.bytes.byteLength, width: image.width, height: image.height } });
  await db.receipt.update({ where: { id: receiptId }, data: { imageAssetId: asset.id } });
  return { receiptId, storageKey, assetId: asset.id };
}
