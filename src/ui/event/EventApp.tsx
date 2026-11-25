"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STEPS, stepOf, type Phase } from "@/domain/event/PhaseMachine";
import { api, ApiError } from "../api";
import { Icon, IconName } from "../components/Icon";
import { Badge, Button, Spinner, ToastProvider, useToast } from "../components/ui";
import { EventContext, FocusTarget, TabId, View, useEvent, viewCurrencies } from "./EventContext";
import { signed } from "../format";
import { OverviewTab } from "./OverviewTab";
import { ReceiptsTab } from "./ReceiptsTab";
import { ClaimTab } from "./ClaimTab";
import { MoneyTab } from "./MoneyTab";
import { PeopleTab } from "./PeopleTab";
import { TutorialButton } from "../tutorial/TutorialProvider";
import { PersonScreen } from "./PersonScreen";
import { everyoneAnswered } from "./todo";
import { tabForNext } from "./next";

/** Increments per view request, so a slow older reply never overwrites a newer one (e.g. after switching who you act for). */
let viewRequestSeq = 0;
/** The refresh on its way, if any: background refreshes wait for it instead of sending another request. */
let viewInFlight: Promise<boolean> | null = null;
/** When the view last loaded, for "Offline · showing 3:42 PM". */
let viewLoadedAt: Date | null = null;

const actingKey = (eventId: string) => `ateanne:acting:${eventId}`;
function readActing(eventId: string): string | null {
  try {
    return typeof window === "undefined" ? null : sessionStorage.getItem(actingKey(eventId));
  } catch {
    return null;
  }
}

/** "Show totals in" is a per-person convenience, remembered per event on this phone only (D60). */
const viewCurrencyKey = (eventId: string) => `ateanne:view-currency:${eventId}`;
function readViewCurrency(eventId: string): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(viewCurrencyKey(eventId));
  } catch {
    return null;
  }
}

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "overview", label: "Home", icon: "home" },
  { id: "receipts", label: "Receipts", icon: "receipt" },
  { id: "claim", label: "Claim", icon: "hand" },
  { id: "money", label: "Money", icon: "wallet" },
  { id: "people", label: "People", icon: "users" },
];

/**
 * Only the tabs you can use in this step (D51). Step 1 "Add & claim": Receipts
 * and Claim. Step 2: Pay. Done: Summary. Home and People always.
 */
export function tabsFor(phase: Phase): { id: TabId; label: string; icon: IconName }[] {
  const ids: TabId[] = phase === "SETTLING" ? ["overview", "money", "receipts", "people"] : phase === "DONE" ? ["overview", "money", "receipts", "people"] : ["overview", "receipts", "claim", "people"];
  return ids.map((id) => {
    const t = TABS.find((x) => x.id === id)!;
    if (id === "money" && phase === "SETTLING") return { ...t, label: "Pay" };
    // After Done, the tab is the record; "See summary" on Home opens it.
    if (id === "money" && phase === "DONE") return { ...t, label: "Summary" };
    return t;
  });
}

/** Said once when the step changes under you (your own action or someone else's). */
const STEP_NEWS: Partial<Record<Phase, string>> = {
  SETTLING: "Bill frozen. Time to pay.",
  COLLECTING: "The organizer reopened the bill to fix it.",
  DONE: "All paid. This split is closed.",
};

export function EventApp({ eventId }: { eventId: string }) {
  return (
    <ToastProvider>
      <EventLoader eventId={eventId} />
    </ToastProvider>
  );
}

