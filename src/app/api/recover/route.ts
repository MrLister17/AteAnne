import { route } from "@/server/http/route";

export const POST = route(async (ctx) => {
  const body = await ctx.json();
  // The browser identity is created only once the IP check passes and the key exists (D57).
  return ctx.app.recovery.redeem(() => ctx.actorOrCreate(), body as never, ctx.ipHash);
});
