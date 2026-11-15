import { route } from "@/server/http/route";

export const POST = route<{ edgeId: string }>(async (ctx) => ctx.app.payments.report(await ctx.actor(), ctx.params.edgeId, await ctx.json()));
