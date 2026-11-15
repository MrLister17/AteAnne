import { route } from "@/server/http/route";

type P = { receiptId: string };
export const PUT = route<P>(async (ctx) => ctx.app.receipts.update(await ctx.actor(), ctx.params.receiptId, await ctx.json()));
export const DELETE = route<P>(async (ctx) => {
  await ctx.app.receipts.remove(await ctx.actor(), ctx.params.receiptId);
  return { ok: true };
});
