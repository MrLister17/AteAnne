import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db";

/** Storage port for private images. Swap for an object-storage adapter in production. */
export interface PrivateStorage {
  put(bytes: Buffer, extension: "jpg" | "png"): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-f0-9]{48}\.(jpg|png)$/;

function newKey(extension: "jpg" | "png"): string {
  return `${randomBytes(24).toString("hex")}.${extension}`;
}

/**
 * Local-disk adapter. Keys are random (no user input in paths), validated
 * against a strict pattern and resolved inside the root, so path traversal is
 * impossible. The root must live outside public/ and on a persistent volume.
 */
export class LocalDiskStorage implements PrivateStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    if (this.root.split(path.sep).includes("public")) throw new Error("PRIVATE_UPLOAD_DIR must not be inside public/");
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key.slice(0, 2), key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(bytes: Buffer, extension: "jpg" | "png"): Promise<string> {
    const key = newKey(extension);
    const full = this.pathFor(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, full);
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/**
 * PostgreSQL adapter (default). Stores re-encoded image bytes in the private
 * `AssetBlob` table, so serverless hosts with no persistent disk (Vercel) need
 * only a database, and one `pg_dump` backs up money and images together.
 * Images are ~0.1–1.5 MB after re-encoding; fine for small-group events.
 */
export class DatabaseStorage implements PrivateStorage {
  constructor(private readonly db: Db) {}

  async put(bytes: Buffer, extension: "jpg" | "png"): Promise<string> {
    const key = newKey(extension);
    await this.db.assetBlob.create({ data: { key, bytes: new Uint8Array(bytes) } });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const row = await this.db.assetBlob.findUnique({ where: { key } });
    if (!row) throw new Error("Missing image bytes");
    return Buffer.from(row.bytes);
  }

  async delete(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) return;
    await this.db.assetBlob.deleteMany({ where: { key } });
  }
}
