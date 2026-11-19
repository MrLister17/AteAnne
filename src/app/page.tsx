"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/ui/api";
import { Brand, PageShell } from "@/ui/components/Shell";
import { Badge, Notice, SectionTitle } from "@/ui/components/ui";
import { Icon } from "@/ui/components/Icon";
import { InstallPrompt } from "@/ui/pwa/InstallPrompt";
import { TutorialButton } from "@/ui/tutorial/TutorialProvider";
import { timeAgo } from "@/ui/format";
import { PHASE_LABEL, type Phase } from "@/domain/event/PhaseMachine";
import { isInstalledApp } from "@/ui/recovery";

type MyEvent = { eventId: string; title: string; phase: Phase; cancelled: boolean; isOwner: boolean; displayName: string; currency?: string; updatedAt: string };

/**
 * Start screen (D48). Returning people see their events first; newcomers see
 * what AteAnne is and the install step. Start / Join are the two big actions;
 * the recovery key is a lighter row right under them; help is the "?" icon.
 */
export default function Home() {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    api.get<{ events: MyEvent[] }>("/api/me").then((r) => setEvents(r.events)).catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
    setInstalled(isInstalledApp());
  }, []);
  const returning = Boolean(events?.length);

  return (
    <PageShell>
      <div className="flex items-start justify-between pt-8 pb-2">
        <Brand />
        <TutorialButton variant="icon" />
      </div>

      {returning ? (
        <>
          <SectionTitle>Your events on this phone</SectionTitle>
          <ul className="card divide-y divide-line overflow-hidden p-0">
            {events!.map((e) => (
              <li key={e.eventId}>
                <Link href={`/e/${e.eventId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="text-[14px] text-muted">
                      as {e.displayName}
                      {e.isOwner ? " · organizer" : ""}
                      {e.currency && e.currency !== "PHP" ? ` · ${e.currency}` : ""} · {timeAgo(e.updatedAt)}
                    </p>
                  </div>
                  {e.cancelled ? <Badge tone="warn">Cancelled</Badge> : <Badge tone={e.phase === "DONE" ? "receive" : "violet"}>{PHASE_LABEL[e.phase]}</Badge>}
                  <Icon name="chevron" className="text-muted" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-4 text-[17px] leading-relaxed">
            Split the bill by <b>what each person actually had</b>, not just total ÷ people.
          </p>
          <div className="mt-5">
            <InstallPrompt quiet />
          </div>
        </>
      )}

      <div className={`${returning ? "mt-6" : "mt-4"} grid gap-3`}>
        <Link href="/new" className="flex min-h-14 items-center gap-3 rounded-2xl bg-violet px-5 text-[17px] font-semibold text-violet-ink shadow-sm active:opacity-90">
          <Icon name="plus" /> Start a hatian
        </Link>
        <Link href="/join" className="card flex min-h-14 items-center gap-3 px-5 text-[17px] font-semibold active:bg-surface-2">
          <Icon name="users" className="text-violet" /> Join with a code
        </Link>
        <Link href="/recover" className="flex min-h-12 items-center gap-3 rounded-2xl px-5 text-[16px] font-semibold active:bg-surface-2">
          <Icon name="key" className="text-coral" />
          <span className="flex-1">I have a recovery key</span>
          <Icon name="chevron" size={18} className="text-muted" />
        </Link>
      </div>

      {installed && events !== null && events.length === 0 && (
        <div className="mt-3">
          <Notice tone="info" title="Joined in Safari before adding AteAnne to your Home Screen?">
            The Home Screen app keeps its own sign-in. Tap <b>I have a recovery key</b> and paste the key you saved, once per event, to bring your events here.
          </Notice>
        </div>
      )}

      {returning && (
        <div className="mt-6">
          <InstallPrompt quiet />
        </div>
      )}

      {/* Newcomers see the steps; people who already have events can open them. Remounts when that changes. */}
      <details key={returning ? "returning" : "new"} className="group mt-6" open={!returning}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-1 [&::-webkit-details-marker]:hidden">
          <h2 className="flex-1 text-[13px] font-bold tracking-wide text-muted uppercase">How it works</h2>
          <Icon name="chevron" size={18} className="text-muted transition-transform group-open:rotate-90" />
        </summary>
        <div className="card mt-1 space-y-4 p-4">
          <ol className="space-y-3 text-[15px]">
            {[
              ["receipt", "Add & claim", "Whoever paid adds the receipt. Everyone ticks what they actually had, shared or by piece."],
              ["wallet", "Pay", "When everyone is done, the bill freezes by itself. Pay by cash or QR; the receiver confirms it arrived."],
              ["check", "Done", "Once everything is confirmed, the hatian closes by itself."],
            ].map(([icon, title, text], i) => (
              <li key={title} className="flex gap-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-soft text-violet">
                  <Icon name={icon as "receipt"} size={18} />
                </span>
                <p>
                  <b>
                    {i + 1}. {title}.
                  </b>{" "}
                  <span className="text-muted">{text}</span>
                </p>
              </li>
            ))}
          </ol>
          <TutorialButton variant="inline" />
        </div>
      </details>

      <p className="mt-6 text-center text-[13px] text-muted">No bank logins. No payment processing. Money moves outside the app.</p>
    </PageShell>
  );
}
