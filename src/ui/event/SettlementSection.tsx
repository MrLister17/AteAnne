"use client";

import { useRef, useState } from "react";
import { api, newIdempotencyKey } from "../api";
import { Icon } from "../components/Icon";
import { ActionError, Badge, BalanceBanner, Button, Card, Disclosure, Field, MoneyInput, Notice, Progress, SectionTitle, Sheet, balanceLabel } from "../components/ui";
import { money, timeAgo, toMinor, toMinorInput } from "../format";
import { MAX_CLIENT_UPLOAD_BYTES, prepareImage, uploadName } from "../image";
import { EdgeView, View, todayRate, useAction, useEvent, useInlineAction } from "./EventContext";
import { Decimal, ExchangeRate } from "@/domain/fx/ExchangeRate";
import { ForeignPayment } from "@/domain/payments/ForeignPayment";
import { currencyInfo, shortDay } from "@/domain/money/Currency";

/**
 * Settlement: frozen edges, payment instructions (cash/QR), "reported sent"
 * vs recipient-confirmed amounts, rejection disputes and reversal.
 */
export function SettlementSection() {
  const { view, me, event, shown, moneyAbs, viewRate } = useEvent();
  const s = view.settlement!;
  const mine = s.positions.find((p) => p.memberId === me.memberId)!;
  const toPay = s.edges.filter((e) => e.from === me.memberId);
  const toReceive = s.edges.filter((e) => e.to === me.memberId);
  const others = s.edges.filter((e) => !e.involvesMe);
  // The transfer your next step is about gets a ring, so it's easy to find (D53).
  const next = view.next;
  const focused = "transferId" in next ? next.transferId : null;

  return (
    <div className="space-y-3">
      <BalanceBanner
        net={mine.remaining}
        display={shown(mine.remaining, { abs: true })}
        exact={viewRate ? moneyAbs(mine.remaining) : undefined}
        caption={mine.remaining === mine.net ? "Frozen bill · only money the other person confirms changes this" : `Bill: ${balanceLabel(mine.net).text.toLowerCase()} ${shown(mine.net, { abs: true })} · confirmed payments included`}
      />
      {event.phase === "DONE" && <Notice tone="receive" title="Done">Every payment was confirmed by the person who got it. This record is read-only.</Notice>}
      {s.edges.length === 0 && <Notice tone="receive">Nobody owes anybody in this event.</Notice>}

      {toPay.length > 0 && <SectionTitle>You pay</SectionTitle>}
      {toPay.map((e) => (
        <PayEdge key={e.id} edge={e} focused={focused === e.id} />
      ))}

      {toReceive.length > 0 && <SectionTitle>You get</SectionTitle>}
      {toReceive.map((e) => (
        <ReceiveEdge key={e.id} edge={e} focused={focused === e.id} />
      ))}

      {(toReceive.length > 0 || view.instructions[me.memberId]) && event.phase !== "DONE" && <InstructionsEditor />}

      {others.length > 0 && <SectionTitle>Other payments</SectionTitle>}
      {others.map((e) => (
        <EdgeSummary key={e.id} edge={e} />
      ))}
    </div>
  );
}

/** One line of status per transfer: "PHP 400.00 received · PHP 298.50 left" (in the settle-up currency). */
export function edgeStatus(edge: EdgeView, ccy = "PHP"): string {
  const php = (v: string | bigint) => money(v, ccy);
  const verified = BigInt(edge.verified);
  const pending = BigInt(edge.pending);
  // What hasn't been sent yet: money already reported is "sent, waiting", not "left".
  const left = BigInt(edge.capacity);
  if (edge.settled) return `${php(edge.amount)} received`;
  const parts: string[] = [];
  if (verified > 0n) parts.push(`${php(verified)} received`);
  if (pending > 0n) parts.push(`${php(pending)} sent, waiting`);
  parts.push(left > 0n ? `${php(left)} left` : "nothing left");
  return parts.join(" · ");
}

type ReportView = EdgeView["reports"][number];
type PaidView = NonNullable<ReportView["paid"]>;

/** The locked rate of a payment sent in another currency ("1 THB = 1.63 PHP"). */
function paidRate(p: PaidView, settle: string): ExchangeRate {
  return new ExchangeRate(p.currency, settle, Decimal.parse(p.rate), p.rateDate, p.source);
}

