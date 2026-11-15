import { route } from "@/server/http/route";

export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.recovery.rotate(await ctx.actor(), ctx.params.eventId));
