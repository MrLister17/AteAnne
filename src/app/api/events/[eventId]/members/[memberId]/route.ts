import { route } from "@/server/http/route";

export const DELETE = route<{ eventId: string; memberId: string }>(async (ctx) => {
  await ctx.app.events.removeMember(await ctx.actor(), ctx.params.eventId, ctx.params.memberId);
  return { ok: true };
});
