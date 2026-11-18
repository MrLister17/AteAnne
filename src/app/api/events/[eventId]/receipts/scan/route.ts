import { route } from "@/server/http/route";
import { HttpError } from "@/server/http/HttpError";
import { MAX_UPLOAD_BYTES } from "@/server/services/AssetService";

/** Vision calls can take a while; give the function room (seconds). */
export const maxDuration = 60;

/** Multipart: file. Returns a receipt DRAFT (nothing is saved). */
export const POST = route<{ eventId: string }>(async (ctx) => {
  const actorId = await ctx.caller();
  const length = Number(ctx.req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, "file_too_large", "Images must be 8 MB or smaller");
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new HttpError(400, "bad_form", "Upload a photo");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "file_required", "Take or choose a photo of the receipt");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "file_too_large", "Images must be 8 MB or smaller");
  return ctx.app.scans.scan(actorId, ctx.params.eventId, Buffer.from(await file.arrayBuffer()));
});
