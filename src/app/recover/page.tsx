"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Field, Notice } from "@/ui/components/ui";
import { CredentialReveal } from "@/ui/components/CredentialReveal";

export default function Recover() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ eventId: string; recoveryKey: string } | null>(null);

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

  return (
    <PageShell title="Recover access">
      <form
        className="mt-2 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setDone(await api.post("/api/recover", { key: key.trim() }));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not recover access");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Personal recovery key" hint="Starts with AA- . You saved it when you joined.">
          {(p) => <textarea {...p} className="field min-h-24 font-mono text-[15px]" required autoCapitalize="off" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />}
        </Field>
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          Recover
        </Button>
        <Notice tone="info">
          Recovery moves your identity to this phone and signs the old device out of that event. It never creates a new person or erases what you paid or owe. Without a key or your old device, access can’t be restored in this version.
        </Notice>
      </form>
    </PageShell>
  );
}
