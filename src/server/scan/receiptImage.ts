import sharp from "sharp";

/** Longest side sent to the reader. Vision models budget a fixed amount of detail per image, so pixels spent on the table are wasted. */
const READER_MAX_SIDE = 1568;
const PROBE_WIDTH = 96;

export interface PaperBox {
  /** Fractions of the image width/height, 0..1. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Finds the bright paper in a receipt photo (white receipt on a darker table,
 * folder or hand). Deliberately cautious: it returns null unless a clear
 * bright column band exists, and vertically it keeps everything from the
 * first to the last bright row so a fold, logo or shadow can never cut items
 * off. Cropping too little is harmless; cropping a line away is not.
 */
export async function findPaper(image: Buffer): Promise<PaperBox | null> {
  const { data, info } = await sharp(image).grayscale().resize({ width: PROBE_WIDTH }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  if (W < 8 || H < 8) return null;
  const sorted = Uint8Array.from(data).sort();
  const white = sorted[Math.floor(sorted.length * 0.95)];
  if (white < 140) return null; // nothing paper-bright in the photo
  const threshold = Math.max(120, white * 0.72);
  const bright = (x: number, y: number) => data[y * W + x] >= threshold;

  // Columns that are mostly bright from top to bottom: the paper strip. Longest run, small gaps allowed.
  const colShare = Array.from({ length: W }, (_, x) => {
    let n = 0;
    for (let y = 0; y < H; y++) if (bright(x, y)) n++;
    return n / H;
  });
  let best: [number, number] | null = null;
  let start = -1;
  let gap = 0;
  for (let x = 0; x <= W; x++) {
    const ok = x < W && colShare[x] >= 0.4;
    if (ok) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0 && (x === W || ++gap > 2)) {
      const last = x === W ? W - 1 - gap : x - gap; // last bright column of this run
      if (!best || last - start > best[1] - best[0]) best = [start, last];
      start = -1;
      gap = 0;
    }
  }
  if (!best) return null;
  const [x0, x1] = best;

  // Rows: first to last row that is mostly bright inside that strip.
  const span = x1 - x0 + 1;
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (bright(x, y)) n++;
    if (n / span >= 0.5) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  if (y0 < 0) return null;
  return { x0: x0 / W, x1: (x1 + 1) / W, y0: y0 / H, y1: (y1 + 1) / H };
}

/**
 * The copy of the photo that the reader sees: cropped to the paper when that
 * is clearly possible, then sized for vision. The stored photo is untouched.
 */
export async function prepareForReader(image: Buffer): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  let pipeline = sharp(image);
  const box = width && height ? await findPaper(image).catch(() => null) : null;
  if (box) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    // Only crop when it is plausibly a receipt and actually removes a useful amount of background.
    if (w >= 0.2 && h >= 0.25 && w * h <= 0.8) {
      const pad = 0.03;
      const left = Math.max(0, Math.floor((box.x0 - pad) * width));
      const top = Math.max(0, Math.floor((box.y0 - pad) * height));
      const right = Math.min(width, Math.ceil((box.x1 + pad) * width));
      const bottom = Math.min(height, Math.ceil((box.y1 + pad) * height));
      pipeline = pipeline.extract({ left, top, width: right - left, height: bottom - top });
    }
  }
  return pipeline.resize({ width: READER_MAX_SIDE, height: READER_MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}
