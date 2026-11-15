import { route } from "@/server/http/route";

export const POST = route<{ eventId: string }>(async (ctx) => {
  const { cancelled } = await ctx.json<{ cancelled?: boolean }>();
  await ctx.app.events.setCancelled(await ctx.actor(), ctx.params.eventId, cancelled !== false);
  return { ok: true };
});