function EventLoader({ eventId }: { eventId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTabState] = useState<TabId>("overview");
  // Acting for a guest survives a refresh of this tab, but not closing it.
  const [actingAs, setActingAs] = useState<string | null>(() => readActing(eventId));
  const [personFor, setPersonFor] = useState<string | null>(null);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(() => readViewCurrency(eventId));
  const setViewCurrency = useCallback(
    (code: string) => {
      setChosenCurrency(code);
      try {
        localStorage.setItem(viewCurrencyKey(eventId), code);
      } catch {
        /* private mode: the choice lasts until the page reloads */
      }
    },
    [eventId],
  );

  // Leaving the event (back to Home) ends acting; a page refresh keeps it.
  useEffect(
    () => () => {
      viewLoadedAt = null;
      viewInFlight = null;
      try {
        sessionStorage.removeItem(actingKey(eventId));
      } catch {
        /* private mode */
      }
    },
    [eventId],
  );

  // Set before any request below runs (effects run in order).
  useEffect(() => {
    api.setActingAs(actingAs);
    return () => api.setActingAs(null);
  }, [actingAs]);

  const [stale, setStale] = useState<{ since: string; offline: boolean } | null>(null);

  /** Fetch the latest view. Resolves true when it worked; never throws. */
  const fetchView = useCallback(async (): Promise<boolean> => {
    const mine = ++viewRequestSeq;
    try {
      const next = await api.get<View>(`/api/events/${eventId}`);
      if (mine !== viewRequestSeq) return true; // a newer request wins
      setView(next);
      setError(null);
      setStale(null);
      viewLoadedAt = new Date();
      return true;
    } catch (e) {
      if (mine !== viewRequestSeq) return false;
      if (actingAs && e instanceof ApiError && [400, 403, 404].includes(e.status)) {
        // The guest took over with their own phone, or was removed: go back to being yourself.
        try {
          sessionStorage.removeItem(actingKey(eventId));
        } catch {
          /* private mode */
        }
        setActingAs(null);
        return false;
      }
      if (e instanceof ApiError) setError(e);
      // Keep showing what we had, and say so, when the connection or the server is the problem.
      const transient = !(e instanceof ApiError) || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
      if (viewLoadedAt && transient) {
        setStale({ since: viewLoadedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }), offline: e instanceof ApiError && e.status === 0 });
      }
      return false;
    }
  }, [eventId, actingAs]);

  /** Explicit refresh (after a write, a tap, coming back): always asks the server. */
  const reload = useCallback(() => {
    const run = fetchView().finally(() => {
      if (viewInFlight === run) viewInFlight = null;
    });
    viewInFlight = run;
    return run;
  }, [fetchView]);

  /** Background refresh: skipped while another refresh is still on its way. */
  const refreshQuietly = useCallback(() => viewInFlight ?? reload(), [reload]);

  const actAs = useCallback(
    (memberId: string | null) => {
      try {
        if (memberId) sessionStorage.setItem(actingKey(eventId), memberId);
        else sessionStorage.removeItem(actingKey(eventId));
      } catch {
        /* private mode: acting still works until the page reloads */
      }
      api.setActingAs(memberId);
      setView(null); // never show one person's screen while switching to another
      setActingAs(memberId);
      setTabState("overview");
      history.replaceState(null, "", "#overview");
      window.scrollTo({ top: 0 });
    },
    [eventId],
  );

  // Restore tab from the URL hash so refresh / back keeps your place.
  useEffect(() => {
    const h = window.location.hash.replace("#", "") as TabId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
    if (TABS.some((t) => t.id === h)) setTabState(h);
  }, []);
  const showTab = useCallback((t: TabId) => {
    setTabState(t);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);
  const [focus, setFocus] = useState<(FocusTarget & { seq: number }) | null>(null);
  /** A plain tab change (tab bar, links) forgets any earlier "open at" target. */
  const setTab = useCallback(
    (t: TabId) => {
      setFocus((f) => (f ? { seq: f.seq + 1 } : f));
      showTab(t);
    },
    [showTab],
  );
  const goTo = useCallback(
    (t: TabId, target: FocusTarget = {}) => {
      showTab(t);
      setFocus((f) => ({ ...target, seq: (f?.seq ?? 0) + 1 }));
      const anchor = target.transferId ? `transfer-${target.transferId}` : target.invite ? "invite" : null;
      if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    },
    [showTab],
  );

  // First load, and a quick refresh when you come back to the app.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from the server (external system)
    void reload();
    let lastReturn = 0;
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back fires both "visibilitychange" and "focus": one refresh is enough.
      const now = Date.now();
      if (now - lastReturn < 1500) return;
      lastReturn = now;
      void refreshQuietly();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [reload, refreshQuietly]);

  // Every 15 s while visible, until the event can no longer change (Done or cancelled).
  const settled = view ? view.event.phase === "DONE" || view.event.cancelled : false;
  useEffect(() => {
    if (settled) return;
    const t = setInterval(() => document.visibilityState === "visible" && void refreshQuietly(), 15000);
    return () => clearInterval(t);
  }, [settled, refreshQuietly]);

  // A remembered currency that no longer applies (e.g. the settle-up currency changed) falls back to the settle-up one.
  const viewCurrency = view && chosenCurrency && viewCurrencies(view).includes(chosenCurrency) ? chosenCurrency : (view?.event.currency ?? "PHP");
  const ctx = useMemo(
    () => (view ? { view, reload, setTab, goTo, focus, actAs, showPerson: setPersonFor, viewCurrency, setViewCurrency } : null),
    [view, reload, setTab, goTo, focus, actAs, viewCurrency, setViewCurrency],
  );

  // Tell people when the group moved on, e.g. the bill froze because the last person finished.
  const toast = useToast();
  const seenPhase = useRef<Phase | null>(null);
  const phase = view?.event.phase ?? null;
  useEffect(() => {
    if (!phase) return;
    const news = STEP_NEWS[phase];
    if (seenPhase.current && seenPhase.current !== phase && news) toast(news);
    seenPhase.current = phase;
  }, [phase, toast]);

  if (error && !view) {
    const noAccess = error.status === 403 || error.status === 404 || error.status === 401;
    if (!noAccess) {
      return (
        <main className="safe-top mx-auto max-w-[520px] px-4 pt-16 text-center" data-testid="load-error">
          <Icon name="alert" size={40} className="mx-auto text-muted" />
          <h1 className="mt-4 text-[22px] font-bold">{error.status === 0 ? "You’re offline" : "Couldn’t load this event"}</h1>
          <p className="mt-2 text-muted">{error.status === 0 ? "Check your connection, then try again." : "Something went wrong on our side. Nothing was changed."}</p>
          <div className="mt-6 grid gap-2">
            <Button full icon="refresh" busyLabel="Trying again…" onClick={() => reload()}>
              Try again
            </Button>
            <Link href="/" className="min-h-12 rounded-2xl border border-line px-5 py-3 font-semibold">
              All events
            </Link>
          </div>
        </main>
      );
    }
    return (
      <main className="safe-top mx-auto max-w-[520px] px-4 pt-16 text-center">
        <Icon name="lock" size={40} className="mx-auto text-muted" />
        <h1 className="mt-4 text-[22px] font-bold">You can’t open this event here</h1>
        <p className="mt-2 text-muted">This phone isn’t a member of that event. Join with the code, or recover access with your personal key.</p>
        <div className="mt-6 grid gap-2">
          <Link href="/join" className="min-h-12 rounded-2xl bg-violet px-5 py-3 font-semibold text-violet-ink">
            Join with a code
          </Link>
          <Link href="/recover" className="min-h-12 rounded-2xl border border-line px-5 py-3 font-semibold">
            I have a recovery key
          </Link>
        </div>
      </main>
    );
  }
  if (!ctx) return <LoadingEvent onRetry={reload} />;

  // A tab that isn't part of this step (old link, or the step just changed) falls back to Home.
  const shown: TabId = tabsFor(ctx.view.event.phase).some((t) => t.id === tab) ? tab : "overview";

  return (
    <EventContext.Provider value={ctx}>
      <Header view={ctx.view} stale={stale} onRefresh={reload} onStopActing={() => actAs(null)} onShow={() => setPersonFor(ctx.view.me.memberId)} />
      <main className="pb-tabbar mx-auto w-full max-w-[520px] px-4 pt-3">
        {shown === "overview" && <OverviewTab />}
        {shown === "receipts" && <ReceiptsTab />}
        {shown === "claim" && <ClaimTab />}
        {shown === "money" && <MoneyTab />}
        {shown === "people" && <PeopleTab />}
      </main>
      <TabBar tab={shown} setTab={setTab} view={ctx.view} />
      {personFor && <PersonScreen memberId={personFor} onClose={() => setPersonFor(null)} />}
    </EventContext.Provider>
  );
}

