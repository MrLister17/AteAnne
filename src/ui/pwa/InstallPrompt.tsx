"use client";

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ateanne.install.dismissed";

/**
 * "Add to Home Screen" helper. iPhone Safari has no install API, so we show
 * the Share → Add to Home Screen steps; Android/Chrome gets the native prompt.
 * Hidden once installed (standalone) or dismissed.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<"ios" | "android" | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (standalone || dismissed) return;
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
    if (isIos) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!mode) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setMode(null);
  };

  return (
    <aside className="card relative flex gap-3 p-4" aria-label="Install AteAnne">
      <img src="/icons/icon-192.png" alt="" width={48} height={48} className="size-12 rounded-xl" />
      <div className="min-w-0 flex-1 pr-6 text-[15px]">
        <p className="font-semibold">Install AteAnne on your phone</p>
        {mode === "ios" ? (
          <p className="mt-0.5 text-muted">
            In Safari, tap <Icon name="share" size={16} className="inline align-[-3px]" label="Share" /> then <b>Add to Home Screen</b>. It opens full-screen like an app.
          </p>
        ) : (
          <button
            type="button"
            className="mt-2 min-h-11 rounded-xl bg-violet px-4 font-semibold text-violet-ink"
            onClick={async () => {
              await deferred?.prompt();
              setMode(null);
            }}
          >
            Install app
          </button>
        )}
      </div>
      <button type="button" onClick={dismiss} className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-full text-muted" aria-label="Dismiss install tip">
        <Icon name="x" size={18} />
      </button>
    </aside>
  );
}
