"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Field, Notice } from "@/ui/components/ui";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { IntentPicker } from "@/ui/components/IntentPicker";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState<"WILL_PAY_ONLY" | "PAID_EXPENSE">("WILL_PAY_ONLY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ eventId: string; recoveryKey: string } | null>(null);

  // Shared links carry the code in the fragment (never sent to servers or logs); clear it after reading.
  useEffect(() => {
    const m = /code=([A-Za-z0-9-]+)/.exec(window.location.hash);
    if (m) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
      setCode(m[1].toUpperCase());
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (joined) {
    return (
      <PageShell title="You’re in" back={null}>
        <CredentialReveal recoveryKey={joined.recoveryKey} onDone={() => router.replace(`/e/${joined.eventId}`)} doneLabel="Open the event" />
      </PageShell>
    );
  }

  return (
    <PageShell title="Join with a code">
      <form
        className="mt-2 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api.post<{ eventId: string; recoveryKey: string | null }>("/api/events/join", { code, displayName: name, intent });
            if (res.recoveryKey) setJoined({ eventId: res.eventId, recoveryKey: res.recoveryKey });
            else router.replace(`/e/${res.eventId}`); // already a member on this phone
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not join");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Join code" hint="10 letters/numbers from the organizer, e.g. K7MPQ-2XRTA">
          {(p) => (
            <input
              {...p}
              className="field tnum font-mono text-[20px] tracking-[0.1em] uppercase"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="one-time-code"
              maxLength={14}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
            />
          )}
        </Field>
        <Field label="Your name in this group" hint="Use a name your friends will recognise.">
          {(p) => <input {...p} className="field" required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leanne" />}
        </Field>
        <IntentPicker value={intent} onChange={setIntent} />
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          Join event
        </Button>
        <Notice tone="info">
          The code lets anyone it was forwarded to join, so the organizer checks the roster before locking it. Use one browser per person — a second browser profile would join as someone new.
        </Notice>
      </form>
    </PageShell>
  );
}
