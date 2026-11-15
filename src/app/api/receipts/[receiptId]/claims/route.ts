import { route } from "@/server/http/route";

export const PUT = route<{ receiptId: string }>(async (ctx) => ctx.app.receipts.saveClaims(await ctx.actor(), ctx.params.receiptId, await ctx.json()));
