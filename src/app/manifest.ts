import type { MetadataRoute } from "next";

/** Web app manifest — lets iPhone (Add to Home Screen) and Android (Install app) run AteAnne full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AteAnne — Hatian na malinaw",
    short_name: "AteAnne",
    description: "Split shared bills by what each person actually had, and settle with recipient-confirmed payments.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#fbf7f2",
    theme_color: "#5b3fd0",
    lang: "en-PH",
    categories: ["finance", "utilities", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
