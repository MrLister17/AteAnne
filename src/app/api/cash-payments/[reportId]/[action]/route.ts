import { route } from "@/server/http/route";
import { NotFoundError } from "@/server/http/HttpError";

/** POST /api/cash-payments/:id/{verify|reject|cancel|reverse} (D64). */
export const POST = route<{ reportId: string; action: string }>(async (ctx) => {
  const caller = await ctx.caller();
  const { reportId, action } = ctx.params;
  const body = await ctx.json<Record<string, unknown>>();
  switch (action) {
    case "verify":
      return ctx.app.cash.verify(caller, reportId, body);
    case "reject":
      return ctx.app.cash.reject(caller, reportId, body as never);
    case "cancel":
      await ctx.app.cash.cancel(caller, reportId);
      return { ok: true };
    case "reverse":
      await ctx.app.cash.reverse(caller, reportId, body as never);
      return { ok: true };
    default:
      throw new NotFoundError();
  }
});
