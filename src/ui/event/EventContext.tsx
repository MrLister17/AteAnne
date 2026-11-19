"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { ApiError } from "../api";
import { useToast } from "../components/ui";

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
  return { ...ctx, me: view.me, event: view.event, name, seq };
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
