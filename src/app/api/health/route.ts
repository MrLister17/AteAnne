import { NextResponse } from "next/server";
import { configProblems } from "@/server/config";
import { prisma } from "@/server/db";

/** Liveness + setup check. Never reveals secret values, only which settings are missing. */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const missing = configProblems();
  if (missing.length) return NextResponse.json({ ok: false, reason: "not_configured", missing }, { status: 503, headers });
  try {
    await prisma().$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false, reason: "database_unreachable" }, { status: 503, headers });
  }
}
