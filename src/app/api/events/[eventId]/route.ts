import { route } from "@/server/http/route";

type P = { eventId: string };

export const GET = route<P>(async (ctx) => ctx.app.queries.view(await ctx.actor(), ctx.params.eventId));

export const DELETE = route<P>(async (ctx) => {
  const { confirmTitle } = await ctx.json<{ confirmTitle?: string }>();
  const keys = await ctx.app.events.deleteEvent(await ctx.actor(), ctx.params.eventId, String(confirmTitle ?? ""));
  for (const k of keys) await ctx.app.storage.delete(k).catch(() => undefined);
  return { ok: true };
});
