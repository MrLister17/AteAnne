import { route } from "@/server/http/route";

export const POST = route(async (ctx) => {
  const body = await ctx.json();
  const actorId = await ctx.actorOrCreate();
  return ctx.app.recovery.redeem(actorId, body as never, ctx.ipHash);
});
