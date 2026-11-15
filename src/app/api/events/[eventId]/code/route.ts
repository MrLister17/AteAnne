import { route } from "@/server/http/route";

type P = { eventId: string };
export const POST = route<P>(async (ctx) => ctx.app.events.rotateCode(await ctx.actor(), ctx.params.eventId));
export const DELETE = route<P>(async (ctx) => {
  await ctx.app.events.closeJoins(await ctx.actor(), ctx.params.eventId);
  return { ok: true };
});
