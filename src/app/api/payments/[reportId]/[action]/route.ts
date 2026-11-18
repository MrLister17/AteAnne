import { route } from "@/server/http/route";
import { NotFoundError } from "@/server/http/HttpError";

/** POST /api/payments/:id/{verify|reject|cancel|reverse} */
export const POST = route<{ reportId: string; action: string }>(async (ctx) => {
  const actorId = await ctx.caller();
  const { reportId, action } = ctx.params;
  const body = await ctx.json<Record<string, unknown>>();
  switch (action) {
    case "verify":
      return ctx.app.payments.verify(actorId, reportId, body);
    case "reject":
      return ctx.app.payments.reject(actorId, reportId, body as never);
    case "cancel":
      await ctx.app.payments.cancel(actorId, reportId);
      return { ok: true };
    case "reverse":
      await ctx.app.payments.reverse(actorId, reportId, body as never);
      return { ok: true };
    default:
      throw new NotFoundError();
  }
});
