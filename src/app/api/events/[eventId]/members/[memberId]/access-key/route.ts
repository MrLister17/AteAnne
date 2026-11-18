import { route } from "@/server/http/route";

/** Organizer/admin creates a one-time key so a guest can take over on their own phone. */
export const POST = route<{ eventId: string; memberId: string }>(async (ctx) => ctx.app.events.guestAccessKey(await ctx.actor(), ctx.params.eventId, ctx.params.memberId));
