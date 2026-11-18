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
          <p className="text-[15px]">Keep this join code for the app. Safari and your Home Screen may keep separate storage, so it might not carry over.</p>
          <p className="tnum break-all font-mono text-[22px] font-bold" aria-label="Your shared join code">{joinCode}</p>
          <CopyButton text={joinCode} label="Copy join code" />
        </div>
      )}
      <p className="text-[15px] text-muted">Using Safari for now? Save the recovery key after joining. You’ll need it once if you later open the Home Screen app.</p>
      <Button full variant="secondary" onClick={continueInBrowser}>Continue in this browser</Button>
    </div>
  );
}
