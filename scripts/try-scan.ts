/**
 * Dev tool: run a receipt photo through a real scanner and print the draft.
 *   npx tsx scripts/try-scan.ts <photo.jpg> [groq-model]
 * Uses GROQ_API_KEY (or a proxy-injected key). Prints amounts in centavos.
 * Nothing is saved anywhere.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { GroqReceiptReader, DEFAULT_GROQ_VISION_MODEL } from "../src/server/scan/GroqReceiptReader";
import { ReceiptDraftNormalizer } from "../src/domain/receipt/ReceiptDraftNormalizer";

async function main() {
  const [file, model = process.env.GROQ_VISION_MODEL ?? DEFAULT_GROQ_VISION_MODEL] = process.argv.slice(2);
  if (!file) throw new Error("Usage: npx tsx scripts/try-scan.ts <photo.jpg> [groq-model]");
  const img = await sharp(readFileSync(file)).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const started = Date.now();
  try {
    const raw = await new GroqReceiptReader(process.env.GROQ_API_KEY ?? "proxy-injected", model).read(img, "image/jpeg");
    const d = new ReceiptDraftNormalizer().normalize(raw);
    console.log(`model=${model} seconds=${((Date.now() - started) / 1000).toFixed(1)}`);
    console.log("merchant:", d.label);
    for (const l of d.lines) console.log(`  line: ${l.label} | qty ${l.quantity} | ${l.amount} | unit ${l.unitPrice}`);
    for (const a of d.adjustments) console.log(`  adj:  ${a.kind} ${a.label} | ${a.amount}`);
    console.log("payable:", d.payable.toString(), "computed:", d.computedPayable.toString(), "reconciled:", d.reconciled);
    console.log("warnings:", d.warnings);
  } catch (e) {
    console.log(`model=${model} FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${(e as Error).constructor.name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
void main();
