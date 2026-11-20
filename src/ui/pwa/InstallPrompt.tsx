"use client";

import { useState } from "react";
import { Icon } from "../components/Icon";
import { Button, Notice } from "../components/ui";
import { useInstall } from "./InstallProvider";

/**
 * Safari has no install API. Never imply that Web Share installs an app.
 * `quiet`: on the start screen, where "Start a hatian" is the main action; /new and /join still pause for installing first.
 */
export function InstallPrompt({ quiet = false }: { quiet?: boolean }) {
  const { device, canPrompt, install } = useInstall();
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  if (device === "loading" || device === "installed") return null;

  return (
    <aside className="card p-4" aria-label="Install Hatian">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={48} height={48} className="size-12 rounded-xl" />
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold">Add Hatian to your Home Screen first</h2>
          <p className="mt-1 text-[15px] text-muted">Then start or join from the app, so your event stays in it.</p>
        </div>
      </div>
      <Button
        full
        variant={quiet ? "secondary" : "primary"}
        icon="plus"
        className="mt-4"
        aria-expanded={!canPrompt ? expanded : undefined}
        onClick={async () => {
          if (!canPrompt) { setExpanded((open) => !open); return; }
          const outcome = await install();
          if (outcome === "accepted") setResult("Added! Open Hatian from your Home Screen to start or join there.");
          else if (outcome === "dismissed") setResult("Installation was cancelled. You can try again from your browser’s menu.");
          else setResult("The install prompt could not open. Use your browser’s menu to add Hatian to your Home Screen.");
          setExpanded(true);
        }}
      >
        {canPrompt ? "Install Hatian" : expanded ? "Hide install steps" : "Add to Home Screen"}
      </Button>
      {result && <p className="mt-3 text-[15px]" role="status">{result}</p>}
      {expanded && (
        <div className="mt-4 space-y-3 text-[15px]">
          {device === "ios" ? (
            <>
              <Notice tone="info">Safari requires these taps; a website cannot open its Add to Home Screen confirmation for you.</Notice>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Open this page in <b>Safari</b> if you came from Messenger or another app.</li>
                <li>Tap <Icon name="share" size={16} className="inline align-[-3px]" label="Share" /> <b>Share</b>, then <b>Add to Home Screen</b>. You may need to scroll the menu.</li>
                <li>Keep <b>Open as Web App</b> on if shown, and tap <b>Add</b>.</li>
                <li>Open <b>Hatian</b> from your Home Screen, then start or join there.</li>
              </ol>
            </>
          ) : (
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open your browser’s menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.</li>
              <li>Confirm, then open <b>Hatian</b> from its new icon to start or join.</li>
            </ol>
          )}
        </div>
      )}
    </aside>
  );
}
