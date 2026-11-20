import { route } from "@/server/http/route";

/** D64: one side's answer to a cash payment marked as not arrived. */
export const POST = route<{ disputeId: string }>(async (ctx) => ctx.app.cash.chooseResolution(await ctx.caller(), ctx.params.disputeId, await ctx.json()));
