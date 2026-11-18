import { route } from "@/server/http/route";

export const POST = route<{ eventId: string; memberId: string }>(async (ctx) =>
  ctx.app.recovery.reissue(await ctx.actor(), ctx.params.eventId, ctx.params.memberId, await ctx.json()),
);
