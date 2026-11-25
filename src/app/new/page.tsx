"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Disclosure, Field, Notice } from "@/ui/components/ui";
import { CURRENCIES } from "@/domain/money/Currency";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { IntentPicker } from "@/ui/components/IntentPicker";
import { InstallFirst } from "@/ui/pwa/InstallFirst";

export default function NewEvent() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState<"WILL_PAY_ONLY" | "PAID_EXPENSE">("PAID_EXPENSE");
  const [currency, setCurrency] = useState("PHP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ eventId: string; joinCode: string; recoveryKey: string } | null>(null);

  if (created) {
    return (
      <PageShell title="Event created" back={null}>
        <CredentialReveal recoveryKey={created.recoveryKey} joinCode={`${created.joinCode.slice(0, 5)}-${created.joinCode.slice(5)}`} onDone={() => router.replace(`/e/${created.eventId}`)} doneLabel="Open my event" />
      </PageShell>
    );
  }

  return (
    <PageShell title="Start a split">
      <InstallFirst>
      <form
        className="mt-2 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setCreated(await api.post("/api/events", { title, note, displayName: name, intent, currency }));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not create the event");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="What’s the occasion?">
          {(p) => <input {...p} className="field" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday dinner" />}
        </Field>
        <Field label="Your name in this group">
          {(p) => <input {...p} className="field" required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mark" />}
        </Field>
        <IntentPicker value={intent} onChange={setIntent} />
        <Disclosure summary="More options (note, currency)">
          <Field label="Note (optional)">
            {(p) => <textarea {...p} className="field min-h-20" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the group should know" />}
          </Field>
          <Field label="Settle up in" hint="Receipts in other currencies are converted to this one.">
            {(p) => (
              <select {...p} className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Disclosure>
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          Create event
        </Button>
        <p className="text-center text-[13px] text-muted">You’ll be the organizer. Events are deleted after 30 days.</p>
      </form>
      </InstallFirst>
    </PageShell>
  );
}
