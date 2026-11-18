import { Icon, IconName } from "../components/Icon";

export type Audience = "Everyone" | "Organizer" | "Whoever paid" | "Person receiving";

export interface TutorialStep {
  id: string;
  who: Audience;
  title: string;
  points: string[];
  art: React.ReactNode;
}

/* ------------------------------------------------------------------ mini mock-ups
   Small static illustrations built from the real design tokens so the
   walkthrough looks like the actual app. Decorative only (aria-hidden). */

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[300px] rounded-[28px] border-[6px] border-ink/85 bg-bg p-3 shadow-card">
      <div className="mx-auto mb-2 h-1.5 w-14 rounded-full bg-ink/20" />
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ left, right, tone }: { left: React.ReactNode; right?: React.ReactNode; tone?: "violet" | "receive" | "pay" | "warn" }) {
  const t = { violet: "border-violet ring-2 ring-violet-soft", receive: "bg-receive-soft", pay: "bg-pay-soft", warn: "bg-warn-soft" };
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] ${tone ? t[tone] : ""}`}>
      <span className="min-w-0 truncate">{left}</span>
      {right && <span className="tnum shrink-0 font-semibold">{right}</span>}
    </div>
  );
}

function Pill({ children, tone = "violet" }: { children: React.ReactNode; tone?: "violet" | "receive" | "pay" | "neutral" }) {
  const t = { violet: "bg-violet text-violet-ink", receive: "bg-receive text-white dark:text-black", pay: "bg-pay-soft text-pay", neutral: "border border-line bg-surface text-ink" };
  return <span className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold ${t[tone]}`}>{children}</span>;
}

function Big({ icon, tone = "violet" }: { icon: IconName; tone?: "violet" | "coral" | "receive" }) {
  const t = { violet: "bg-violet-soft text-violet", coral: "bg-coral-soft text-coral", receive: "bg-receive-soft text-receive" };
  return (
    <span aria-hidden className={`mx-auto flex size-24 items-center justify-center rounded-[28px] ${t[tone]}`}>
      <Icon name={icon} size={48} />
    </span>
  );
}

