"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { initials, phpAbs, signed } from "../format";
import { currencyInfo } from "@/domain/money/Currency";
import { onActivity } from "../api";
import { Icon, IconName } from "./Icon";

/* ---------------------------------------------------------------- Button */

type Variant = "primary" | "secondary" | "tonal" | "ghost" | "danger" | "receive" | "add";
/** Styles live in globals.css (.btn-*), so plain <button>s can share them. */
const VARIANT: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tonal: "btn-tonal",
  ghost: "btn-ghost",
  danger: "btn-danger",
  receive: "btn-receive",
  add: "btn-add",
};

/** Short vibration where the phone supports it (Android; iPhones ignore it). Never throws. */
export function haptic(kind: "tap" | "ok" | "error" = "tap") {
  try {
    navigator.vibrate?.(kind === "error" ? [30, 50, 30] : kind === "ok" ? 18 : 8);
  } catch {
    /* not supported */
  }
}

type Click = (e: React.MouseEvent<HTMLButtonElement>) => unknown;

/**
 * Every tap answers back: the button dips when pressed (globals.css), shows a
 * spinner and blocks double taps while its action runs (automatically when
 * onClick returns a promise), then flashes a tick when the action succeeded.
 * `busyLabel` ("Saving…") replaces the label while it works; both labels share
 * one grid cell so the button never changes width. With Reduce Motion the
 * spinner becomes a static "…" and the label carries the state (globals.css).
 */
