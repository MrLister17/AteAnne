#!/usr/bin/env node
// Generates PWA / iOS home-screen icons from an inline SVG mark (no external assets).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const mark = (size, padding) => {
  const s = size;
  const p = padding;
  const inner = s - p * 2;
  const r = Math.round(inner * 0.22);
  // Receipt with a zig-zag tear split down the middle: "hatian".
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6a4be0"/><stop offset="1" stop-color="#4a2fb8"/>
    </linearGradient>
  </defs>
  <rect x="${p}" y="${p}" width="${inner}" height="${inner}" rx="${r}" fill="url(#g)"/>
  <g transform="translate(${s / 2} ${s / 2 + inner * 0.03}) scale(${inner / 512})">
    <path d="M-150,-170 h130 l-18,30 l18,30 l-18,30 l18,30 l-18,30 l18,30 l-18,30 l18,30 l-18,30 l18,30 h-130 a20,20 0 0 1 -20,-20 v-260 a20,20 0 0 1 20,-20z" fill="#fbf7f2"/>
    <path d="M10,-170 h140 a20,20 0 0 1 20,20 v260 a20,20 0 0 1 -20,20 h-140 l18,-30 l-18,-30 l18,-30 l-18,-30 l18,-30 l-18,-30 l18,-30 l-18,-30 l18,-30 l-18,-30z" fill="#ff8e77"/>
    <rect x="-130" y="-120" width="80" height="16" rx="8" fill="#5b3fd0"/>
    <rect x="-130" y="-80" width="60" height="16" rx="8" fill="#5b3fd0" opacity=".6"/>
    <rect x="-130" y="-40" width="80" height="16" rx="8" fill="#5b3fd0" opacity=".6"/>
    <rect x="40" y="-120" width="90" height="16" rx="8" fill="#fbf7f2"/>
    <rect x="40" y="-80" width="70" height="16" rx="8" fill="#fbf7f2" opacity=".75"/>
    <text x="98" y="95" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="800" text-anchor="middle" fill="#fbf7f2">₱</text>
  </g>
</svg>`);
};

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["public/icons/icon-192.png", 192, 0, false],
  ["public/icons/icon-512.png", 512, 0, false],
  ["public/icons/maskable-512.png", 512, 56, true],
  ["public/icons/apple-touch-icon.png", 180, 0, true],
  ["src/app/icon.png", 64, 0, false],
];
for (const [file, size, pad, flatten] of jobs) {
  let img = sharp(mark(size, pad));
  if (flatten) img = img.flatten({ background: "#4a2fb8" }); // iOS & maskable: no transparency
  await img.png().toFile(file);
  console.log("wrote", file);
}
