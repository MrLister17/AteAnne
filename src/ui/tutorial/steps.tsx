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
    title: "Welcome to Hatian",
    points: [
      "Split a bill by what each person actually had",
      "3 steps: Add & claim → Pay → Done",
    ],
    art: (
      <div aria-hidden className="flex items-center justify-center gap-2">
        {(["receipt", "wallet", "check"] as IconName[]).map((i, n) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
              <Icon name={i} size={26} />
            </span>
            {n < 2 && <Icon name="chevron" size={16} className="text-muted" />}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "install",
    who: "Everyone",
    title: "Add it to your Home Screen",
    points: [
      "On iPhone, tap Share → Add to Home Screen in Safari, or on Android tap “Install app”",
      "Then open Hatian from its icon and, after joining, copy your recovery key somewhere safe",
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
    title: "Start a split and invite friends",
    points: [
      "Tap “Start a split” and name it",
      "Tap “Share link” to send the code to your group chat",
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
    id: "receipts",
    who: "Whoever paid",
    title: "Add the receipt",
    points: [
      "Scan a photo of the receipt, or type the items",
      "Pick “Shared equally” or “By piece” for each item",
    ],
    art: (
      <Phone>
        <Row left="Pizza (shared equally)" right="₱600.00" />
        <Row left="3× Rice (by piece)" right="₱180.00" />
        <Row left="Pasta (shared equally)" right="₱250.00" />
        <Row left="Service charge" right="+₱103.00" />
        <Row left={<span className="flex items-center gap-1 text-receive"><Icon name="check" size={14} /> Adds up to ₱1,133.00</span>} tone="receive" />
      </Phone>
    ),
  },
  {
    id: "claim",
    who: "Everyone",
    title: "Claim what you had",
    points: [
      "Tap “I had some”, or use − / + for pieces",
      "Had nothing? Tap “I got nothing from this receipt”",
    ],
    art: (
      <Phone>
        <Row left="Pizza · shared" right={<Pill><Icon name="check" size={12} /> I had some</Pill>} tone="violet" />
        <Row left="Rice · 2 of 3 claimed" right={<span className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full border border-line">−</span>1<span className="flex size-6 items-center justify-center rounded-full border border-line">+</span></span>} />
        <Row left="Pasta · shared" right={<Pill tone="neutral">I had some</Pill>} />
        <Pill tone="neutral">I got nothing from this receipt</Pill>
      </Phone>
    ),
  },
  {
    id: "everyone",
    who: "Everyone",
    title: "Say you’re done",
    points: [
      "On Home, say when you’re done adding receipts, and the organizer taps “Everyone’s here”",
      "The bill then locks by itself and shows who pays whom",
    ],
    art: (
      <Phone>
        <Pill><Icon name="check" size={14} /> I’m done adding receipts</Pill>
        <Pill><Icon name="lock" size={14} /> Everyone’s here</Pill>
        <Row left="Juan → Mark" right="₱495.00" />
        <Row left="Paolo → Mark" right="₱211.00" />
      </Phone>
    ),
  },
  {
    id: "pay",
    who: "Everyone",
    title: "Pay, then tap “I sent”",
    points: [
      "Pay by cash or QR, then tap “I sent”",
      "It only counts once the person you paid taps “Yes, I got it”",
    ],
    art: (
      <Phone>
        <Row left={<span className="flex items-center gap-2"><Icon name="qr" size={16} className="text-violet" /> QR — Mark</span>} />
        <Pill><Icon name="arrowUp" size={14} /> I sent ₱200.00</Pill>
        <Row left="Did ₱200.00 from Juan arrive?" right={<span className="text-warn">Sent</span>} />
        <Pill tone="receive"><Icon name="check" size={14} /> Yes, I got it</Pill>
      </Phone>
    ),
  },
  {
    id: "done",
    who: "Everyone",
    title: "Done!",
    points: [
      "When everyone has paid, the split closes by itself",
      "Lost your phone? Tap “I have a recovery key” on the first screen",
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
