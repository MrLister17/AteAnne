import { route } from "@/server/http/route";

export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.receipts.create(await ctx.actor(), ctx.params.eventId, await ctx.json()));
