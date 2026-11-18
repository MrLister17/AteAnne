import { route } from "@/server/http/route";

/** Organizer makes someone an admin (or removes it). Body: { isAdmin: boolean }. */
export const POST = route<{ eventId: string; memberId: string }>(async (ctx) => {
  await ctx.app.events.setAdmin(await ctx.actor(), ctx.params.eventId, ctx.params.memberId, await ctx.json());
  return { ok: true };
});
