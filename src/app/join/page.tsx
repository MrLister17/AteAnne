"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "@/ui/api";
import { PageShell } from "@/ui/components/Shell";
import { Button, Notice } from "@/ui/components/ui";
import { CredentialReveal } from "@/ui/components/CredentialReveal";
import { IntentPicker } from "@/ui/components/IntentPicker";
import { StepProgress } from "@/ui/components/StepProgress";
import { looksLikeRecoveryKey } from "@/ui/recovery";
import { InstallFirst } from "@/ui/pwa/InstallFirst";

const STEPS = 3;
/** Answers from the server about the code itself send you back to the code question. */
const CODE_ERRORS = new Set(["not_found", "code_expired", "joins_closed"]);
/** Join codes are 10 letters and numbers; the dash and spaces are optional. */
const isFullCode = (c: string) => c.replace(/[^A-Za-z0-9]/g, "").length === 10;

/** One question per screen: the code, your name, then who paid (D68). A pasted recovery key skips straight to recovery. */
export default function Join() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState<"WILL_PAY_ONLY" | "PAID_EXPENSE">("WILL_PAY_ONLY");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ eventId: string; recoveryKey: string; recovered?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  // People often paste their recovery key here. Recognise it and use it, instead of failing as a "wrong code".
  const isKey = looksLikeRecoveryKey(code);

  // Shared links carry the code in the fragment (never sent to servers or logs); clear it after reading.
  // The link already answered the first question, so start at the name (Back still shows the code).
  useEffect(() => {
    const m = /code=([A-Za-z0-9-]+)/.exec(window.location.hash);
    if (m) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
      setCode(m[1].toUpperCase()); if (isFullCode(m[1])) setStep(1);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (joined) {
    return (
      <PageShell title={joined.recovered ? "Welcome back" : "You’re in"} back={null}>
        {joined.recovered && (
          <div className="mb-4">
            <Notice tone="receive">This phone is you again in that event, so save the new key below (the old one stopped working)</Notice>
          </div>
        )}
        <CredentialReveal recoveryKey={joined.recoveryKey} onDone={() => router.replace(`/e/${joined.eventId}`)} doneLabel="Open the event" />
      </PageShell>
    );
  }

  const onCode = step === 0;
  const typing = onCode
    ? {
        label: "Join code",
        value: code,
        set: (v: string) => setCode(looksLikeRecoveryKey(v) ? v.trim() : v.toUpperCase()), // recovery keys are case-sensitive
        hint: isKey ? "That’s your personal recovery key, not a join code, so we’ll use it to bring you back into your event" : "Ask the organizer for the 10-character code",
        empty: "Paste or type the code from the organizer",
      }
    : { label: "Your name in this group", value: name, set: setName, hint: "A name your friends will recognize", empty: "Add your name so the group knows it’s you" };
  const finalStep = step === 2 || (onCode && isKey);

  const goBack = () => {
    setMissing(null);
    setError(null);
    setStep((s) => s - 1);
    // From the name back to the code it's the same box: focus it during the tap so the iPhone keyboard comes up.
    if (step === 1) inputRef.current?.focus();
  };

  const submit = async () => {
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
      if (!isKey && err instanceof ApiError && CODE_ERRORS.has(err.code)) {
        setStep(0);
        setMissing(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  };

  const describedBy = `${inputId}-hint`;
  return (
    <PageShell title="Join with a code" onBack={step > 0 ? goBack : undefined}>
      <InstallFirst joinCode={isKey ? undefined : code} recovery={isKey}>
        <form
          noValidate
          className="mt-2 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (finalStep) return void submit();
            if (!typing.value.trim()) {
              setMissing(typing.empty);
              inputRef.current?.focus();
              return;
            }
            if (onCode && !isFullCode(code)) {
              setMissing("A join code has 10 letters and numbers, like K7MPQ-2XRTA");
              inputRef.current?.focus();
              return;
            }
            setMissing(null);
            setStep(step + 1);
          }}
        >
          {!(onCode && isKey) && <StepProgress step={step} total={STEPS} />}

          {step < 2 ? (
            <div className="space-y-2">
              <label htmlFor={inputId} className="block text-[22px] leading-snug font-bold">
                <span key={step} className="animate-step inline-block">
                  {typing.label}
                </span>
              </label>
              {/* The code and the name share this one box (no key), so going forward keeps it focused and the iPhone
                  keyboard stays up. autoFocus puts the cursor in it when it first appears and when coming back from "Who paid?". */}
              <input
                ref={inputRef}
                id={inputId}
                autoFocus
                className={onCode ? `field tnum font-mono ${isKey ? "text-[15px] break-all" : "text-[20px] tracking-[0.1em] uppercase"}` : "field"}
                autoCapitalize={onCode ? "characters" : undefined}
                autoCorrect={onCode ? "off" : undefined}
                spellCheck={onCode ? false : undefined}
                autoComplete={onCode ? "one-time-code" : "nickname"}
                // Long enough for a pasted recovery key (≈46 characters), so it is never cut off.
                maxLength={onCode ? 120 : 40}
                enterKeyHint={onCode && isKey ? "go" : "next"}
                value={typing.value}
                placeholder={onCode ? "XXXXX-XXXXX" : "e.g. Juan"}
                aria-invalid={missing ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => {
                  typing.set(e.target.value);
                  if (missing) setMissing(null);
                }}
              />
              <p id={describedBy} role={missing ? "alert" : undefined} className={`text-[14px] ${missing ? "text-pay" : "text-muted"}`}>
                {missing ?? typing.hint}
              </p>
            </div>
          ) : (
            <div className="animate-step">
              <IntentPicker value={intent} onChange={setIntent} size="lg" />
            </div>
          )}

          {error && <Notice tone="pay">{error}</Notice>}
          {/* Tapping Next leaves the cursor in the text box, so the iPhone keyboard doesn't drop between the code and the name. */}
          <Button type="submit" full busy={busy} onMouseDown={finalStep ? undefined : (e) => e.preventDefault()}>
            {onCode && isKey ? "Get back into my event" : step < 2 ? "Next" : "Join event"}
          </Button>
          {onCode && !isKey && (
            <p className="text-center text-[15px]">
              Already joined before?{" "}
              <Link href="/recover" className="font-semibold text-violet underline underline-offset-2">
                Use your recovery key
              </Link>
            </p>
          )}
        </form>
      </InstallFirst>
    </PageShell>
  );
}
