import { route } from "@/server/http/route";
import { approveSchema } from "@/server/validation";

export const POST = route<{ eventId: string }>(async (ctx) => {
  const { financialVersion } = approveSchema.parse(await ctx.json());
  await ctx.app.receipts.approveReview(await ctx.caller(), ctx.params.eventId, financialVersion);
  return { ok: true };
});