/** Sticky header: title, phase progress and my balance — never covers content or buttons. */
/** First load: the screen's shape right away, words that say what's happening, and a way out if it hangs. */
function LoadingEvent({ onRetry }: { onRetry: () => Promise<boolean> }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="safe-top mx-auto w-full max-w-[520px] px-4 pt-4" aria-busy="true" data-testid="event-loading">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="skeleton size-11 rounded-full" />
        <span className="flex-1 space-y-2">
          <span className="skeleton block h-4 w-2/3 rounded-full" />
          <span className="skeleton block h-3 w-1/3 rounded-full" />
        </span>
      </div>
      <div className="mt-6 space-y-3" aria-hidden>
        <span className="skeleton block h-28 rounded-2xl" />
        <span className="skeleton block h-40 rounded-2xl" />
      </div>
      <div className="mt-6 text-center" role="status">
        <p className="flex items-center justify-center gap-2 font-semibold text-violet">
          <Spinner /> Loading your event…
        </p>
        {slow && <p className="mt-1 text-[14px] text-muted">Still loading. Check your connection.</p>}
      </div>
      {slow && (
        <div className="mt-3">
          <Button full variant="secondary" icon="refresh" busyLabel="Trying again…" onClick={() => onRetry()}>
            Try again
          </Button>
        </div>
      )}
    </main>
  );
}

