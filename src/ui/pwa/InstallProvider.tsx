"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { isInstalledApp } from "../recovery";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Device = "loading" | "installed" | "ios" | "android" | "other";
type InstallState = {
  device: Device;
  canPrompt: boolean;
  browserMode: boolean;
  continueInBrowser(): void;
  install(): Promise<"accepted" | "dismissed" | "unavailable" | "failed">;
};

export const BROWSER_MODE_KEY = "ateanne.install.browser.v1";
const InstallContext = createContext<InstallState>({ device: "loading", canPrompt: false, browserMode: false, continueInBrowser() {}, install: async () => "unavailable" });
export const useInstall = () => useContext(InstallContext);

/** Keep the one-use Chrome install event across client-side navigation. */
export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<Device>("loading");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [browserMode, setBrowserMode] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const currentDevice = (): Device => isInstalledApp() ? "installed" : isIos ? "ios" : /Android/.test(ua) ? "android" : "other";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only capabilities after hydration
    setDevice(currentDevice());
    try {
      setBrowserMode(sessionStorage.getItem(BROWSER_MODE_KEY) === "1");
    } catch { /* storage is optional */ }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    const onDisplayChange = () => setDevice(currentDevice());
    const display = window.matchMedia("(display-mode: standalone)");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    display.addEventListener("change", onDisplayChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      display.removeEventListener("change", onDisplayChange);
    };
  }, []);

  return (
    <InstallContext.Provider value={{
      device,
      browserMode,
      canPrompt: deferred !== null,
      continueInBrowser() {
        try { sessionStorage.setItem(BROWSER_MODE_KEY, "1"); } catch { /* storage is optional */ }
        setBrowserMode(true);
      },
      async install() {
        if (!deferred) return "unavailable";
        setDeferred(null);
        try {
          await deferred.prompt();
          return (await deferred.userChoice).outcome;
        } catch {
          return "failed";
        }
      },
    }}>
      {children}
    </InstallContext.Provider>
  );
}
