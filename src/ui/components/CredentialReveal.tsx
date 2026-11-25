"use client";

import { useState } from "react";
import { Button, CopyButton, Notice } from "./ui";
import { Icon } from "./Icon";

/**
 * Shows a personal recovery key exactly once. The key is never stored in
 * localStorage or the URL; the person copies it somewhere safe (Notes,
 * password manager) before continuing.
 */
export function CredentialReveal({ recoveryKey, joinCode, onDone, doneLabel = "I saved it — continue" }: { recoveryKey: string; joinCode?: string | null; onDone: () => void; doneLabel?: string }) {
  const [ack, setAck] = useState(false);
  return (
    <div className="space-y-5">
      {joinCode && (
        <section className="card space-y-3 p-4">
          <h2 className="text-[17px] font-bold">Invite your group</h2>
          <p className="text-[15px] text-muted">Send this code to your group chat.</p>
          <p className="tnum rounded-2xl bg-violet-soft py-4 text-center font-mono text-[28px] font-bold tracking-[0.12em] text-violet" aria-label={`Join code ${joinCode.split("").join(" ")}`}>
            {joinCode}
          </p>
          <ShareJoin code={joinCode} />
        </section>
      )}
      <section className="card space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Icon name="key" className="text-coral" />
          <h2 className="text-[17px] font-bold">Your personal recovery key</h2>
        </div>
        <p className="text-[15px] text-muted">
          Gets you back in if you lose this phone. Shown only once.
        </p>
        <p className="rounded-xl border border-dashed border-line bg-surface-2 p-3 font-mono text-[14px] break-all select-all" data-testid="recovery-key">
          {recoveryKey}
        </p>
        <CopyButton text={recoveryKey} label="Copy recovery key" onCopied={() => setAck(true)} />
        <Notice tone="warn">Keep it private. Anyone with this key can sign in as you.</Notice>
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" className="size-5 accent-[var(--violet)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />I saved my recovery key somewhere safe
        </label>
      </section>
      <Button full disabled={!ack} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

export function ShareJoin({ code }: { code: string }) {
  const link = typeof window !== "undefined" ? `${window.location.origin}/join#code=${code.replace("-", "")}` : "";
  const text = `Join my event on Hatian! Code: ${code}`;
  return (
    <div className="grid grid-cols-2 gap-2">
      <CopyButton text={code} label="Copy code" />
      <Button
        type="button"
        variant="secondary"
        icon="share"
        onClick={async () => {
          if (navigator.share) {
            try {
              await navigator.share({ title: "Hatian", text, url: link });
            } catch {
              /* cancelled */
            }
          } else {
            await navigator.clipboard.writeText(`${text}\n${link}`).catch(() => undefined);
          }
        }}
      >
        Share link
      </Button>
    </div>
  );
}