function Header({ view, stale, onRefresh, onStopActing, onShow }: { view: View; stale: { since: string; offline: boolean } | null; onRefresh: () => Promise<boolean>; onStopActing: () => void; onShow: () => void }) {
  const toast = useToast();
  const { shown } = useEvent();
  const step = stepOf(view.event.phase);
  const myNet = view.settlement?.positions.find((p) => p.memberId === view.me.memberId)?.remaining ?? (view.calculation.ok && everyoneAnswered(view) ? view.calculation.positions.find((p) => p.memberId === view.me.memberId)?.remaining : null);
  const frozen = Boolean(view.settlement);
  const net = myNet ? BigInt(myNet) : null;
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[520px] items-center gap-2 px-2 pt-1">
        <Link href="/" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-violet active:bg-violet-soft" aria-label="All events">
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold">{view.event.title}</h1>
          <p className="truncate text-[13px] text-muted">
            {view.event.cancelled ? "Cancelled · unresolved amounts still count" : `Step ${step.index + 1} of ${STEPS.length} · ${step.label}`}
          </p>
        </div>
        {net !== null && (
          <div className="text-right" aria-label="My balance">
            <p className={`tnum text-[15px] font-bold ${net > 0n ? "text-receive" : net < 0n ? "text-pay" : ""}`}>
              {signed(net > 0n ? "+" : net < 0n ? "−" : "", shown(net, { abs: true }))}
            </p>
            <p className="text-[11px] text-muted">{net > 0n ? "to receive" : net < 0n ? "to pay" : "settled"}{frozen ? "" : " · est."}</p>
          </div>
        )}
        <TutorialButton variant="icon" />
        <Button
          variant="ghost"
          className="!min-h-11 !min-w-11 !rounded-full !px-2"
          aria-label="Refresh"
          onClick={() =>
            onRefresh().then((ok) => {
              if (!ok) toast("Couldn’t refresh. Check your connection.", "error");
              return ok;
            })
          }
        >
          <Icon name="refresh" size={20} />
        </Button>
      </div>
      <ol className="mx-auto flex max-w-[520px] gap-1 px-4 pt-1 pb-2" aria-label="Event progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1" aria-current={i === step.index ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i < step.index || view.event.phase === "DONE" ? "bg-violet" : i === step.index ? "bg-coral" : "bg-line"}`} />
            <span className="sr-only">
              {label}
              {i < step.index ? " (done)" : i === step.index ? " (current)" : ""}
            </span>
          </li>
        ))}
      </ol>
      {view.event.cancelled && (
        <div className="mx-auto max-w-[520px] px-4 pb-2">
          <Badge tone="warn">Cancelled — not settled</Badge>
        </div>
      )}
      {stale && (
        <div className="mx-auto flex max-w-[520px] items-center gap-2 px-4 pb-2 text-[13px] text-muted" role="status" data-testid="stale-banner">
          <Icon name="alert" size={16} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{stale.offline ? "Offline" : "Couldn’t refresh"} · showing {stale.since}</span>
          <button type="button" className="min-h-11 px-2 font-semibold text-violet underline underline-offset-2" onClick={() => void onRefresh()}>
            Try again
          </button>
        </div>
      )}
      {view.actingFor && (
        <div className="bg-coral text-white dark:text-black" role="status" data-testid="acting-banner">
          <div className="mx-auto flex max-w-[520px] items-center gap-2 px-3 py-1.5">
            <Icon name="users" size={20} className="shrink-0" />
            <p className="min-w-0 flex-1 text-[14px] leading-tight">
              <b className="block truncate">Acting for {view.me.displayName}</b>
              <span className="block truncate opacity-90">You ({view.actingFor.byName}) choose for them</span>
            </p>
            <button type="button" onClick={onShow} className="min-h-11 shrink-0 rounded-xl bg-white/20 px-3 text-[14px] font-semibold active:bg-white/30">
              Show
            </button>
            <button type="button" onClick={onStopActing} className="min-h-11 shrink-0 rounded-xl bg-white px-3 text-[14px] font-semibold text-black active:opacity-90">
              Done
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function TabBar({ tab, setTab, view }: { tab: TabId; setTab: (t: TabId) => void; view: View }) {
  // One dot, on the tab where your next step is (D53). Home needs none: the Next card is there.
  const dot = tabForNext(view.next);
  const attention: Partial<Record<TabId, boolean>> = dot && dot !== "overview" ? { [dot]: true } : {};
  const tabs = tabsFor(view.event.phase);
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md" aria-label="Event sections">
      <ul className="mx-auto grid max-w-[520px]" style={{ height: "var(--tabbar-h)", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === t.id ? "text-violet" : "text-muted"}`}
            >
              <Icon name={t.icon} size={24} />
              {t.label}
              {attention[t.id] && <span className="absolute top-2 right-[calc(50%-18px)] size-2.5 rounded-full bg-coral ring-2 ring-surface" aria-label="needs your attention" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
