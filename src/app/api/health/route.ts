import { NextResponse } from "next/server";
import { configProblems, scanSetupHint } from "@/server/config";
import { container } from "@/server/container";
import { prisma } from "@/server/db";

/**
 * Liveness + setup check. Shows which build is running and whether receipt
 * scanning is on, so a deployment can be checked from a phone. Never reveals
 * secret values — only setting names and on/off states.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const missing = configProblems();
  if (missing.length) return NextResponse.json({ ok: false, reason: "not_configured", missing, version }, { status: 503, headers });
  const receiptScan = container().scans.provider;
  try {
    await prisma().$queryRaw`SELECT 1`;
    // Exchange rates (D62): the source and the newest cached day, so a deployment's rate fetch can be checked from a phone.
    // Asking for today's rate here (cached; refetched at most every 30 minutes) proves the live source works after a deploy.
    const rates = container().rates;
    await rates.ensureDays([rates.today()]);
    const latest = await rates.latest();
    const fx = { source: rates.source, today: rates.today(), latest, ok: latest?.day === rates.today() };
    // When scanning is off, say why in plain words (setting names only, never values).
    return NextResponse.json({ ok: true, version, receiptScan, ...(receiptScan === "off" ? { receiptScanHint: scanSetupHint() } : {}), fx }, { headers });
  } catch {
    return NextResponse.json({ ok: false, reason: "database_unreachable", version, receiptScan }, { status: 503, headers });
  }
}
