"use client";

import { CopyButton, Button } from "../components/ui";
import { InstallPrompt } from "./InstallPrompt";
import { useInstall } from "./InstallProvider";

/** Pause new mobile identities before Safari and the installed app diverge. */
export function InstallFirst({ children, joinCode, recovery = false }: { children: React.ReactNode; joinCode?: string; recovery?: boolean }) {
  const { device, canPrompt, browserMode, continueInBrowser } = useInstall();
  if (device === "loading") return <p className="py-6 text-muted" role="status">Getting your app ready…</p>;
  if (recovery || browserMode || device === "installed" || (device === "other" && !canPrompt)) return children;

  return (
    <div className="mt-2 space-y-4">
      <InstallPrompt />
      {joinCode && (
        <div className="card space-y-3 p-4">
          <p className="text-[15px]">Copy your join code first. You’ll paste it in the app.</p>
          <p className="tnum break-all font-mono text-[22px] font-bold" aria-label="Your shared join code">{joinCode}</p>
          <CopyButton text={joinCode} label="Copy join code" />
        </div>
      )}
      <p className="text-[15px] text-muted">Rather not install? That’s fine. Just save your recovery key after joining.</p>
      <Button full variant="secondary" onClick={continueInBrowser}>Continue in this browser</Button>
    </div>
  );
}
