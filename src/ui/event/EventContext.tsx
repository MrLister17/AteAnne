"use client";

import { createContext, useCallback, useContext } from "react";
import type { EventView } from "@/server/readmodels/EventViewBuilder";
import { ApiError } from "../api";
import { useToast } from "../components/ui";

export type View = EventView;
export type ReceiptView = View["receipts"][number];
export type LineView = ReceiptView["lines"][number];
export type EdgeView = NonNullable<View["settlement"]>["edges"][number];

export interface EventCtx {
  view: View;
  reload: () => Promise<void>;
  setTab: (tab: TabId) => void;
  /** Organizer/admin: act for a guest (null = back to yourself). */
  actAs: (memberId: string | null) => void;
  /** Open the big, simple "show this to them" screen for one person. */
  showPerson: (memberId: string) => void;
}

export type TabId = "overview" | "receipts" | "claim" | "money" | "people";

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
 * Run a mutation: show a toast, surface 409 blockers/conflicts verbatim,
 * and always reload the server-computed view afterwards (no client math is
 * ever trusted as final).
 */
export function useAction() {
  const { reload } = useEvent();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (success) toast(success);
        await reload();
        return out;
      } catch (e) {
        if (e instanceof ApiError) {
          const extra = e.blockers.length ? ` ${e.blockers.slice(0, 2).join(" ")}` : "";
          toast(`${e.message}${extra}`, "error");
          if (e.status === 409) await reload();
        } else {
          toast("Something went wrong. Nothing was changed.", "error");
        }
        return undefined;
      }
    },
    [reload, toast],
  );
}