/** "THB 512.31 (counts as PHP 835.06 · 1 THB = 1.63 PHP, ECB 25 Nov)" pieces for a payment report. */
function paidLine(r: ReportView, settle: string): string | null {
  if (!r.paid) return null;
  return `Counts as ${money(r.amount, settle)} · 1 ${r.paid.currency} = ${r.paid.rate} ${settle} (ECB, ${shortDay(r.paid.rateDate)})`;
}

/** What a payment report says was sent: the paid currency when it wasn't the settle-up one. */
function sentAmount(r: ReportView, settle: string): string {
  return r.paid ? money(r.paid.amount, r.paid.currency) : money(r.amount, settle);
}

/** Currencies the payer can send to `to` right now: the ones they accept, where today's rate is known (the settle-up currency always). */
function payCurrencies(view: View, to: string): string[] {
  const accepted = view.instructions[to]?.acceptedCurrencies ?? view.defaultAcceptedCurrencies;
  return accepted.filter((c) => c === view.event.currency || todayRate(view, c, view.event.currency));
}

function EdgeHeader({ edge, title }: { edge: EdgeView; title?: string }) {
  const { name, currency } = useEvent();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-semibold">
          {title ?? (
            <>
              {name(edge.from)} <span className="text-muted">→</span> {name(edge.to)}
            </>
          )}
        </p>
        {edge.settled ? <Badge tone="receive">✓ Received</Badge> : edge.disputed ? <Badge tone="pay">Didn’t arrive</Badge> : edge.pending !== "0" ? <Badge tone="warn">Sent</Badge> : <Badge>Open</Badge>}
      </div>
      <Progress value={Number(edge.verified)} pending={Number(edge.pending)} max={Number(edge.amount)} tone="receive" />
      <p className="tnum text-[14px] text-muted" data-testid="edge-status">
        {edgeStatus(edge, currency)}
      </p>
    </div>
  );
}

