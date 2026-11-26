"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Disclosure, Field, Notice } from "@/ui/components/ui";
import { CURRENCIES } from "@/domain/money/Currency";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { IntentPicker } from "@/ui/components/IntentPicker";
import { InstallFirst } from "@/ui/pwa/InstallFirst";
import { StepProgress } from "@/ui/components/StepProgress";

const STEPS = 3;

/** One question per screen: the occasion, your name, then who paid (D67). */
export default function NewEvent() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState<"WILL_PAY_ONLY" | "PAID_EXPENSE">("PAID_EXPENSE");
  const [currency, setCurrency] = useState("PHP");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ eventId: string; joinCode: string; recoveryKey: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  if (created) {
    return (
      <PageShell title="Event created" back={null}>
        <CredentialReveal recoveryKey={created.recoveryKey} joinCode={`${created.joinCode.slice(0, 5)}-${created.joinCode.slice(5)}`} onDone={() => router.replace(`/e/${created.eventId}`)} doneLabel="Open my event" />
      </PageShell>
    );
  }

  const typing =
    step === 0
      ? { label: "What’s the occasion?", value: title, set: setTitle, max: 80, placeholder: "e.g. Friday dinner", autoComplete: "off", empty: "Give the occasion a name" }
      : { label: "Your name in this group", value: name, set: setName, max: 40, placeholder: "e.g. Mark", autoComplete: "nickname", empty: "Add your name so the group knows it’s you" };

  const goBack = () => {
    setMissing(null);
    setError(null);
    setStep((s) => s - 1);
    // From the name back to the occasion it's the same box: focus it during the tap so the iPhone keyboard comes up.
    // From "Who paid?" the box mounts again and autoFocus handles it.
    if (step === 1) inputRef.current?.focus();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.post("/api/events", { title, note, displayName: name, intent, currency }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the event");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Start a split" onBack={step > 0 ? goBack : undefined}>
      <InstallFirst>
        <form
          noValidate
          className="mt-2 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 2) return void create();
            if (!typing.value.trim()) {
              setMissing(typing.empty);
              inputRef.current?.focus();
              return;
            }
            setMissing(null);
            setStep(step + 1);
          }}
        >
          <StepProgress step={step} total={STEPS} />

          {step < 2 ? (
            <div className="space-y-2">
              <label htmlFor={inputId} className="block text-[22px] leading-snug font-bold">
                <span key={step} className="animate-step inline-block">
                  {typing.label}
                </span>
              </label>
              {/* The two typing questions share this one box (no key), so going forward keeps it focused and the iPhone
                  keyboard stays up. autoFocus puts the cursor in it when it first appears and when coming back from "Who paid?". */}
              <input
                ref={inputRef}
                id={inputId}
                autoFocus
                className="field"
                maxLength={typing.max}
                autoComplete={typing.autoComplete}
                enterKeyHint="next"
                value={typing.value}
                placeholder={typing.placeholder}
                aria-invalid={missing ? true : undefined}
                aria-describedby={missing ? `${inputId}-missing` : undefined}
                onChange={(e) => {
                  typing.set(e.target.value);
                  if (missing) setMissing(null);
                }}
              />
              {missing && (
                <p id={`${inputId}-missing`} role="alert" className="text-[14px] text-pay">
                  {missing}
                </p>
              )}
            </div>
          ) : (
            <div className="animate-step space-y-5">
              <IntentPicker value={intent} onChange={setIntent} size="lg" />
              <Disclosure summary="More options (note, currency)">
                <Field label="Note (optional)">
                  {(p) => <textarea {...p} className="field min-h-20" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the group should know" />}
                </Field>
                <Field label="Settle up in" hint="Receipts in other currencies are converted to this one">
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
            </div>
          )}

          {error && <Notice tone="pay">{error}</Notice>}
          {/* Tapping Next leaves the cursor in the text box, so the iPhone keyboard doesn't drop between the two typing questions. */}
          <Button type="submit" full busy={busy} onMouseDown={step < 2 ? (e) => e.preventDefault() : undefined}>
            {step < 2 ? "Next" : "Create event"}
          </Button>
          {step === 2 && <p className="text-center text-[13px] text-muted">You’ll be the organizer, and events are deleted after 30 days</p>}
        </form>
      </InstallFirst>
    </PageShell>
  );
}
