import sharp from "sharp";
import { PermissionError } from "@/domain/errors";
import { PhaseMachine } from "@/domain/event/PhaseMachine";
import { ReceiptDraftNormalizer } from "@/domain/receipt/ReceiptDraftNormalizer";
import type { Db } from "../db";
import { HttpError, NotFoundError } from "../http/HttpError";
import { RATE_RULES, RateLimiter } from "../security/RateLimiter";
import { ReceiptReadError, type ReceiptReader } from "../scan/ReceiptReader";
import type { AssetService } from "./AssetService";

/**
 * Photo → receipt DRAFT. Nothing is saved: the draft opens in the normal
 * receipt editor, where the person checks every line and the reconciliation
 * before saving (manual entry stays the source of truth). The photo is only
 * forwarded to the configured reader after being decoded and re-encoded
 * (metadata stripped) and is not stored by this call.
 */
export class ReceiptScanService {
  constructor(
    private readonly db: Db,
    private readonly assets: AssetService,
    private readonly limiter: RateLimiter,
    private readonly reader: ReceiptReader | null,
    private readonly normalizer = new ReceiptDraftNormalizer(),
  ) {}

  /** "groq" | "claude" | "fake" | "off" — safe to show; never includes a key. */
  get provider(): string {
    return this.reader ? (this.reader.name ?? "custom") : "off";
  }

  get enabled(): boolean {
    return this.reader !== null;
  }

  async scan(actorId: string, eventId: string, file: Buffer) {
    if (!this.reader) throw new HttpError(503, "scan_not_configured", "Receipt scanning isn’t switched on for this app.");
    const member = await this.db.member.findFirst({ where: { eventId, actorId, active: true }, include: { event: true } });
    if (!member) throw new NotFoundError("Event not found");
    new PhaseMachine(member.event.phase).assertIn("COLLECTING");
    if (member.event.cancelled) throw new PermissionError("event_cancelled", "This event was cancelled");
    await this.limiter.hit(RATE_RULES.scansPerMember, member.id);
    await this.limiter.hit(RATE_RULES.scansPerEvent, eventId);

    // Validate + strip metadata via the same pipeline as private photos, then size for vision.
    const safe = await this.assets.process(file, "RECEIPT");
    const forReader = await sharp(safe.bytes).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

    let reading;
    try {
      reading = await this.reader.read(forReader, "image/jpeg");
    } catch (e) {
      if (e instanceof ReceiptReadError) throw new HttpError(e.reason === "unavailable" ? 503 : 422, `scan_${e.reason}`, e.message);
      throw e;
    }
    const draft = this.normalizer.normalize(reading);
    await this.db.auditEvent.create({ data: { eventId, actorMemberId: member.id, type: "receipt.scanned", detail: { lines: draft.lines.length, reconciled: draft.reconciled } } });
    return {
      label: draft.label,
      payable: draft.payable.toString(),
      computedPayable: draft.computedPayable.toString(),
      reconciled: draft.reconciled,
      warnings: draft.warnings,
      lines: draft.lines.map((l) => ({ label: l.label, quantity: l.quantity, amount: l.amount.toString(), unitPrice: l.unitPrice === null ? null : l.unitPrice.toString() })),
      adjustments: draft.adjustments.map((a) => ({ kind: a.kind, label: a.label, amount: a.amount.toString() })),
    };
  }
}

export type ScannedDraft = Awaited<ReturnType<ReceiptScanService["scan"]>>;
