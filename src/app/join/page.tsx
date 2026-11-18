"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Field, Notice } from "@/ui/components/ui";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { IntentPicker } from "@/ui/components/IntentPicker";
import { looksLikeRecoveryKey } from "@/ui/recovery";
import { InstallFirst } from "@/ui/pwa/InstallFirst";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState<"WILL_PAY_ONLY" | "PAID_EXPENSE">("WILL_PAY_ONLY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ eventId: string; recoveryKey: string; recovered?: boolean } | null>(null);
  // People often paste their recovery key here. Recognise it and use it, instead of failing as a "wrong code".
  const isKey = looksLikeRecoveryKey(code);

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
      <PageShell title={joined.recovered ? "Welcome back" : "You’re in"} back={null}>
        {joined.recovered && (
          <div className="mb-4">
            <Notice tone="receive">This phone is you again in that event. Your old key stopped working; save the new one below.</Notice>
          </div>
        )}
        <CredentialReveal recoveryKey={joined.recoveryKey} onDone={() => router.replace(`/e/${joined.eventId}`)} doneLabel="Open the event" />
      </PageShell>
    );
  }

  return (
    <PageShell title="Join with a code">
      <InstallFirst joinCode={isKey ? undefined : code} recovery={isKey}>
      <form
        className="mt-2 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (isKey) {
              const r = await api.post<{ eventId: string; recoveryKey: string }>("/api/recover", { key: code });
              setJoined({ ...r, recovered: true });
              return;
            }
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
        <Field label="Join code" hint={isKey ? "That’s your personal recovery key, not a join code. We’ll use it to bring you back into your event." : "10 letters/numbers from the organizer, e.g. K7MPQ-2XRTA. Have a recovery key (AA-…)? You can paste it here too."}>
          {(p) => (
            <input
              {...p}
              className={`field tnum font-mono ${isKey ? "text-[15px] break-all" : "text-[20px] tracking-[0.1em] uppercase"}`}
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="one-time-code"
              // Long enough for a pasted recovery key (≈46 characters), so it is never cut off.
              maxLength={120}
              value={code}
              // Recovery keys are case-sensitive; only join codes are upper-cased.
              onChange={(e) => setCode(looksLikeRecoveryKey(e.target.value) ? e.target.value.trim() : e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
            />
          )}
        </Field>
        {!isKey && (
          <>
            <Field label="Your name in this group" hint="Use a name your friends will recognise.">
              {(p) => <input {...p} className="field" required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan" />}
            </Field>
            <IntentPicker value={intent} onChange={setIntent} />
          </>
        )}
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          {isKey ? "Get back into my event" : "Join event"}
        </Button>
        {!isKey && (
          <p className="text-center text-[15px]">
            Already joined before?{" "}
            <Link href="/recover" className="font-semibold text-violet underline underline-offset-2">
              Use your recovery key
            </Link>
          </p>
        )}
        <Notice tone="info">
          The code lets anyone it was forwarded to join, so the organizer checks the roster before locking it. Use one browser per person — a second browser profile would join as someone new.
        </Notice>
      </form>
      </InstallFirst>
    </PageShell>
  );
}
