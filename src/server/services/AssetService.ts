import sharp, { type Metadata } from "sharp";
import { ConflictError, PermissionError, ValidationError } from "@/domain/errors";
import type { Db } from "../db";
import { HttpError, NotFoundError } from "../http/HttpError";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import type { PrivateStorage } from "../storage/PrivateStorage";
import { BaseService } from "./BaseService";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 20_000_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export interface ProcessedImage {
  bytes: Buffer;
  extension: "jpg" | "png";
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Private receipt and QR images. Bytes are sniffed by actually decoding them
 * (the declared MIME type is ignored), limited by size and pixel count,
 * re-encoded — which strips EXIF/GPS and any embedded payload — and stored
 * under a random key outside public/. Reads are authorised per event.
 */
export class AssetService extends BaseService {
  constructor(
    db: Db,
    private readonly storage: PrivateStorage,
    private readonly limiter: RateLimiter,
  ) {
    super(db);
  }

  async process(input: Buffer, kind: "RECEIPT" | "QR"): Promise<ProcessedImage> {
    if (input.byteLength === 0) throw new ValidationError("empty_file", "The file is empty");
    if (input.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large", "Images must be 8 MB or smaller");
    let meta: Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new ValidationError("not_an_image", "Only JPEG, PNG or WebP photos are accepted");
    }
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new ValidationError("bad_format", "Only JPEG, PNG or WebP photos are accepted");
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) throw new HttpError(413, "too_many_pixels", "Images must be 20 megapixels or smaller");
    try {
      // .rotate() applies EXIF orientation; re-encoding without withMetadata() drops all metadata.
      const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true });
      const { data, info } =
        kind === "QR"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) // lossless keeps QR modules crisp
          : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      return { bytes: data, extension: kind === "QR" ? "png" : "jpg", mimeType: kind === "QR" ? "image/png" : "image/jpeg", width: info.width, height: info.height };
    } catch {
      throw new ValidationError("decode_failed", "That image could not be read safely");
    }
  }

  /** Upload and attach. RECEIPT → receipt image (author/payer/organizer); QR → caller's own instructions. */
  async upload(actorId: string, eventId: string, kind: "RECEIPT" | "QR", file: Buffer, receiptId?: string): Promise<{ assetId: string }> {
    // Authorise before doing expensive decoding.
    const member = await this.db.member.findFirst({ where: { eventId, actorId, active: true } });
    if (!member) throw new NotFoundError("Event not found");
    await this.limiter.hit(RATE_RULES.uploadsPerMember, member.id);
    const image = await this.process(file, kind);
    const key = await this.storage.put(image.bytes, image.extension);
    try {
      return await this.inEvent(actorId, eventId, async ({ tx, agg, me }) => {
        if (agg.phase === "DONE") throw new ConflictError("event_done", "Done events are read-only");
        let replaced: string | null = null;
        if (kind === "RECEIPT") {
          if (!receiptId) throw new ValidationError("receipt_required", "Choose the receipt this photo belongs to");
          const r = agg.receipt(receiptId);
          if (r.authorMemberId !== me.id && r.payerMemberId !== me.id && !agg.isOwner(me.id)) {
            throw new PermissionError("not_author", "Only the author, payer or organizer can attach a photo");
          }
          replaced = r.imageAssetId;
        }
        const asset = await tx.asset.create({
          data: { eventId, ownerMemberId: me.id, kind, storageKey: key, mimeType: image.mimeType, byteSize: image.bytes.byteLength, width: image.width, height: image.height },
        });
        if (kind === "RECEIPT") {
          await tx.receipt.update({ where: { id: receiptId! }, data: { imageAssetId: asset.id } });
          if (replaced) {
            const old = await tx.asset.delete({ where: { id: replaced } });
            await this.storage.delete(old.storageKey).catch(() => undefined);
          }
        }
        await this.audit(tx, eventId, me.id, "asset.uploaded", { kind, assetId: asset.id, receiptId: receiptId ?? null });
        return { assetId: asset.id };
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined); // never leave orphaned bytes on failure
      throw e;
    }
  }

  async removeReceiptImage(actorId: string, receiptId: string): Promise<void> {
    const r = await this.db.receipt.findUnique({ where: { id: receiptId }, select: { eventId: true } });
    if (!r) throw new NotFoundError("Receipt not found");
    const key = await this.inEvent(actorId, r.eventId, async ({ tx, agg, me }) => {
      const receipt = agg.receipt(receiptId);
      if (receipt.authorMemberId !== me.id && receipt.payerMemberId !== me.id && !agg.isOwner(me.id)) throw new PermissionError("not_author", "Not allowed");
      if (!receipt.imageAssetId) return null;
      await tx.receipt.update({ where: { id: receiptId }, data: { imageAssetId: null } });
      const asset = await tx.asset.delete({ where: { id: receipt.imageAssetId } });
      await this.audit(tx, r.eventId, me.id, "asset.removed", { receiptId });
      return asset.storageKey;
    });
    if (key) await this.storage.delete(key).catch(() => undefined);
  }

  /**
   * Authorised read. Receipt photos: any active member of the same event.
   * QR codes: the owner, or a member who owes the owner on an active
   * settlement edge (plus anyone the owner's QR is attached to a report for).
   */
  async read(actorId: string, assetId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const asset = await this.db.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundError();
    const me = await this.db.member.findFirst({ where: { eventId: asset.eventId, actorId, active: true } });
    if (!me) throw new NotFoundError();
    if (asset.kind === "QR" && asset.ownerMemberId !== me.id) {
      const owes = await this.db.settlementEdge.findFirst({
        where: { fromMemberId: me.id, toMemberId: asset.ownerMemberId, snapshot: { status: "ACTIVE", eventId: asset.eventId } },
      });
      if (!owes) throw new NotFoundError();
    }
    return { bytes: await this.storage.get(asset.storageKey), mimeType: asset.mimeType };
  }
}
