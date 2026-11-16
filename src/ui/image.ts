"use client";

/** Hosting platforms cap request bodies (Vercel: 4.5 MB). Stay safely below. */
export const MAX_CLIENT_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Shrink a phone photo before upload: honour EXIF orientation, cap the long
 * side, re-encode (JPEG for receipts, lossless PNG for QR codes so they stay
 * scannable). The server still decodes, validates and re-encodes everything;
 * this only keeps uploads small and fast on mobile data.
 */
export async function prepareImage(file: File, kind: "RECEIPT" | "QR"): Promise<Blob> {
  // Receipts are long and thin: keep enough pixels that small print survives the server-side crop to the paper.
  const maxSide = kind === "QR" ? 1400 : 2600;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && (file.type === "image/jpeg" || file.type === "image/png")) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    if (kind === "QR") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, kind === "QR" ? "image/png" : "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // older browsers: let the server handle it
  }
}

export function uploadName(blob: Blob): string {
  return blob.type === "image/png" ? "image.png" : blob.type === "image/webp" ? "image.webp" : "image.jpg";
}
