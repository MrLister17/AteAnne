import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/server/config";
import { container } from "@/server/container";

/** Cron endpoint: Authorization: Bearer $CLEANUP_TOKEN. Not origin-checked (server-to-server). */
export async function POST(req: NextRequest) {
  const token = config().CLEANUP_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const result = await container().cleanup.run();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
