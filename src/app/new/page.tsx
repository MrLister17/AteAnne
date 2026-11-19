"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Field, Notice } from "@/ui/components/ui";
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
    <PageShell title="Start a hatian">
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
        <Field label="What’s the occasion?" hint="e.g. Pool party, Sunday dinner, Baguio trip">
          {(p) => <input {...p} className="field" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at Kusina" />}
        </Field>
        <Field label="Note (optional)">
          {(p) => <textarea {...p} className="field min-h-20" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the group should know" />}
        </Field>
        <Field label="Your name in this group" hint="Friends see this. Nicknames are fine.">
          {(p) => <input {...p} className="field" required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mark" />}
        </Field>
        <IntentPicker value={intent} onChange={setIntent} />
        <Field label="Settle up in" hint="Receipts can be in any currency (e.g. baht on a Bangkok trip). Everyone’s share and every transfer is in this one; other currencies convert at the ECB rate of the day they were bought.">
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
        {error && <Notice tone="pay">{error}</Notice>}
        <Button type="submit" full busy={busy}>
          Create event
        </Button>
        <p className="text-center text-[13px] text-muted">Events are deleted automatically 30 days after they’re created, finished or not.</p>
        <p className="text-center text-[13px] text-muted">You become the organizer. Organizers guide the steps but can never confirm payments for someone else.</p>
      </form>
      </InstallFirst>
    </PageShell>
  );
}
