"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { initials, phpAbs } from "../format";
import { Icon, IconName } from "./Icon";

/* ---------------------------------------------------------------- Button */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "receive";
const VARIANT: Record<Variant, string> = {
  primary: "bg-violet text-violet-ink shadow-sm active:opacity-90",
  secondary: "bg-surface text-ink border border-line active:bg-surface-2",
  ghost: "bg-transparent text-violet active:bg-violet-soft",
  danger: "bg-pay-soft text-pay border border-pay/30 active:opacity-90",
  receive: "bg-receive text-white active:opacity-90 dark:text-[#0f2219]",
};

export function Button({
  variant = "primary",
  icon,
  busy,
  full,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; busy?: boolean; full?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-semibold transition disabled:opacity-50 ${VARIANT[variant]} ${full ? "w-full" : ""} ${className}`}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span className="inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

/* ---------------------------------------------------------------- Fields */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      {children({ id, "aria-describedby": hint || error ? hintId : undefined, "aria-invalid": error ? true : undefined })}
      {(hint || error) && (
        <p id={hintId} className={`text-[14px] ${error ? "text-pay" : "text-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Peso amount input with decimal keypad on iPhone. */
export function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">₱</span>
      <input inputMode="decimal" autoComplete="off" placeholder="0.00" {...props} className={`field tnum pl-8 ${props.className ?? ""}`} />
    </div>
  );
}

/* ---------------------------------------------------------------- Display */

export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "li" | "article" }) {
  return <Tag className={`card p-4 ${className}`}>{children}</Tag>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "violet" | "receive" | "pay" | "warn" | "coral"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    violet: "bg-violet-soft text-violet",
    receive: "bg-receive-soft text-receive",
    pay: "bg-pay-soft text-pay",
    warn: "bg-warn-soft text-warn",
    coral: "bg-coral-soft text-coral",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tones[tone]}`}>{children}</span>;
}

const AVATAR_TONES = ["bg-violet-soft text-violet", "bg-coral-soft text-coral", "bg-receive-soft text-receive", "bg-warn-soft text-warn"];

export function Avatar({ name, seq = 0, size = 36 }: { name: string; seq?: number; size?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${AVATAR_TONES[seq % AVATAR_TONES.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * Balance direction is always expressed with words, a sign and an icon —
 * colour only reinforces it (WCAG: never colour alone).
 */
export function balanceLabel(net: string | bigint): { tone: "receive" | "pay" | "neutral"; text: string; sign: string; icon: IconName } {
  const v = typeof net === "string" ? BigInt(net) : net;
  if (v > 0n) return { tone: "receive", text: "Net to receive", sign: "+", icon: "arrowDown" };
  if (v < 0n) return { tone: "pay", text: "Net to pay", sign: "−", icon: "arrowUp" };
  return { tone: "neutral", text: "Settled", sign: "", icon: "check" };
}

export function BalanceBanner({ net, caption, estimate }: { net: string; caption?: string; estimate?: boolean }) {
  const b = balanceLabel(net);
  const tone = b.tone === "receive" ? "bg-receive-soft text-receive" : b.tone === "pay" ? "bg-pay-soft text-pay" : "bg-surface-2 text-ink";
  return (
    <div className={`rounded-2xl p-4 ${tone}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <Icon name={b.icon} size={18} />
        {b.text}
        {estimate && <span className="ml-auto rounded-full bg-surface/70 px-2 py-0.5 text-[12px] text-muted">Estimate</span>}
      </div>
      <div className="tnum mt-1 text-[32px] leading-tight font-bold">
        {b.sign}
        {phpAbs(net)}
      </div>
      {caption && <p className="mt-1 text-[14px] opacity-80">{caption}</p>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "pay" | "receive"; title?: string; children?: React.ReactNode }) {
  const t = { info: "bg-violet-soft text-ink", warn: "bg-warn-soft text-ink", pay: "bg-pay-soft text-ink", receive: "bg-receive-soft text-ink" }[tone];
  const icon: IconName = tone === "info" ? "info" : tone === "receive" ? "check" : "alert";
  const iconTone = { info: "text-violet", warn: "text-warn", pay: "text-pay", receive: "text-receive" }[tone];
  return (
    <div className={`flex gap-3 rounded-2xl p-3.5 text-[15px] ${t}`} role={tone === "pay" ? "alert" : undefined}>
      <Icon name={icon} className={`mt-0.5 shrink-0 ${iconTone}`} size={20} />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Blockers({ items, title = "Still needed" }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <Notice tone="warn" title={title}>
      <ul className="list-disc space-y-0.5 pl-4">
        {items.slice(0, 12).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
        {items.length > 12 && <li>…and {items.length - 12} more</li>}
      </ul>
    </Notice>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-end justify-between px-1">
      <h2 className="text-[13px] font-bold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- Sheet (modal) */

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      className="m-0 mt-auto h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-[520px]"
    >
      {open && (
        <div className="animate-sheet flex h-full flex-col bg-bg sm:rounded-3xl">
          <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
            <div className="flex min-h-14 items-center gap-2 px-2">
              <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full text-violet active:bg-violet-soft" aria-label="Close">
                <Icon name="x" />
              </button>
              <h2 className="truncate text-[17px] font-bold">{title}</h2>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
          {footer && <footer className="safe-bottom border-t border-line bg-bg/95 px-4 pt-3 pb-3 backdrop-blur">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------- Toasts */

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4" style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 12px)" }} aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={`animate-sheet pointer-events-auto max-w-[480px] rounded-2xl px-4 py-3 text-[15px] font-medium shadow-lg ${t.tone === "error" ? "bg-pay text-white dark:text-black" : "bg-ink text-bg"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ---------------------------------------------------------------- Copy / share */

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      icon={done ? "check" : "copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function Progress({ value, max, tone = "violet", pending = 0 }: { value: number; max: number; tone?: "violet" | "receive"; pending?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const pend = max > 0 ? Math.min(100 - pct, (pending / max) * 100) : 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className={tone === "receive" ? "bg-receive" : "bg-violet"} style={{ width: `${pct}%` }} />
      <div className="bg-warn/60" style={{ width: `${pend}%` }} />
    </div>
  );
}
