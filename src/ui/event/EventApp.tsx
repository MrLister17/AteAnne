"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PHASES, PHASE_LABEL } from "@/domain/event/PhaseMachine";
import { api, ApiError } from "../api";
import { Icon, IconName } from "../components/Icon";
import { Badge, Button, Spinner, ToastProvider } from "../components/ui";
import { phpAbs } from "../format";
import { EventContext, TabId, View } from "./EventContext";
import { OverviewTab } from "./OverviewTab";
import { ReceiptsTab } from "./ReceiptsTab";
import { ClaimTab } from "./ClaimTab";
import { MoneyTab } from "./MoneyTab";
import { PeopleTab } from "./PeopleTab";
import { TutorialButton } from "../tutorial/TutorialProvider";
import { PersonScreen } from "./PersonScreen";

/** Increments per view request, so a slow older reply never overwrites a newer one (e.g. after switching who you act for). */
let viewRequestSeq = 0;

const actingKey = (eventId: string) => `ateanne:acting:${eventId}`;
function readActing(eventId: string): string | null {
  try {
    return typeof window === "undefined" ? null : sessionStorage.getItem(actingKey(eventId));
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

  // Set before any request below runs (effects run in order).
  useEffect(() => {
    api.setActingAs(actingAs);
    return () => api.setActingAs(null);
  }, [actingAs]);

  const reload = useCallback(async () => {
    const mine = ++viewRequestSeq;
    try {
      const next = await api.get<View>(`/api/events/${eventId}`);
      if (mine !== viewRequestSeq) return; // a newer request wins
      setView(next);
      setError(null);
    } catch (e) {
      if (mine !== viewRequestSeq) return;
      if (actingAs && e instanceof ApiError && [400, 403, 404].includes(e.status)) {
        // The guest took over with their own phone, or was removed: go back to being yourself.
        try {
          sessionStorage.removeItem(actingKey(eventId));
        } catch {
          /* private mode */
        }
        setActingAs(null);
        return;
      }
      if (e instanceof ApiError) setError(e);
    }
  }, [eventId, actingAs]);

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
  const setTab = useCallback((t: TabId) => {
    setTabState(t);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  // Live-ish updates: refresh on focus and every 15s while visible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from the server (external system)
    void reload();
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => document.visibilityState === "visible" && void reload(), 15000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [reload]);

  const ctx = useMemo(() => (view ? { view, reload, setTab, actAs, showPerson: setPersonFor } : null), [view, reload, setTab, actAs]);

  if (error && !view) {
    return (
      <main className="safe-top mx-auto max-w-[520px] px-4 pt-16 text-center">
        <Icon name="lock" size={40} className="mx-auto text-muted" />
        <h1 className="mt-4 text-[22px] font-bold">{error.status === 0 ? "You’re offline" : "You can’t open this event here"}</h1>
        <p className="mt-2 text-muted">{error.status === 0 ? error.message : "This phone isn’t a member of that event. Join with the code, or recover access with your personal key."}</p>
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
  if (!ctx) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center text-violet" aria-busy>
        <Spinner />
        <span className="sr-only">Loading event</span>
      </main>
    );
  }

  return (
    <EventContext.Provider value={ctx}>
      <Header view={ctx.view} onRefresh={reload} onStopActing={() => actAs(null)} onShow={() => setPersonFor(ctx.view.me.memberId)} />
      <main className="pb-tabbar mx-auto w-full max-w-[520px] px-4 pt-3">
        {tab === "overview" && <OverviewTab />}
        {tab === "receipts" && <ReceiptsTab />}
        {tab === "claim" && <ClaimTab />}
        {tab === "money" && <MoneyTab />}
        {tab === "people" && <PeopleTab />}
      </main>
      <TabBar tab={tab} setTab={setTab} view={ctx.view} />
      {personFor && <PersonScreen memberId={personFor} onClose={() => setPersonFor(null)} />}
    </EventContext.Provider>
  );
}

/** Sticky header: title, phase progress and my balance — never covers content or buttons. */
function Header({ view, onRefresh, onStopActing, onShow }: { view: View; onRefresh: () => Promise<void>; onStopActing: () => void; onShow: () => void }) {
  const idx = PHASES.indexOf(view.event.phase);
  const myNet = view.settlement?.positions.find((p) => p.memberId === view.me.memberId)?.remaining ?? (view.calculation.ok ? view.calculation.positions.find((p) => p.memberId === view.me.memberId)?.net : null);
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
            {view.event.cancelled ? "Cancelled · unresolved amounts still count" : `Step ${idx + 1} of 5 · ${PHASE_LABEL[view.event.phase]}`}
          </p>
        </div>
        {net !== null && view.event.phase !== "COLLECTING" && (
          <div className="text-right" aria-label="My balance">
            <p className={`tnum text-[15px] font-bold ${net > 0n ? "text-receive" : net < 0n ? "text-pay" : ""}`}>
              {net > 0n ? "+" : net < 0n ? "−" : ""}
              {phpAbs(net)}
            </p>
            <p className="text-[11px] text-muted">{net > 0n ? "to receive" : net < 0n ? "to pay" : "settled"}{frozen ? "" : " · est."}</p>
          </div>
        )}
        <TutorialButton variant="icon" />
        <Button variant="ghost" className="!min-h-11 !min-w-11 !rounded-full !px-2" aria-label="Refresh" onClick={() => onRefresh().then(() => true)}>
          <Icon name="refresh" size={20} />
        </Button>
      </div>
      <ol className="mx-auto flex max-w-[520px] gap-1 px-4 pt-1 pb-2" aria-label="Event progress">
        {PHASES.map((p, i) => (
          <li key={p} className="flex-1" aria-current={i === idx ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i < idx ? "bg-violet" : i === idx ? "bg-coral" : "bg-line"}`} />
            <span className="sr-only">
              {PHASE_LABEL[p]}
              {i < idx ? " (done)" : i === idx ? " (current)" : ""}
            </span>
          </li>
        ))}
      </ol>
      {view.event.cancelled && (
        <div className="mx-auto max-w-[520px] px-4 pb-2">
          <Badge tone="warn">Cancelled — not settled</Badge>
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
  const attention: Partial<Record<TabId, boolean>> = {
    claim: view.event.phase === "ALLOCATING" && view.receipts.some((r) => !r.acks.find((a) => a.memberId === view.me.memberId && a.kind && !a.stale)),
    money:
      (view.event.phase === "REVIEWING" && !view.review.approvedByMe) ||
      Boolean(view.settlement?.edges.some((e) => e.to === view.me.memberId && e.reports.some((r) => r.status === "REPORTED"))),
    receipts: view.event.phase === "COLLECTING" && view.receipts.some((r) => r.payerId === view.me.memberId && !r.fundingAcknowledged),
  };
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md" aria-label="Event sections">
      <ul className="mx-auto grid max-w-[520px] grid-cols-5" style={{ height: "var(--tabbar-h)" }}>
        {TABS.map((t) => (
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
