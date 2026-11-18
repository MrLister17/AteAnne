import { route } from "@/server/http/route";

/** "Everyone's here": the organizer closes the roster; the bill then freezes by itself once everyone is done. */
export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.events.lockRoster(await ctx.actor(), ctx.params.eventId));
