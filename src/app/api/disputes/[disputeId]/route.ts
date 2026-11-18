import { route } from "@/server/http/route";

export const POST = route<{ disputeId: string }>(async (ctx) => ctx.app.payments.chooseResolution(await ctx.caller(), ctx.params.disputeId, await ctx.json()));
