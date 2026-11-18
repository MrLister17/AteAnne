import { route } from "@/server/http/route";

export const PATCH = route<{ eventId: string }>(async (ctx) => {
  await ctx.app.events.updateMe(await ctx.caller(), ctx.params.eventId, await ctx.json());
  return { ok: true };
});
