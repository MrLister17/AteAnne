import { NextResponse } from "next/server";
import { route } from "@/server/http/route";

export const GET = route<{ eventId: string }>(async (ctx) => {
  const format = ctx.req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const out = await ctx.app.queries.export(await ctx.actor(), ctx.params.eventId, format);
  return new NextResponse(out.body, { headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.filename}"` } });
});
