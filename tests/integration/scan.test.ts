/** Photo → draft: authorization, phase gate, normalization, no persistence of receipts. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { AppContainer } from "@/server/container";
import { DatabaseStorage } from "@/server/storage/PrivateStorage";
import { RetentionPolicy } from "@/domain/event/RetentionPolicy";
import { FakeReceiptReader, ReceiptReadError, type ReceiptReader } from "@/server/scan/ReceiptReader";
import { eventWith, makeApp, newActor, resetDb, TEST_KEY } from "./helpers";

const { db } = makeApp();
const app = new AppContainer(db, new DatabaseStorage(db), TEST_KEY, new RetentionPolicy(30), new FakeReceiptReader());
let photo: Buffer;

beforeAll(async () => {
  await resetDb(db);
  photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#fff" } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "GPS-SECRET" } } }).toBuffer();
});
afterAll(async () => db.$disconnect());

describe("receipt scanning", () => {
  it("returns a reconciled draft and saves nothing", async () => {
    const e = await eventWith(app, ["Mark", "Juan"]);
    const draft = await app.scans.scan(e.people.Juan.actorId, e.eventId, photo);
    expect(draft.label).toBe("Sample Diner (demo scan)");
    expect(draft.lines.map((l) => l.amount)).toEqual(["32000", "10500", "18000"]);
    expect(draft.adjustments).toEqual([{ kind: "SERVICE", label: "Service charge", amount: "6050" }]);
    expect(draft.payable).toBe("66550");
    expect(draft.reconciled).toBe(true);
    expect(await db.receipt.count({ where: { eventId: e.eventId } })).toBe(0);
    expect(await db.auditEvent.count({ where: { eventId: e.eventId, type: "receipt.scanned" } })).toBe(1);
  });

  it("sends the reader a re-encoded image without metadata", async () => {
    let seen: Buffer | null = null;
    const spy: ReceiptReader = { read: async (img) => ((seen = img), new FakeReceiptReader().read()) };
    const spyApp = new AppContainer(db, new DatabaseStorage(db), TEST_KEY, new RetentionPolicy(30), spy);
    const e = await eventWith(spyApp, ["Ana"]);
    await spyApp.scans.scan(e.people.Ana.actorId, e.eventId, photo);
    expect(photo.includes(Buffer.from("GPS-SECRET"))).toBe(true);
    expect(seen!.includes(Buffer.from("GPS-SECRET"))).toBe(false);
    const meta = await sharp(seen!).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
  });

  it("non-members, wrong phase, non-images and unreadable photos are refused", async () => {
    const e = await eventWith(app, ["Owner"]);
    await expect(app.scans.scan(await newActor(app), e.eventId, photo)).rejects.toThrow(/not found/i);
    await expect(app.scans.scan(e.people.Owner.actorId, e.eventId, Buffer.from("not an image"))).rejects.toThrow(/JPEG, PNG or WebP/);
    const failing: ReceiptReader = { read: async () => { throw new ReceiptReadError("not_a_receipt", "That doesn’t look like a readable receipt."); } };
    const failApp = new AppContainer(db, new DatabaseStorage(db), TEST_KEY, new RetentionPolicy(30), failing);
    await expect(failApp.scans.scan(e.people.Owner.actorId, e.eventId, photo)).rejects.toMatchObject({ status: 422, code: "scan_not_a_receipt" });
    await db.event.update({ where: { id: e.eventId }, data: { phase: "SETTLING" } });
    await expect(app.scans.scan(e.people.Owner.actorId, e.eventId, photo)).rejects.toThrow(/Add & claim/);
  });

  it("is disabled when no reader is configured", async () => {
    const off = new AppContainer(db, new DatabaseStorage(db), TEST_KEY);
    const e = await eventWith(off, ["Paolo"]);
    expect(off.scans.enabled).toBe(false);
    expect((await off.queries.view(e.people.Paolo.actorId, e.eventId)).features.receiptScan).toBe(false);
    await expect(off.scans.scan(e.people.Paolo.actorId, e.eventId, photo)).rejects.toMatchObject({ status: 503 });
  });
});