function PayEdge({ edge, focused }: { edge: EdgeView; focused: boolean }) {
  const { view, event, name, money: php, currency } = useEvent();
  const [reporting, setReporting] = useState(false);
  const instr = view.instructions[edge.to];
  const agreedReplacement = edge.dispute?.status === "AWAITING_REPLACEMENT" ? edge.dispute.rejectedReportId : null;
  const canReport = !edge.settled && event.phase === "SETTLING" && (!edge.disputed || agreedReplacement) && edge.capacity !== "0";
  const sentSome = edge.pending !== "0";
  // Pay in (D58): the receiver's accepted currencies with a rate today. A replacement re-records the same money in its original currency.
  const rejected = agreedReplacement ? edge.reports.find((r) => r.id === agreedReplacement) : undefined;
  const options = rejected?.paid ? [rejected.paid.currency] : payCurrencies(view, edge.to);
  const [chosen, setChosen] = useState<string | null>(null);
  const payIn = chosen && options.includes(chosen) ? chosen : rejected?.paid ? rejected.paid.currency : currency;
  const rate = payIn === currency ? null : rejected?.paid ? paidRate(rejected.paid, currency) : todayRate(view, payIn, currency);
  const fullInPayCurrency = rate ? new ForeignPayment(rate).toSend(BigInt(edge.capacity)) : null;

  return (
    <Card className={`space-y-3 scroll-mt-28 ${focused ? "border-violet ring-2 ring-violet-soft" : ""}`}>
      <div id={`transfer-${edge.id}`} />
      <EdgeHeader edge={edge} title={edge.settled ? `Paid ${name(edge.to)} ${php(edge.amount)}` : `Pay ${name(edge.to)} ${php(edge.outstanding)}`} />
      {!edge.settled && (
        <div className="rounded-xl bg-surface-2 p-3 text-[15px]">
          <p className="font-semibold">How {name(edge.to)} wants to be paid</p>
          {instr ? (
            <div className="mt-1 space-y-2">
              {instr.acceptsCash && (
                <p className="flex items-start gap-2">
                  <Icon name="cash" size={18} className="mt-0.5 text-receive" /> Cash{instr.cashNote ? ` — ${instr.cashNote}` : ""}
                </p>
              )}
              {instr.qrAssetId && (
                <div>
                  <p className="flex items-center gap-2">
                    <Icon name="qr" size={18} className="text-violet" /> QR{instr.qrLabel ? ` — ${instr.qrLabel}` : ""} <span className="text-[12px] text-muted">(v{instr.version})</span>
                  </p>
                  <img src={`/api/assets/${instr.qrAssetId}`} alt={`Payment QR shared by ${name(edge.to)}`} className="mt-2 w-full max-w-[260px] rounded-xl border border-line bg-white p-2" />
                  <p className="mt-1 text-[12px] text-muted">Check the name shown in your e-wallet or bank app before sending. AteAnne doesn’t read or check QR codes.</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-muted">Not shared yet. Ask {name(edge.to)}, or pay cash.</p>
          )}
        </div>
      )}
      {edge.disputed && edge.dispute && <DisputeCard edge={edge} />}
      {sentSome && !edge.settled && <p className="text-[15px] font-semibold">Sent {php(edge.pending)} · Waiting for {name(edge.to)}</p>}
      {canReport && options.length > 1 && (
        <div className="space-y-1.5" data-testid="pay-in">
          <p id={`pay-in-${edge.id}`} className="text-[14px] font-semibold text-muted">
            Pay in
          </p>
          <div role="radiogroup" aria-labelledby={`pay-in-${edge.id}`} className="flex flex-wrap gap-1.5">
            {options.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={payIn === c}
                onClick={() => setChosen(c)}
                className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold ${payIn === c ? "border-violet bg-violet text-violet-ink" : "border-line bg-surface active:bg-surface-2"}`}
              >
                {currencyInfo(c).symbol} {currencyInfo(c).name}
              </button>
            ))}
          </div>
        </div>
      )}
      {canReport && rate && fullInPayCurrency !== null && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-[15px]" data-testid="pay-quote">
          {rejected?.paid ? "At the rate when you sent it" : "At today’s rate"}: 1 {payIn} = {rate.rateText()} {currency} (ECB, {shortDay(rate.date)})
          <b className="mt-0.5 block">Send {fullInPayCurrency > 0n ? php(fullInPayCurrency, payIn) : `less than ${php(1n, payIn)}: pay in ${currency}`}</b>
        </p>
      )}
      {canReport && (
        <Button full variant={sentSome ? "secondary" : "primary"} icon="arrowUp" disabled={fullInPayCurrency === 0n} onClick={() => setReporting(true)}>
          {agreedReplacement ? "Record the money you already sent" : sentSome ? "I sent more" : rate && fullInPayCurrency ? `I sent ${php(fullInPayCurrency, payIn)}` : `I sent ${php(edge.capacity)}`}
        </Button>
      )}
      <ReportList edge={edge} role="sender" />
      {reporting && <ReportSheet edge={edge} replaces={agreedReplacement} hasQr={Boolean(instr?.qrAssetId)} payIn={payIn} rate={rate} onClose={() => setReporting(false)} />}
    </Card>
  );
}

/**
 * "How much did you send?" In the settle-up currency, or (D58) in another
 * currency the receiver accepts: then the amount is typed in that currency,
 * and what it counts as comes from the day's locked rate. The server
 * recomputes the credit and refuses it if the rate moved.
 */
function ReportSheet({ edge, replaces, hasQr, payIn, rate, onClose }: { edge: EdgeView; replaces: string | null; hasQr: boolean; payIn: string; rate: ExchangeRate | null; onClose: () => void }) {
  const { name, money: php, currency } = useEvent();
  const { run, error } = useInlineAction();
  const capacity = BigInt(edge.capacity);
  const fx = rate ? new ForeignPayment(rate) : null;
  const maxSend = fx ? fx.toSend(capacity) : capacity;
  const [amount, setAmount] = useState(toMinorInput(maxSend.toString(), payIn));
  const [method, setMethod] = useState<"CASH" | "QR">(hasQr ? "QR" : "CASH");
  const [note, setNote] = useState("");
  const key = useRef(newIdempotencyKey()); // same key on retry → no duplicate report
  const sent = toMinor(amount, payIn);
  const tooMuch = sent !== null && BigInt(sent) > maxSend;
  // What it counts as on the transfer (settle-up currency).
  let credit: bigint | null = null;
  let creditError: string | null = null;
  if (sent && sent !== "0" && !tooMuch) {
    if (!fx) credit = BigInt(sent);
    else {
      try {
        credit = fx.creditFor(BigInt(sent), capacity);
      } catch (e) {
        creditError = e instanceof Error ? e.message : "That amount can’t be counted";
      }
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={replaces ? `Record the money you sent ${name(edge.to)}` : "How much did you send?"}
      footer={
        <div className="space-y-2">
          <ActionError message={error} />
          <Button
            full
            busyLabel="Sending…"
            disabled={credit === null}
            onClick={async () => {
              if (credit === null || !sent) return;
              const body = {
                amount: credit.toString(),
                method,
                note,
                idempotencyKey: key.current,
                ...(rate ? { paid: { currency: payIn, amount: sent, rateDate: rate.date } } : {}),
                ...(replaces ? { replacesReportId: replaces } : {}),
              };
              const ok = await run(() => api.post(`/api/edges/${edge.id}/reports`, body), `Sent. ${name(edge.to)} will confirm.`);
              if (ok) onClose();
              return ok;
            }}
          >
            {`I sent ${sent ? php(sent, payIn) : ""}`.trim()}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Notice tone="info">Only record money you’ve already sent. It stays “sent” until {name(edge.to)} says it arrived.</Notice>
        <Field
          label={rate ? `Amount sent in ${currencyInfo(payIn).name}` : "Amount sent"}
          hint={rate ? `Up to ${php(maxSend, payIn)} (= ${php(capacity)} at 1 ${payIn} = ${rate.rateText()} ${currency}, ECB ${shortDay(rate.date)}). Sending part of it is fine.` : `Up to ${php(capacity)}. Sending part of it is fine.`}
          error={tooMuch ? `More than the ${php(maxSend, payIn)} still open` : creditError}
        >
          {(p) => <MoneyInput {...p} currency={payIn} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {rate && credit !== null && (
          <p className="text-[15px]" data-testid="counts-as">
            Counts as <b className="tnum">{php(credit)}</b> of the {php(capacity)} still open.
          </p>
        )}
        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold">How</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "QR"] as const).map((m) => (
              <label key={m} className={`card flex min-h-12 items-center gap-2 p-3 ${method === m ? "border-violet ring-2 ring-violet-soft" : ""} ${m === "QR" && !hasQr ? "opacity-50" : ""}`}>
                <input type="radio" name="method" className="size-5 accent-[var(--violet)]" checked={method === m} disabled={m === "QR" && !hasQr} onChange={() => setMethod(m)} />
                <Icon name={m === "CASH" ? "cash" : "qr"} size={18} /> {m === "CASH" ? "Cash" : "QR / e-wallet"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Reference (optional)" hint="e.g. GCash ref ending 4821. Never paste full account numbers.">
          {(p) => <input {...p} className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}

/**
 * "It didn't arrive": the recipient says what happened. This opens a dispute
 * both people resolve together, so it asks for a reason first (no browser prompt).
 */
export function DidntArriveSheet({ reportId, reportVersion, senderId, onClose }: { reportId: string; reportVersion: number; senderId: string; onClose: () => void }) {
  const { name } = useEvent();
  const { run, error } = useInlineAction();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Sheet
      open
      onClose={onClose}
      title="What happened?"
      footer={
        <div className="space-y-2">
          <ActionError message={error} />
          <Button
            full
            variant="danger"
            busyLabel="Sending…"
            disabled={!ok}
            onClick={async () => {
              const done = await run(() => api.post(`/api/payments/${reportId}/reject`, { reason: reason.trim(), expectedVersion: reportVersion }), `Saved. ${name(senderId)} will see it.`);
              if (done) onClose();
              return done;
            }}
          >
            Tell {name(senderId)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">Not there yet? Close this and check later. Only continue if {name(senderId)} says it was sent and nothing came.</p>
        <Field label="What happened?" hint="At least 3 characters." error={null}>
          {(p) => <textarea {...p} className="field min-h-24" maxLength={200} value={reason} placeholder="e.g. Nothing came into my GCash" onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}

function ReceiveEdge({ edge, focused }: { edge: EdgeView; focused: boolean }) {
  const { name, money: php } = useEvent();
  return (
    <Card className={`space-y-3 scroll-mt-28 ${focused ? "border-violet ring-2 ring-violet-soft" : ""}`}>
      <div id={`transfer-${edge.id}`} />
      <EdgeHeader edge={edge} title={edge.settled ? `${name(edge.from)} paid you ${php(edge.amount)}` : `${name(edge.from)} pays you ${php(edge.outstanding)}`} />
      {edge.disputed && edge.dispute && <DisputeCard edge={edge} />}
      <ReportList edge={edge} role="recipient" />
    </Card>
  );
}

function ReportList({ edge, role }: { edge: EdgeView; role: "sender" | "recipient" }) {
  const { event } = useEvent();
  if (!edge.reports.length) return null;
  const sorted = [...edge.reports].reverse();
  // Money waiting for your answer stays in view; the rest is history behind "See payments".
  const waiting = role === "recipient" ? sorted.filter((r) => r.status === "REPORTED" && event.phase === "SETTLING") : [];
  const history = sorted.filter((r) => !waiting.includes(r));
  return (
    <div className="space-y-2">
      {waiting.map((r) => (
        <PendingReport key={r.id} edge={edge} report={r} />
      ))}
      {history.length > 0 && (
        <Disclosure summary={`See payments (${history.length})`}>
          <ul className="space-y-2">
            {history.map((r) => (
              <ReportRow key={r.id} edge={edge} report={r} role={role} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/** The recipient's question: did this money arrive? */
function PendingReport({ edge, report: r }: { edge: EdgeView; report: ReportView }) {
  const { name, currency } = useEvent();
  const { run, error } = useInlineAction();
  const [didntArrive, setDidntArrive] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-line p-3" data-testid="pending-report">
      <p className="text-[17px] font-semibold">
        Did {sentAmount(r, currency)} from {name(edge.from)} arrive?
      </p>
      {r.paid && <p className="text-[14px] text-muted">{paidLine(r, currency)}</p>}
      <p className="text-[13px] text-muted">
        {r.method === "CASH" ? "Cash" : "QR / e-wallet"} · {timeAgo(r.createdAt)}
        {r.note ? ` · “${r.note}”` : ""}
      </p>
      {r.replacesReportId && <p className="text-[13px] text-muted">Recorded again after you both agreed. It isn’t new money.</p>}
      <Button full variant="receive" icon="check" busyLabel="Confirming…" onClick={() => run(() => api.post(`/api/payments/${r.id}/verify`, { expectedVersion: r.version }), `Got it. ${sentAmount(r, currency)} from ${name(edge.from)}.`)}>
        Yes, I got it
      </Button>
      <ActionError message={error} />
      <div className="flex flex-wrap items-center gap-x-3">
        <button type="button" onClick={() => setDidntArrive(true)} className="inline-flex min-h-11 items-center px-1 text-[15px] font-semibold text-pay underline underline-offset-2">
          It didn’t arrive
        </button>
        <span className="text-[13px] text-muted">Not there yet? Leave this and check later.</span>
      </div>
      {didntArrive && <DidntArriveSheet reportId={r.id} reportVersion={r.version} senderId={edge.from} onClose={() => setDidntArrive(false)} />}
    </div>
  );
}

function ReportRow({ edge, report: r, role }: { edge: EdgeView; report: ReportView; role: "sender" | "recipient" }) {
  const { name, event, currency } = useEvent();
  const act = useAction();
  return (
    <li className="rounded-xl border border-line p-3 text-[15px]">
      <div className="flex items-center gap-2">
        <Icon name={r.method === "CASH" ? "cash" : "qr"} size={18} className="text-muted" />
        <b className="tnum">{sentAmount(r, currency)}</b>
        <span className="text-[13px] text-muted">{timeAgo(r.createdAt)}</span>
        <span className="ml-auto">
          {r.reversal ? <Badge tone="warn">Confirmation undone</Badge> : r.status === "VERIFIED" ? <Badge tone="receive">✓ Received</Badge> : r.status === "REPORTED" ? <Badge tone="warn">Sent</Badge> : r.status === "REJECTED" ? <Badge tone="pay">Didn’t arrive</Badge> : <Badge>Cancelled</Badge>}
        </span>
      </div>
      {r.paid && <p className="mt-1 text-[13px] text-muted">{paidLine(r, currency)}</p>}
      {r.note && <p className="mt-1 text-[14px] text-muted">“{r.note}”</p>}
      {r.replacesReportId && <p className="mt-1 text-[13px] text-muted">Recorded again after you both agreed. It isn’t new money.</p>}
      {r.rejectReason && <p className="mt-1 text-[14px] text-pay">What happened: {r.rejectReason}</p>}
      {r.reversal && <p className="mt-1 text-[14px] text-warn">Undone by {name(edge.to)}: {r.reversal.reason}</p>}
      {role === "sender" && r.status === "REPORTED" && (
        <Button variant="tonal" className="mt-2" busyLabel="Cancelling…" onClick={() => act(() => api.post(`/api/payments/${r.id}/cancel`), "Cancelled")}>
          Cancel this
        </Button>
      )}
      {role === "recipient" && r.status === "VERIFIED" && !r.reversal && event.phase === "SETTLING" && (
        <Button
          variant="tonal"
          className="mt-2"
          busyLabel="Saving…"
          onClick={() => {
            const reason = prompt("You can undo your confirmation once, before the event is Done. This fixes the record; it isn’t a refund. Reason:");
            if (!reason || reason.trim().length < 3) return;
            return act(() => api.post(`/api/payments/${r.id}/reverse`, { reason }), "Undone. The amount is open again.");
          }}
        >
          I confirmed this by mistake
        </Button>
      )}
    </li>
  );
}

function DisputeCard({ edge }: { edge: EdgeView }) {
  const { me, name } = useEvent();
  const act = useAction();
  const d = edge.dispute!;
  const iAmSender = edge.from === me.memberId;
  const myChoice = iAmSender ? d.senderChoice : d.recipientChoice;
  const theirChoice = iAmSender ? d.recipientChoice : d.senderChoice;
  const other = name(iAmSender ? edge.to : edge.from);
  const label = { NO_TRANSFER: "No money was sent", REPLACEMENT: "Money was sent — record it again" } as const;
  if (d.status === "AWAITING_REPLACEMENT") {
    return <Notice tone="warn" title="Agreed: record it again">{iAmSender ? "Record the money you already sent. Don’t send it again. Then they confirm it." : `${other} will record the money already sent. You’ll confirm it here.`}</Notice>;
  }
  return (
    <div className="space-y-2 rounded-xl bg-pay-soft p-3">
      <p className="font-semibold">Sort this out with {other}</p>
      <p className="text-[14px]">A payment was marked as not arrived. You both pick the same answer. Nobody else, not even the organizer, can decide for you.</p>
      {(["NO_TRANSFER", "REPLACEMENT"] as const).map((c) => (
        <Button key={c} full variant={myChoice === c ? "primary" : "secondary"} icon={myChoice === c ? "check" : undefined} busyLabel="Saving…" onClick={() => act(() => api.post(`/api/disputes/${d.id}`, { choice: c, expectedVersion: d.version }), "Answer saved")}>
          {label[c]}
        </Button>
      ))}
      <p className="text-[13px] text-muted">{theirChoice ? `${other} chose: ${label[theirChoice]}` : `Waiting for ${other}.`}</p>
    </div>
  );
}

function EdgeSummary({ edge }: { edge: EdgeView }) {
  return (
    <Card>
      <EdgeHeader edge={edge} />
    </Card>
  );
}

function InstructionsEditor() {
  const { view, me, event, focus } = useEvent();
  const act = useAction();
  const cur = view.instructions[me.memberId];
  // "Add cash or QR" from the Next card opens this sheet straight away.
  const [open, setOpen] = useState(() => Boolean(focus?.payDetails));
  const [seenFocus, setSeenFocus] = useState(focus?.seq ?? 0);
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    if (focus.payDetails) setOpen(true);
  }
  const [cash, setCash] = useState(cur?.acceptsCash ?? true);
  const [cashNote, setCashNote] = useState(cur?.cashNote ?? "");
  const [qrLabel, setQrLabel] = useState(cur?.qrLabel ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [busy, setBusy] = useState(false);
  // "I accept" (D58): the settle-up currency always; others the receiver ticks (default: every currency used here).
  const currencyOptions = [...new Set([event.currency, ...view.fx.used, "PHP"])];
  const [accepted, setAccepted] = useState<string[]>(cur ? cur.acceptedCurrencies : view.defaultAcceptedCurrencies);
  const acceptedList = currencyOptions.filter((c) => c === event.currency || accepted.includes(c));
  return (
    <>
      <Card className="flex items-center gap-3">
        <Icon name="wallet" className="text-violet" />
        <div className="min-w-0 flex-1 text-[15px]">
          <p className="font-semibold">How you get paid</p>
          <p className="text-muted">
            {cur ? [cur.acceptsCash && "Cash", cur.hasQr && "QR"].filter(Boolean).join(" + ") + ` · v${cur.version}` : "Not shared yet"}
            {currencyOptions.length > 1 && ` · ${(cur ? cur.acceptedCurrencies : view.defaultAcceptedCurrencies).join(", ")}`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {cur ? "Edit" : "Set up"}
        </Button>
      </Card>
      {open && (
        <Sheet
          open
          onClose={() => setOpen(false)}
          title="How you want to be paid"
          footer={
            <Button
              full
              busy={busy}
              busyLabel="Saving…"
              onClick={async () => {
                setBusy(true);
                const img = file ? await prepareImage(file, "QR") : null;
                if (img && img.size > MAX_CLIENT_UPLOAD_BYTES) {
                  setBusy(false);
                  alert("That QR image is too large. Try a screenshot of your QR instead.");
                  return;
                }
                const ok = img
                  ? await act(() => {
                      const fd = new FormData();
                      fd.set("file", img, uploadName(img));
                      fd.set("kind", "QR");
                      fd.set("acceptsCash", String(cash));
                      fd.set("cashNote", cashNote);
                      fd.set("qrLabel", qrLabel);
                      fd.set("acceptedCurrencies", acceptedList.join(","));
                      return api.post(`/api/events/${event.id}/assets`, fd);
                    }, "Payment details saved")
                  : await act(() => api.post(`/api/events/${event.id}/instructions`, { acceptsCash: cash, cashNote, qrLabel, keepQr: !removeQr, acceptedCurrencies: acceptedList }), "Payment details saved");
                setBusy(false);
                if (ok) setOpen(false);
              }}
            >
              Save
            </Button>
          }
        >
          <div className="space-y-4">
            <label className="card flex min-h-14 items-center gap-3 p-3.5">
              <input type="checkbox" className="size-5 accent-[var(--violet)]" checked={cash} onChange={(e) => setCash(e.target.checked)} />
              <Icon name="cash" /> I accept cash
            </label>
            {cash && (
              <Field label="Cash note (optional)" hint="e.g. “Hand it to me at Saturday practice”">
                {(p) => <input {...p} className="field" maxLength={200} value={cashNote} onChange={(e) => setCashNote(e.target.value)} />}
              </Field>
            )}
            <Field label="Your payment QR (optional)" hint="JPEG/PNG/WebP up to 8 MB. Only people who owe you can see it. Uploading a QR is not proof of payment.">
              {(p) => <input {...p} type="file" accept="image/jpeg,image/png,image/webp" className="field" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
            </Field>
            <Field label="QR label (optional)" hint="e.g. “GCash — J. Dela Cruz”. Don’t include full account numbers.">
              {(p) => <input {...p} className="field" maxLength={60} value={qrLabel} onChange={(e) => setQrLabel(e.target.value)} />}
            </Field>
            {cur?.hasQr && !file && (
              <label className="flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" className="size-5 accent-[var(--violet)]" checked={removeQr} onChange={(e) => setRemoveQr(e.target.checked)} /> Remove my current QR
              </label>
            )}
            {currencyOptions.length > 1 && (
              <fieldset data-testid="accept-currencies">
                <legend className="mb-1 text-[15px] font-semibold">I accept</legend>
                {currencyOptions.map((c) => (
                  <label key={c} className="flex min-h-11 items-center gap-2 text-[15px]">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--violet)]"
                      checked={c === event.currency || accepted.includes(c)}
                      disabled={c === event.currency}
                      onChange={(e) => setAccepted((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))}
                    />
                    {currencyInfo(c).symbol} {currencyInfo(c).name}
                    {c === event.currency && <span className="text-[13px] text-muted">(the bill’s currency)</span>}
                  </label>
                ))}
                <p className="text-[13px] text-muted">Money sent in another currency counts at the ECB rate of the day it’s sent.</p>
              </fieldset>
            )}
            <p className="text-[13px] text-muted">Changing these never changes the frozen amounts. Earlier payment reports keep the version they used.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}
