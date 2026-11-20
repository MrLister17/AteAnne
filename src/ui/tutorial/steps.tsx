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
      "Hatian splits a shared bill by what each person actually had, not just total ÷ people.",
      "It runs in 3 steps: Add & claim → Pay → Done. It moves on by itself; nobody waits for a button.",
      "No accounts, no bank logins. Money moves outside the app; Hatian keeps the exact record.",
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
    title: "Add to Home Screen before joining",
    points: [
      "Do this before starting or joining: iPhone keeps a separate sign-in for the Home Screen app.",
      "iPhone: open Hatian in Safari, tap Share → Add to Home Screen → Add. Safari requires those taps; a website cannot do them for you.",
      "Android: in Chrome, tap “Install app” (or ⋮ → Add to Home screen).",
      "Open Hatian from its new icon, then start or join there. Keep your join code handy.",
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
      "Right after you create or join, Hatian shows a personal recovery key once.",
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
      "Saving a receipt you paid counts as “I paid”. If someone else typed it in for you, you confirm the amount once on the receipt.",
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
    id: "claim",
    who: "Everyone",
    title: "Claim what you had",
    points: [
      "Open Claim as soon as a receipt is added; no need to wait for the others. Tap “I had some” on shared items, or use − / + for pieces.",
      "Didn’t have anything from a receipt? Tap “I got nothing from this receipt” so the group knows you answered.",
      "You only ever change your own claims. Your claims are your agreement; there is no separate approval round.",
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
    id: "everyone",
    who: "Everyone",
    title: "Say you’re done; the bill freezes by itself",
    points: [
      "Everyone taps “I’m done adding receipts” on Home, even if they paid nothing.",
      "The organizer taps “Everyone’s here” once everyone who shared the bill has joined. Nobody new can join after this.",
      "The moment everyone is done, Hatian freezes the bill and shows simple transfers, e.g. “Juan → Mark ₱495.00”.",
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
    title: "Pay outside the app, then report it",
    points: [
      "People getting paid back set up how they want to be paid in Money: cash and/or their own QR.",
      "Send the money with cash or your e-wallet/bank, then tap “I sent” and enter the amount. Sending part of it is fine.",
      "Your payment shows as “Sent” until the other person confirms it arrived. It doesn’t count yet.",
    ],
    art: (
      <Phone>
        <Row left={<span className="flex items-center gap-2"><Icon name="qr" size={16} className="text-violet" /> QR — Mark</span>} />
        <Row left={<span className="flex items-center gap-2"><Icon name="cash" size={16} className="text-receive" /> Cash accepted</span>} />
        <Pill><Icon name="arrowUp" size={14} /> I sent ₱200.00</Pill>
        <Row left="₱200.00 · cash" right={<span className="text-warn">Sent</span>} tone="warn" />
      </Phone>
    ),
  },
  {
    id: "confirm",
    who: "Person receiving",
    title: "The receiver confirms",
    points: [
      "The person getting the money checks their cash or e-wallet and taps “Yes, I got it”. Only then does the balance go down.",
      "Not there yet? Leave it and check later. Really didn’t arrive? Tap “It didn’t arrive”. You both then pick what happened — nobody else can decide for you.",
      "Confirmed by mistake? You can undo it once, with a reason, until the hatian closes.",
    ],
    art: (
      <Phone>
        <Row left="Did ₱200.00 from Juan arrive?" right={<span className="text-warn">Sent</span>} />
        <div className="grid grid-cols-2 gap-2">
          <Pill tone="receive"><Icon name="check" size={14} /> Yes, I got it</Pill>
          <Pill tone="pay">It didn’t arrive</Pill>
        </div>
        <Row left="Confirmed" right={<span className="text-receive">₱200.00</span>} tone="receive" />
      </Phone>
    ),
  },
  {
    id: "done",
    who: "Everyone",
    title: "Done!",
    points: [
      "When every transfer is confirmed, Hatian closes the hatian by itself a day later (the organizer can close it sooner). Something wrong before then? The organizer can reopen the bill with a reason; confirmed money is kept.",
      "The event becomes a read-only record. Every event is deleted 30 days after it was created — finished or not — so export a CSV/JSON copy from People if you want one.",
      "Lost your phone, or opened Hatian from your Home Screen and your event is missing? Tap “I have a recovery key” on the first screen. If you lost the key too, ask the organizer in person for replacement access.",
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
