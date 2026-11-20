import { route } from "@/server/http/route";

/** D64: record cash already handed to another member (Add & claim or Pay). */
export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.cash.report(await ctx.caller(), ctx.params.eventId, await ctx.json()));
