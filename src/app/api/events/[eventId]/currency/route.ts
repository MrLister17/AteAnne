import { route } from "@/server/http/route";

/** Organizer: change the settle-up currency (D59; Add & claim only, before any payment report). */
export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.events.setCurrency(await ctx.actor(), ctx.params.eventId, await ctx.json()));
