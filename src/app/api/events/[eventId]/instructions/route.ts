import { route } from "@/server/http/route";

export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.payments.setInstructions(await ctx.actor(), ctx.params.eventId, await ctx.json()));
