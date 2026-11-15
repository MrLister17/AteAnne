import { route } from "@/server/http/route";

export const DELETE = route<{ receiptId: string }>(async (ctx) => {
  await ctx.app.assets.removeReceiptImage(await ctx.actor(), ctx.params.receiptId);
  return { ok: true };
});
