"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Field, Notice } from "@/ui/components/ui";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { Icon } from "@/ui/components/Icon";
import { isInstalledApp, looksLikeRecoveryKey } from "@/ui/recovery";

export default function Recover() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ eventId: string; recoveryKey: string } | null>(null);
  const [{ installed, canPaste }, setEnv] = useState({ installed: false, canPaste: false });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only values read after hydration
    setEnv({ installed: isInstalledApp(), canPaste: Boolean(navigator.clipboard?.readText) });
  }, []);

  if (done) {
    return (
      <PageShell title="Access recovered" back={null}>
        <Notice tone="receive" title="Welcome back">
          This phone is now you in that event — same receipts, claims and payments. Your old key no longer works; here is your new one.
        </Notice>
        <div className="mt-4">
          <CredentialReveal recoveryKey={done.recoveryKey} onDone={() => router.replace(`/e/${done.eventId}`)} doneLabel="Open the event" />
        </div>
      </PageShell>
    );
  }

  const tooShort = key.trim().length > 0 && !looksLikeRecoveryKey(key);

  return (
    <PageShell title="Use my recovery key">
      <form
        className="mt-2 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setDone(await api.post("/api/recover", { key }));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not recover access");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-[15px] text-muted">
          Paste the key you saved when you joined.
        </p>
        <Field label="Personal recovery key" hint="Starts with AA-." error={tooShort ? "That doesn’t look like a whole key yet. Copy the full line that starts with AA-." : null}>
          {(p) => (
            <textarea
              {...p}
              className="field min-h-24 font-mono text-[16px]"
              required
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="AA-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>
        {canPaste && (
          <Button
            type="button"
            variant="secondary"
            full
            icon="copy"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) setKey(text.trim());
              } catch {
                setError("Your phone didn’t allow pasting. Press and hold in the box above, then tap Paste.");
              }
            }}
          >
            Paste my key
          </Button>
        )}
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          Get back into my event
        </Button>
        {installed && (
          <Notice tone="info" title="Joined in Safari first?">
            Enter your key here once and your event moves into the app.
          </Notice>
        )}
        <Notice tone="info">
          <span className="flex gap-2">
            <Icon name="key" size={18} className="mt-0.5 shrink-0" />
            <span>
              Your old phone is signed out of that event. Nothing you paid or owe changes. Lost your key too? Ask the organizer.
            </span>
          </span>
        </Notice>
      </form>
    </PageShell>
  );
}