export function Button({
  variant = "primary",
  icon,
  busy,
  busyLabel,
  full,
  className = "",
  children,
  onClick,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { variant?: Variant; icon?: IconName; busy?: boolean; busyLabel?: string; full?: boolean; onClick?: Click }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const working = busy || pending;
  const handle: Click | undefined =
    onClick &&
    ((e) => {
      if (working) return;
      haptic();
      const out = onClick(e);
      if (!(out instanceof Promise)) return;
      setPending(true);
      out
        .then((v) => {
          // useAction resolves to undefined when the action failed (it already showed the reason).
          if (!alive.current || v === undefined || v === false) return;
          setDone(true);
          setTimeout(() => alive.current && setDone(false), 1400);
        })
        .catch(() => undefined)
        .finally(() => alive.current && setPending(false));
    });
  const swap = Boolean(busyLabel) && working;
  return (
    <button
      type="button"
      {...rest}
      onClick={handle}
      disabled={rest.disabled || working}
      aria-busy={working || undefined}
      className={`btn ${VARIANT[variant]} ${full ? "w-full" : ""} ${className}`}
    >
      {working ? <Spinner /> : done ? <Icon name="check" size={20} className="animate-pop" /> : icon ? <Icon name={icon} size={20} /> : null}
      {busyLabel ? (
        <span className="btn-label">
          <span className={swap ? "invisible" : undefined} aria-hidden={swap || undefined}>
            {children}
          </span>
          <span className={swap ? undefined : "invisible"} aria-hidden={!swap || undefined}>
            {busyLabel}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/** Spinning ring; a static "…" when Reduce Motion is on (globals.css `.spinner`). */
export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

/**
 * The reason an action failed, shown right next to its button (not only in a
 * toast at the top of the screen). Announced to screen readers as an alert.
 */
export function ActionError({ message, className = "" }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`flex items-start gap-2 text-[14px] font-medium text-pay ${className}`} data-testid="action-error">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      <span>{message}</span>
    </p>
  );
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

/** Amount input with the currency's sign; decimal keypad on iPhone (whole-number keypad for yen, won, rupiah). */
export function MoneyInput({ currency = "PHP", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { currency?: string }) {
  const info = currencyInfo(currency);
  const pad = info.symbol.length >= 3 ? "pl-14" : info.symbol.length === 2 ? "pl-11" : "pl-8";
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" aria-hidden>
        {info.symbol}
      </span>
      <input inputMode={info.exponent === 0 ? "numeric" : "decimal"} autoComplete="off" placeholder={info.exponent === 0 ? "0" : "0.00"} {...props} className={`field tnum ${pad} ${props.className ?? ""}`} />
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

/** `display`: the amount as the person chose to see it (D60), e.g. "≈ THB 512.31"; `exact` then shows the real figure underneath. */
/** `label` overrides the direction word, e.g. "Credit" when paying ahead made the balance positive (D64). */
export function BalanceBanner({ net, caption, estimate, display, exact, label }: { net: string; caption?: string; estimate?: boolean; display?: string; exact?: string; label?: string }) {
  const b = balanceLabel(net);
  const tone = b.tone === "receive" ? "bg-receive-soft text-receive" : b.tone === "pay" ? "bg-pay-soft text-pay" : "bg-surface-2 text-ink";
  return (
    <div className={`rounded-2xl p-4 ${tone}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <Icon name={b.icon} size={18} />
        {label ?? b.text}
        {estimate && <span className="ml-auto rounded-full bg-surface/70 px-2 py-0.5 text-[12px] text-muted">Estimate</span>}
      </div>
      <div className="tnum mt-1 text-[32px] leading-tight font-bold break-words">
        {signed(b.sign, display ?? phpAbs(net))}
      </div>
      {exact && <p className="tnum text-[15px] font-semibold opacity-90">{exact}</p>}
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
      <div className="min-w-0 space-y-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * What still blocks a step. With `limit`, only the first few show until "Show all" is tapped.
 * `quiet` is for plain status ("what the group is waiting on") next to a disabled button,
 * so it doesn't look like something went wrong.
 */
export function Blockers({ items, title = "Still needed", limit, quiet = false }: { items: string[]; title?: string; limit?: number; quiet?: boolean }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const max = limit && !all ? limit : 12;
  const hidden = items.length - max;
  const list = (
    <>
      <ul className={`list-disc space-y-0.5 pl-4 ${quiet ? "mt-1 text-muted" : ""}`}>
        {items.slice(0, max).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
        {hidden > 0 && max === 12 && <li>…and {hidden} more</li>}
      </ul>
      {hidden > 0 && max < 12 && (
        <button type="button" onClick={() => setAll(true)} className="-ml-1 min-h-11 px-1 font-semibold text-violet underline underline-offset-2">
          Show all {items.length}
        </button>
      )}
    </>
  );
  if (quiet) {
    return (
      <div className="rounded-2xl bg-surface-2 p-3.5 text-[14px] break-words">
        <p className="font-semibold">{title}</p>
        {list}
      </div>
    );
  }
  return (
    <Notice tone="warn" title={title}>
      {list}
    </Notice>
  );
}

/**
 * A clearly worded row that opens to show controls people rarely need
 * ("Need to fix something? Go back a step"). Keeps a screen calm while still
 * telling everyone where the option lives. Native <details>: keyboard and
 * screen readers work without extra code.
 */
export function Disclosure({ summary, icon, children, className = "", open }: { summary: React.ReactNode; icon?: IconName; children: React.ReactNode; className?: string; open?: boolean }) {
  return (
    <details className={`[&[open]>summary>svg:last-child]:rotate-90 ${className}`} open={open}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-violet [&::-webkit-details-marker]:hidden">
        {icon && <Icon name={icon} size={18} className="shrink-0" />}
        <span className="min-w-0 flex-1">{summary}</span>
        <Icon name="chevron" size={18} className="shrink-0 transition-transform" />
      </summary>
      <div className="space-y-3 pt-1 pb-1">{children}</div>
    </details>
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

export function Sheet({
  open,
  onClose,
  onBack,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastTitle = useRef(title);
  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    // Navigation inside one sheet keeps the modal open. Announce the new layer
    // and avoid leaving focus on a control that has just disappeared.
    if (open && lastTitle.current !== title) heading.current?.focus();
    lastTitle.current = title;
  }, [open, title]);
  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (ref.current?.open === false && open) onClose();
      }}
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
              <button
                type="button"
                onClick={onBack ?? onClose}
                className="icon-btn shrink-0"
                aria-label={onBack ? "Back" : "Close"}
              >
                <Icon name={onBack ? "back" : "x"} />
              </button>
              <h2
                ref={heading}
                tabIndex={-1}
                className="min-w-0 flex-1 py-3 text-[17px] font-bold break-words"
              >
                {title}
              </h2>
              {onBack && (
                <button
                  type="button"
                  onClick={onClose}
                  className="icon-btn shrink-0"
                  aria-label="Close"
                >
                  <Icon name="x" />
                </button>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {children}
          </div>
          {footer && (
            <footer className="safe-bottom border-t border-line bg-bg/95 px-4 pt-3 pb-3 backdrop-blur">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------- Toasts */

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

/**
 * Toasts and the "working…" bar live in a popover so they sit in the browser's
 * top layer. Pop-up sheets are modal <dialog>s, which cover everything that is
 * not in the top layer, so without this a message shown while a sheet is open
 * (e.g. "Couldn’t save") would be hidden behind it.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const raise = useCallback(() => {
    const el = layer.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      el.showPopover();
    } catch {
      /* popover not supported: the layer still renders as a normal fixed element */
    }
  }, []);
  const push = useCallback(
    (text: string, tone: Toast["tone"] = "ok") => {
      const id = Date.now() + Math.random();
      haptic(tone === "error" ? "error" : "ok");
      setToasts((t) => [...t.slice(-2), { id, text, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3000);
    },
    [],
  );
  useEffect(() => {
    // iOS Safari only applies :active (the press effect) when a touch listener exists.
    const noop = () => undefined;
    document.addEventListener("touchstart", noop, { passive: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onActivity((b) => {
      clearTimeout(timer);
      // Only show the bar when something takes longer than a blink.
      if (b) timer = setTimeout(() => setBusy(true), 180);
      else setBusy(false);
    });
    return () => {
      document.removeEventListener("touchstart", noop);
      clearTimeout(timer);
      off();
    };
  }, []);
  useEffect(() => {
    if (toasts.length || busy) raise();
  }, [toasts, busy, raise]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div ref={layer} popover="manual" className="top-layer">
        {busy && <div className="activity-bar" role="progressbar" aria-label="Working" />}
        {/* Two live regions: confirmations are announced politely, failures interrupt. */}
        <div className="fixed inset-x-0 flex flex-col items-center gap-2 px-4" style={{ top: "calc(var(--safe-top) + 64px)" }}>
          <div className="flex w-full flex-col items-center gap-2" aria-live="polite" role="status">
            {toasts.filter((t) => t.tone === "ok").map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={() => setToasts((all) => all.filter((x) => x.id !== t.id))} />
            ))}
          </div>
          <div className="flex w-full flex-col items-center gap-2" aria-live="assertive" role="alert">
            {toasts.filter((t) => t.tone === "error").map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={() => setToasts((all) => all.filter((x) => x.id !== t.id))} />
            ))}
          </div>
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      onClick={onDismiss}
      className={`pointer-events-auto flex max-w-[480px] items-start gap-2.5 rounded-2xl px-4 py-3 text-[15px] font-medium shadow-lg ${t.tone === "error" ? "animate-shake bg-pay text-white dark:text-black" : "animate-sheet bg-ink text-bg"}`}
    >
      <Icon name={t.tone === "error" ? "alert" : "check"} size={20} className="mt-px shrink-0" />
      <span>{t.text}</span>
    </div>
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
