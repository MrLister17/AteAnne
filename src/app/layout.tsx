import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/ui/pwa/ServiceWorkerRegistrar";
import { TutorialProvider } from "@/ui/tutorial/TutorialProvider";
import { SetupBanner } from "@/ui/pwa/SetupBanner";

export const metadata: Metadata = {
  title: { default: "AteAnne", template: "%s · AteAnne" },
  description: "Hatian na malinaw. Bayaran na tama. Split shared bills by what each person actually had, then settle with recipient-confirmed payments.",
  applicationName: "AteAnne",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AteAnne", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: { "mobile-web-app-capable": "yes" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#15121b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH">
      <body className="antialiased">
        <SetupBanner />
        <TutorialProvider>{children}</TutorialProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
