import { route } from "@/server/http/route";

/** Organizer/admin adds a person without a phone. */
export const POST = route<{ eventId: string }>(async (ctx) => ctx.app.events.addGuest(await ctx.actor(), ctx.params.eventId, await ctx.json()));
