import { route } from "@/server/http/route";
import { HttpError } from "@/server/http/HttpError";
import { MAX_UPLOAD_BYTES } from "@/server/services/AssetService";

/**
 * Multipart upload: file + kind=QR [+ acceptsCash, cashNote, qrLabel].
 * kind=RECEIPT is refused with 410: receipt photos aren't kept any more (D54).
 */
export const POST = route<{ eventId: string }>(async (ctx) => {
  const actorId = await ctx.caller();
  const length = Number(ctx.req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, "file_too_large", "Images must be 8 MB or smaller");
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new HttpError(400, "bad_form", "Upload a file");
  }
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof Blob)) throw new HttpError(400, "file_required", "Choose an image");
  if (kind !== "RECEIPT" && kind !== "QR") throw new HttpError(400, "bad_kind", "Unknown upload type");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large", "Images must be 8 MB or smaller");
  const bytes = Buffer.from(await file.arrayBuffer());
  const { assetId } = await ctx.app.assets.upload(actorId, ctx.params.eventId, kind, bytes);
  if (kind === "QR") {
    const version = await ctx.app.payments.setInstructions(
      actorId,
      ctx.params.eventId,
      { acceptsCash: form.get("acceptsCash") === "true", cashNote: String(form.get("cashNote") ?? ""), qrLabel: String(form.get("qrLabel") ?? ""), keepQr: true },
      assetId,
    );
    return { assetId, ...version };
  }
  return { assetId };
});
