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

type MyEvent = { eventId: string; title: string; phase: Phase; cancelled: boolean; isOwner: boolean; displayName: string; updatedAt: string };

export default function Home() {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    api.get<{ events: MyEvent[] }>("/api/me").then((r) => setEvents(r.events)).catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value read after hydration
    setInstalled(isInstalledApp());
  }, []);

  return (
    <PageShell>
      <div className="flex items-start justify-between pt-8 pb-2">
        <Brand />
        <TutorialButton variant="icon" />
      </div>
      <p className="mt-4 text-[17px] leading-relaxed">
        Split the bill by <b>what each person actually had</b>, not just total ÷ people. AteAnne explains every centavo and tracks who has really been paid back.</p>

      <div className="mt-6">
        <InstallPrompt />
      </div>

      <div className="mt-4 grid gap-3">
        <Link href="/new" className="flex min-h-14 items-center gap-3 rounded-2xl bg-violet px-5 text-[17px] font-semibold text-violet-ink shadow-sm active:opacity-90">
          <Icon name="plus" /> Start a hatian
        </Link>
        <Link href="/join" className="card flex min-h-14 items-center gap-3 px-5 text-[17px] font-semibold active:bg-surface-2">
          <Icon name="users" className="text-violet" /> Join with a code
        </Link>
        <Link href="/recover" className="card flex min-h-14 items-center gap-3 px-5 text-[17px] font-semibold active:bg-surface-2">
          <Icon name="key" className="text-coral" /> I have a recovery key
        </Link>
      </div>

      {installed && events !== null && events.length === 0 && (
        <div className="mt-4">
          <Notice tone="info" title="Joined in Safari before adding AteAnne to your Home Screen?">
            The Home Screen app keeps its own sign-in. Tap <b>I have a recovery key</b> and paste the key you saved, once per event, to bring your events here.
          </Notice>
        </div>
      )}

      <div className="mt-3">
        <TutorialButton />
      </div>

      {events && events.length > 0 && (
        <>
          <SectionTitle>Your events on this phone</SectionTitle>
          <ul className="card divide-y divide-line overflow-hidden p-0">
            {events.map((e) => (
              <li key={e.eventId}>
                <Link href={`/e/${e.eventId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="text-[14px] text-muted">
                      as {e.displayName}
                      {e.isOwner ? " · organizer" : ""} · {timeAgo(e.updatedAt)}
                    </p>
                  </div>
                  {e.cancelled ? <Badge tone="warn">Cancelled</Badge> : <Badge tone={e.phase === "DONE" ? "receive" : "violet"}>{PHASE_LABEL[e.phase]}</Badge>}
                  <Icon name="chevron" className="text-muted" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>How it works</SectionTitle>
      <ol className="card space-y-3 text-[15px]">
        {[
          ["receipt", "Collect", "Everyone adds the receipts they paid — items, discounts, service charge."],
          ["hand", "Claim", "Each person ticks what they actually ate or used. Shared or by piece."],
          ["check", "Review", "Everyone approves the same exact split, centavo for centavo."],
          ["wallet", "Settle", "Pay by cash or QR outside the app; the receiver confirms it arrived."],
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

      <p className="mt-6 text-center text-[14px] text-muted">
        Lost your phone or your event is missing?{" "}
        <Link href="/recover" className="font-semibold text-violet underline-offset-2 hover:underline">
          Use your recovery key
        </Link>
      </p>
      <p className="mt-3 text-center text-[13px] text-muted">No bank logins. No payment processing. Money moves outside the app.</p>
    </PageShell>
  );
}
