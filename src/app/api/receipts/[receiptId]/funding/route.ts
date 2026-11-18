import { route } from "@/server/http/route";

export const POST = route<{ receiptId: string }>(async (ctx) => {
  await ctx.app.receipts.acknowledgeFunding(await ctx.caller(), ctx.params.receiptId, await ctx.json());
  return { ok: true };
});
