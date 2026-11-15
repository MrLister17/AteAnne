/** Post-restore checks: ledger conservation per snapshot and every asset file present. Never recomputes frozen data. */
import "dotenv/config";
import { access } from "node:fs/promises";
import path from "node:path";
import { createPrisma } from "../src/server/db";

const db = createPrisma(process.env.DATABASE_URL!);
let failures = 0;
const snaps = await db.snapshot.findMany({ include: { shares: true, edges: true } });
for (const s of snaps) {
  const sum = s.shares.reduce((a, x) => a + x.netCentavos, 0n);
  const fundingCost = s.shares.reduce((a, x) => a + x.fundingCentavos - x.costCentavos, 0n);
  if (sum !== 0n || fundingCost !== 0n) {
    failures++;
    console.error(`Snapshot ${s.id}: nets do not sum to zero`);
  }
}
const assets = await db.asset.findMany({ select: { storageKey: true } });
for (const a of assets) {
  try {
    await access(path.resolve(process.env.PRIVATE_UPLOAD_DIR!, a.storageKey.slice(0, 2), a.storageKey));
  } catch {
    failures++;
    console.error(`Missing file for asset ${a.storageKey}`);
  }
}
console.log(`Checked ${snaps.length} snapshots and ${assets.length} assets: ${failures ? `${failures} problem(s)` : "OK"}`);
await db.$disconnect();
process.exit(failures ? 1 : 0);
