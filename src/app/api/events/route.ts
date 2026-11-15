import { route } from "@/server/http/route";
import { RATE_RULES } from "@/server/security/RateLimiter";

export const POST = route(async (ctx) => {
  await ctx.app.limiter.hit(RATE_RULES.createPerIp, ctx.ipHash);
  const body = await ctx.json();
  const actorId = await ctx.actorOrCreate();
  return ctx.app.events.create(actorId, body as never);
});
