import { route } from "@/server/http/route";
import { SESSION_COOKIE } from "@/server/auth/SessionManager";

export const GET = route(async (ctx) => {
  const actorId = await ctx.app.sessions.resolve(ctx.req.cookies.get(SESSION_COOKIE)?.value);
  return { events: actorId ? await ctx.app.events.listForActor(actorId) : [] };
});
