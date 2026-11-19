"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { rateFromDay, type ExchangeRate } from "@/domain/fx/ExchangeRate";
import { formatMinor } from "@/domain/money/Currency";
import { ApiError } from "../api";
import { useToast } from "../components/ui";
import { money as fmtMoney, moneyAbs as fmtMoneyAbs } from "../format";

export type View = EventView;
export type ReceiptView = View["receipts"][number];
export type LineView = ReceiptView["lines"][number];
export type EdgeView = NonNullable<View["settlement"]>["edges"][number];

export interface EventCtx {
  view: View;
  /** Fetch the latest view. Resolves true when it worked. */
  reload: () => Promise<boolean>;
  setTab: (tab: TabId) => void;
  /** Open a tab at one thing: a receipt (Claim/Receipts), a transfer (Pay) or your payment details. */
  goTo: (tab: TabId, focus?: FocusTarget) => void;
  /** The last goTo target; `seq` changes on every call so the same target can be opened twice. */
  focus: (FocusTarget & { seq: number }) | null;
  /** Organizer/admin: act for a guest (null = back to yourself). */
  actAs: (memberId: string | null) => void;
  /** Open the big, simple "show this to them" screen for one person. */
  showPerson: (memberId: string) => void;
  /** "Show totals in" (D60): the currency this person views totals in (the settle-up currency by default). */
  viewCurrency: string;
  setViewCurrency: (code: string) => void;
}

/** Today's rate from one currency to another, from the view's cached ECB table (null when unavailable). */
export function todayRate(view: View, from: string, to: string): ExchangeRate | null {
  if (from === to || !view.fx.today || !view.fx.day) return null;
  return rateFromDay({ ...view.fx.today, day: view.fx.day }, from, to);
}

/** Currencies offered in "Show totals in": the settle-up currency, every receipt currency, and pesos. */
export function viewCurrencies(view: View): string[] {
  return [...new Set([...view.fx.used, "PHP"])];
}

export type TabId = "overview" | "receipts" | "claim" | "money" | "people";

export interface FocusTarget {
  receiptId?: string;
  transferId?: string;
  /** Open "How you get paid". */
  payDetails?: boolean;
  /** Home: scroll to the invite card. */
  invite?: boolean;
}

export const EventContext = createContext<EventCtx | null>(null);

export function useEvent() {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEvent outside EventContext");
  const { view } = ctx;
  const name = useCallback((id: string) => view.members.find((m) => m.id === id)?.displayName ?? "Someone", [view.members]);
  const seq = useCallback((id: string) => view.members.find((m) => m.id === id)?.seq ?? 0, [view.members]);
  const currency = view.event.currency;
  /** Exact amount; settle-up currency unless another is given (a receipt's own currency, a payment's). */
  const money = useCallback((minor: string | bigint | null | undefined, ccy: string = currency) => fmtMoney(minor, ccy), [currency]);
  const moneyAbs = useCallback((minor: string | bigint, ccy: string = currency) => fmtMoneyAbs(minor, ccy), [currency]);
  const viewRate = useMemo(() => todayRate(view, currency, ctx.viewCurrency), [view, currency, ctx.viewCurrency]);
  /**
   * A settle-up total as this person chose to see it (D60): exact when viewing
   * the settle-up currency, otherwise "≈ THB 512.31" at today's rate. Never
   * used for anything someone pays or confirms.
   */
  const shown = useCallback(
    (minor: string | bigint, opts: { abs?: boolean } = {}) => {
      const v = typeof minor === "string" ? BigInt(minor) : minor;
      const a = v < 0n ? -v : v;
      if (!viewRate) return opts.abs ? fmtMoneyAbs(a, currency) : fmtMoney(v, currency);
      const converted = viewRate.convert(a);
      return `≈ ${formatMinor(opts.abs || v >= 0n ? converted : -converted, viewRate.quote)}`;
    },
    [viewRate, currency],
  );
  return { ...ctx, me: view.me, event: view.event, name, seq, currency, money, moneyAbs, shown, viewRate };
}

/**
 * Short, plain reason an action failed. Offline and server errors never
 * blame the person; 409 conflicts keep the server's own explanation.
 */
export function actionErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Nothing was changed.";
  if (e.status === 0) return e.code === "aborted" ? "Stopped." : "Couldn’t save. Check your connection and try again.";
  if (e.status === 429) {
    const seconds = Number(e.data.retryAfterSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return `Too many tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return "Too many tries. Try again in a minute.";
  }
  if (e.status >= 500 || e.status === 408) return "Couldn’t save. Try again.";
  const extra = e.blockers.length ? ` ${e.blockers.slice(0, 2).join(" ")}` : "";
  return `${e.message}${extra}`;
}

export interface ActionOptions {
  /** Show the reason next to the button instead of in a toast. */
  onError?: (message: string) => void;
}

/**
 * Run a mutation: show a toast, surface 409 blockers/conflicts verbatim,
 * and always reload the server-computed view afterwards (no client math is
 * ever trusted as final). Resolves to undefined when it failed.
 */
export function useAction() {
  const { reload } = useEvent();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string, opts: ActionOptions = {}): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (success) toast(success);
        await reload();
        return out;
      } catch (e) {
        const message = actionErrorMessage(e);
        if (opts.onError) opts.onError(message);
        else toast(message, "error");
        if (e instanceof ApiError && e.status === 409) await reload();
        return undefined;
      }
    },
    [reload, toast],
  );
}

/**
 * One action with its own inline error: `run(fn, success)` clears the last
 * error, runs the action and keeps the reason to show beside the button.
 */
export function useInlineAction() {
  const act = useAction();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    <T,>(fn: () => Promise<T>, success?: string) => {
      setError(null);
      return act(fn, success, { onError: setError });
    },
    [act],
  );
  return { run, error, clearError: () => setError(null) };
}
