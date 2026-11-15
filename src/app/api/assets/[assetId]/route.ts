import { NextResponse } from "next/server";
import { route } from "@/server/http/route";

/** Authorised private image bytes. Never cached publicly, never sniffed as HTML. */
export const GET = route<{ assetId: string }>(async (ctx) => {
  const { bytes, mimeType } = await ctx.app.assets.read(await ctx.actor(), ctx.params.assetId);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": mimeType, "content-disposition": "inline", "content-security-policy": "default-src 'none'; sandbox" },
  });
});