/* ------------------------------------------------------------------ the walkthrough */

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    who: "Everyone",
    title: "Welcome to AteAnne",
    points: [
      "AteAnne splits a shared bill by what each person actually had, not just total ÷ people.",
      "It runs in 5 steps: Collect → Claim → Review → Settle → Done.",
      "No accounts, no bank logins. Money moves outside the app; AteAnne keeps the exact record.",
    ],
    art: (
      <div aria-hidden className="flex items-center justify-center gap-2">
        {(["receipt", "hand", "check", "wallet"] as IconName[]).map((i, n) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
              <Icon name={i} size={26} />
            </span>
            {n < 3 && <Icon name="chevron" size={16} className="text-muted" />}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "install",
    who: "Everyone",
    title: "Put it on your home screen",
    points: [
      "iPhone: open AteAnne in Safari, tap the Share button, then “Add to Home Screen”.",
      "Android: in Chrome, tap “Install app” (or ⋮ → Add to Home screen).",
      "It then opens full-screen like a normal app.",
    ],
    art: (
      <Phone>
        <Row left={<span className="flex items-center gap-2"><Icon name="share" size={16} className="text-violet" /> Share</span>} />
        <Row left={<span className="flex items-center gap-2"><Icon name="plus" size={16} /> Add to Home Screen</span>} tone="violet" />
        <div className="flex justify-center pt-1">
          <img src="/icons/icon-192.png" alt="" className="size-12 rounded-xl" />
        </div>
      </Phone>
    ),
  },
  {
    id: "start",
    who: "Organizer",
    title: "Start a hatian and invite the group",
    points: [
      "One person taps “Start a hatian”, names the occasion and becomes the organizer.",
      "You get a 10-character join code. Tap “Share link” to send it to your group chat.",
      "Friends tap the link (or “Join with a code”) and enter their name.",
    ],
    art: (
      <Phone>
        <div className="rounded-xl bg-violet-soft py-3 text-center font-mono text-[18px] font-bold tracking-[0.12em] text-violet">K7MPQ-2XRTA</div>
        <div className="grid grid-cols-2 gap-2">
          <Pill tone="neutral"><Icon name="copy" size={14} /> Copy code</Pill>
          <Pill tone="neutral"><Icon name="share" size={14} /> Share link</Pill>
        </div>
        <Row left="Mark · organizer" right="✓" />
        <Row left="Juan joined" right="✓" />
        <Row left="Paolo joined" right="✓" />
      </Phone>
    ),
  },
  {
    id: "key",
    who: "Everyone",
    title: "Save your recovery key",
    points: [
      "Right after you create or join, AteAnne shows a personal recovery key once.",
      "Copy it into Notes or a password manager. If you lose your phone, it brings back the same you — your receipts, claims and payments.",
      "To use it: on the first screen tap “I have a recovery key” and paste it.",
      "Keep it private; don’t post it in the group chat.",
    ],
    art: (
      <Phone>
        <div className="flex items-center gap-2 text-[13px] font-semibold"><Icon name="key" size={18} className="text-coral" /> Your recovery key</div>
        <div className="rounded-lg border border-dashed border-line bg-surface-2 p-2 font-mono text-[11px] break-all">AA-q7Xb…9fK2</div>
        <Pill tone="neutral"><Icon name="copy" size={14} /> Copy recovery key</Pill>
      </Phone>
    ),
  },
  {
    id: "receipts",
    who: "Whoever paid",
    title: "Add the receipts",
    points: [
      "Whoever paid the store opens Receipts and taps “Scan a receipt” to take a photo — the items, service charge and total are filled in for you to check. (Or tap “Add receipt” to type it.)",
      "Choose “Shared equally” (split among whoever had it) or “By piece” (e.g. 3 rice — each person claims pieces).",
      "Check every line against the paper receipt and fix anything misread. The bar turns green when items, discounts and charges add up to the exact total.",
    ],
    art: (
      <Phone>
        <Row left="Sisig (shared equally)" right="₱600.00" />
        <Row left="3× Rice (by piece)" right="₱180.00" />
        <Row left="Pancit (shared equally)" right="₱250.00" />
        <Row left="Service charge" right="+₱103.00" />
        <Row left={<span className="flex items-center gap-1 text-receive"><Icon name="check" size={14} /> Adds up to ₱1,133.00</span>} tone="receive" />
      </Phone>
    ),
  },
  {
    id: "lock",
    who: "Everyone",
    title: "Confirm, finish entering, lock",
    points: [
      "The person who paid taps “I paid ₱… for this” on their receipt.",
      "Everyone ticks “I’ve entered every receipt I paid” on Home — even if they paid nothing.",
      "Then the organizer taps “Lock roster & start claiming”. Nobody new can join after this.",
    ],
    art: (
      <Phone>
        <Pill tone="receive"><Icon name="check" size={14} /> I paid ₱1,133.00 for this</Pill>
        <Row left={<span className="flex items-center gap-2"><span className="inline-flex size-4 items-center justify-center rounded bg-violet text-violet-ink"><Icon name="check" size={12} /></span> I’ve entered every receipt I paid</span>} />
        <Pill><Icon name="lock" size={14} /> Lock roster & start claiming</Pill>
      </Phone>
    ),
  },
  {
    id: "claim",
    who: "Everyone",
    title: "Claim what you had",
    points: [
      "Open Claim. Go through each receipt and tap “I had some” on shared items, or use − / + for pieces.",
      "Didn’t have anything from a receipt? Tap “I got nothing from this receipt” so the group knows you answered.",
      "You only ever change your own claims. If pieces run out, someone needs to fix theirs first.",
    ],
    art: (
      <Phone>
        <Row left="Sisig · shared" right={<Pill><Icon name="check" size={12} /> I had some</Pill>} tone="violet" />
        <Row left="Rice · 2 of 3 claimed" right={<span className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full border border-line">−</span>1<span className="flex size-6 items-center justify-center rounded-full border border-line">+</span></span>} />
        <Row left="Pancit · shared" right={<Pill tone="neutral">I had some</Pill>} />
        <Pill tone="neutral">I got nothing from this receipt</Pill>
      </Phone>
    ),
  },
  {
    id: "review",
    who: "Everyone",
    title: "Review and approve",
    points: [
      "When everyone has answered, the organizer taps “Start review”.",
      "Money shows your share line by line: each item, discounts, and your part of the service charge (based on what you had).",
      "Green “Net to receive” = others pay you back. Red “Net to pay” = you pay someone. Tap “I agree with this split”.",
    ],
    art: (
      <Phone>
        <div className="rounded-xl bg-pay-soft p-3 text-pay">
          <div className="flex items-center gap-1 text-[12px] font-semibold"><Icon name="arrowUp" size={14} /> Net to pay</div>
          <div className="tnum text-[22px] font-bold">−₱495.00</div>
        </div>
        <Row left="Sisig ÷ 3 people" right="₱200.00" />
        <Row left="Service (your share)" right="+₱45.00" />
        <Pill><Icon name="check" size={14} /> I agree with this split</Pill>
      </Phone>
    ),
  },
  {
    id: "freeze",
    who: "Organizer",
    title: "Freeze the statement",
    points: [
      "Once everyone approved, the organizer taps “Freeze & start settling”.",
      "AteAnne locks the amounts and shows the fewest simple transfers, e.g. “Juan → Mark ₱495.00”.",
      "If anything was wrong, the organizer can still reopen — but only until the first payment is reported.",
    ],
    art: (
      <div aria-hidden className="space-y-3">
        <Big icon="lock" />
        <div className="mx-auto max-w-[260px] space-y-2">
          <Row left="Juan → Mark" right="₱495.00" />
          <Row left="Paolo → Mark" right="₱211.00" />
        </div>
      </div>
    ),
  },
  {
    id: "pay",
    who: "Everyone",
    title: "Pay outside the app, then report it",
    points: [
      "People getting paid back set up how they want to be paid in Money: cash and/or their own QR.",
      "Send the money with cash or your e-wallet/bank, then tap “I sent money” and enter the amount. Partial payments are fine.",
      "Your payment shows as “Pending” — it doesn’t count yet.",
    ],
    art: (
      <Phone>
        <Row left={<span className="flex items-center gap-2"><Icon name="qr" size={16} className="text-violet" /> QR — Mark</span>} />
        <Row left={<span className="flex items-center gap-2"><Icon name="cash" size={16} className="text-receive" /> Cash accepted</span>} />
        <Pill><Icon name="arrowUp" size={14} /> I sent money</Pill>
        <Row left="₱200.00 · cash" right={<span className="text-warn">Pending</span>} tone="warn" />
      </Phone>
    ),
  },
  {
    id: "confirm",
    who: "Person receiving",
    title: "The receiver confirms",
    points: [
      "The person who received the money checks their cash or e-wallet and taps “Received”. Only then does the balance go down.",
      "Nothing arrived? Tap “Not received”. You both then pick what happened — nobody else can decide for you.",
      "Confirmed by mistake? You can undo it once, with a reason, before the event is Done.",
    ],
    art: (
      <Phone>
        <Row left="Juan sent ₱200.00 · cash" right={<span className="text-warn">Pending</span>} />
        <div className="grid grid-cols-2 gap-2">
          <Pill tone="receive"><Icon name="check" size={14} /> Received</Pill>
          <Pill tone="pay">Not received</Pill>
        </div>
        <Row left="Confirmed" right={<span className="text-receive">₱200.00</span>} tone="receive" />
      </Phone>
    ),
  },
  {
    id: "done",
    who: "Organizer",
    title: "Done!",
    points: [
      "When every transfer is confirmed by the people who received it, the organizer taps “Mark as Done”.",
      "The event becomes a read-only record. Every event is deleted 30 days after it was created — finished or not — so export a CSV/JSON copy from People if you want one.",
      "Lost your phone, or opened AteAnne from your Home Screen and your event is missing? Tap “I have a recovery key” on the first screen.",
    ],
    art: (
      <div aria-hidden className="space-y-3">
        <Big icon="check" tone="receive" />
        <div className="mx-auto max-w-[260px] rounded-xl bg-surface-2 p-3 text-center">
          <p className="text-[12px] font-semibold text-muted">Settled</p>
          <p className="tnum text-[22px] font-bold">₱0.00</p>
        </div>
      </div>
    ),
  },
];
