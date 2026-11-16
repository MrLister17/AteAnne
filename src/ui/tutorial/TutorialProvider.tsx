"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { TUTORIAL_STEPS } from "./steps";

/** Per-browser convenience flag only (no personal data). Safe if storage is blocked. */
export const TUTORIAL_KEY = "ateanne.tutorial.v1";

function readFlag(): string | null {
  try {
    return localStorage.getItem(TUTORIAL_KEY);
  } catch {
    return null;
  }
}
function writeFlag(value: "asked" | "done") {
  try {
    localStorage.setItem(TUTORIAL_KEY, value);
  } catch {
    /* private mode — the ask may reappear next visit; harmless */
  }
}

const TutorialCtx = createContext<{ open: () => void }>({ open: () => undefined });
export const useTutorial = () => useContext(TutorialCtx);

/**
 * First visit: a simple ask ("Want a quick walkthrough?"). Any time: the
 * tutorial button opens the full start-to-finish walkthrough.
 */
export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pathname === "/offline") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only flag read after hydration
    if (!readFlag()) setAsking(true);
  }, [pathname]);

  const openTutorial = useCallback(() => {
    setAsking(false);
    setOpen(true);
  }, []);

  return (
    <TutorialCtx.Provider value={{ open: openTutorial }}>
      {children}
      {asking && (
        <WelcomeAsk
          onYes={() => {
            writeFlag("asked");
            openTutorial();
          }}
          onNo={() => {
            writeFlag("asked");
            setAsking(false);
          }}
        />
      )}
      {open && (
        <Walkthrough
          onClose={(finished) => {
            if (finished) writeFlag("done");
            setOpen(false);
          }}
        />
      )}
    </TutorialCtx.Provider>
  );
}

/** Native modal <dialog>: focus trap, Escape and top layer for free. */
function Modal({ onEscape, className, children, ...aria }: { onEscape: () => void; className: string; children: React.ReactNode; "aria-label"?: string; "aria-labelledby"?: string; onKeyDown?: React.KeyboardEventHandler }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      {...aria}
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        onEscape();
      }}
    >
      {children}
    </dialog>
  );
}

function WelcomeAsk({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <Modal onEscape={onNo} aria-labelledby="welcome-title" className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 sm:m-auto sm:max-w-[440px]">
      <div className="animate-sheet safe-bottom rounded-t-3xl bg-bg px-5 pt-5 pb-5 sm:rounded-3xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="size-12 rounded-xl" />
          <div>
            <h2 id="welcome-title" className="text-[20px] font-bold">
              First time here?
            </h2>
            <p className="text-[15px] text-muted">Mabuhay! Want a quick walkthrough?</p>
          </div>
        </div>
        <p className="mt-4 text-[16px]">See how a hatian works from start to finish — adding receipts, claiming what you had, and getting paid back. About a minute.</p>
        <div className="mt-5 grid gap-2">
          <button type="button" autoFocus onClick={onYes} className="btn btn-primary">
            Show me how
          </button>
          <button type="button" onClick={onNo} className="btn btn-secondary">
            Maybe later
          </button>
        </div>
        <p className="mt-3 text-center text-[13px] text-muted">You can open the tutorial anytime with the ? button.</p>
      </div>
    </Modal>
  );
}

function Walkthrough({ onClose }: { onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  const step = TUTORIAL_STEPS[i];
  const last = i === TUTORIAL_STEPS.length - 1;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const go = useCallback((d: number) => setI((n) => Math.min(TUTORIAL_STEPS.length - 1, Math.max(0, n + d))), []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [i]);

  return (
    <Modal
      onEscape={() => onClose(false)}
      aria-label="How to use AteAnne"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/50 sm:m-auto sm:h-[min(820px,92dvh)] sm:max-w-[480px]"
    >
      <div className="flex h-full flex-col bg-bg sm:rounded-3xl">
        <header className="safe-top px-4">
          <div className="flex min-h-14 items-center gap-2">
            <button type="button" onClick={() => onClose(false)} className="icon-btn -ml-2" aria-label="Close tutorial">
              <Icon name="x" />
            </button>
            <p className="flex-1 text-[14px] font-semibold text-muted" aria-live="polite">
              Step {i + 1} of {TUTORIAL_STEPS.length}
            </p>
            {!last && (
              <button type="button" onClick={() => onClose(false)} className="btn btn-ghost !min-h-11 !px-3 !text-[15px]">
                Skip
              </button>
            )}
          </div>
          <div className="flex gap-1" aria-hidden>
            {TUTORIAL_STEPS.map((s, n) => (
              <span key={s.id} className={`h-1.5 flex-1 rounded-full ${n <= i ? "bg-violet" : "bg-line"}`} />
            ))}
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-4"
          onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
          onTouchEnd={(e) => {
            const t = touch.current;
            touch.current = null;
            if (!t) return;
            const dx = e.changedTouches[0].clientX - t.x;
            const dy = e.changedTouches[0].clientY - t.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
          }}
        >
          <div key={step.id} className="animate-sheet">
            <div className="flex min-h-[230px] items-center justify-center">{step.art}</div>
            <span className="mt-6 inline-flex rounded-full bg-coral-soft px-2.5 py-0.5 text-[13px] font-semibold text-coral">{step.who}</span>
            <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-[24px] leading-tight font-bold outline-none">
              {step.title}
            </h2>
            <ul className="mt-3 space-y-2.5 text-[16px] leading-relaxed">
              {step.points.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-violet" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="safe-bottom border-t border-line px-4 pt-3 pb-3">
          {last ? (
            <div className="grid gap-2">
              <Link href="/new" onClick={() => onClose(true)} className="btn btn-primary">
                Start a hatian
              </Link>
              <button type="button" onClick={() => onClose(true)} className="btn btn-secondary">
                Got it
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <button type="button" onClick={() => go(-1)} disabled={i === 0} className="btn btn-secondary">
                Back
              </button>
              <button type="button" onClick={() => go(1)} className="btn btn-primary">
                Next
              </button>
            </div>
          )}
        </footer>
      </div>
    </Modal>
  );
}

/** Tutorial entry points: a card for the home page, a compact "?" for headers. */
export function TutorialButton({ variant = "card" }: { variant?: "card" | "icon" }) {
  const { open } = useTutorial();
  if (variant === "icon") {
    return (
      <button type="button" onClick={open} className="icon-btn" aria-label="Tutorial: how to use AteAnne">
        <Icon name="help" size={22} />
      </button>
    );
  }
  return (
    <button type="button" onClick={open} className="card flex min-h-14 w-full items-center gap-3 px-5 text-left text-[17px] font-semibold active:bg-surface-2">
      <Icon name="help" className="text-coral" />
      <span className="flex-1">
        Tutorial: how to use AteAnne
        <span className="block text-[13px] font-normal text-muted">Full walkthrough, start to finish · 1 min</span>
      </span>
      <Icon name="chevron" size={18} className="text-muted" />
    </button>
  );
}
