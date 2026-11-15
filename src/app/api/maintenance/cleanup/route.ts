import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/server/config";
import { container } from "@/server/container";

/**
 * Daily housekeeping. Authorization: Bearer <CRON_SECRET or CLEANUP_TOKEN>.
 * Vercel Cron calls GET with CRON_SECRET (see vercel.json); other schedulers may POST.
 * Not origin-checked (server-to-server).
 */
function authorized(req: NextRequest): boolean {
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { CRON_SECRET, CLEANUP_TOKEN } = config();
  return [CRON_SECRET, CLEANUP_TOKEN].some((t) => Boolean(t) && t!.length >= 16 && given.length === t!.length && timingSafeEqual(Buffer.from(given), Buffer.from(t!)));
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const result = await container().cleanup.run();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}

export const GET = run;
export const POST = run;
