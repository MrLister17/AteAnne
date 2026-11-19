import { route } from "@/server/http/route";

export const POST = route(async (ctx) => {
  const body = await ctx.json();
  // The browser identity is created only once the IP check passes and the code matches (D57).
  return ctx.app.events.join(() => ctx.actorOrCreate(), body as never, ctx.ipHash);
});
