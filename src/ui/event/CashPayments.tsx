"use client";

import { useRef, useState } from "react";
import { api, newIdempotencyKey } from "../api";
import { Icon } from "../components/Icon";
import { ActionError, Badge, Button, Card, Disclosure, Field, MoneyInput, Notice, Sheet } from "../components/ui";
import { money, timeAgo, toMinor } from "../format";
import { currencyInfo, shortDay } from "@/domain/money/Currency";
import { todayRate, useAction, useEvent, useInlineAction, type View } from "./EventContext";

/**
 * Running event payments (D64): cash already handed to someone, recorded at
 * any point during Add & claim or Pay. It counts once the person who got it
 * confirms. The app records handoffs; it never moves money.
 */
export type CashView = View["cash"]["reports"][number];

const OPEN_PHASES = ["COLLECTING", "ALLOCATING", "REVIEWING", "SETTLING"];

/** What was handed over: the original currency when it wasn't the settle-up one. */
export function cashSent(c: CashView, settle: string): string {
  return c.paid ? money(c.paid.amount, c.paid.currency) : money(c.amount, settle);
}

/** Whether a new cash payment can be recorded now (Pay: one question at a time, after edge payments settle down). */
export function canRecordCash(view: View): boolean {
  if (view.event.cancelled || !OPEN_PHASES.includes(view.event.phase)) return false;
  if (view.event.phase !== "SETTLING") return true;
  if (view.cash.paused) return false;
  return !(view.settlement?.edges ?? []).some((e) => e.pending !== "0" || e.disputed);
}

/** Currencies the payer can use for `to` right now (accepted, with a rate today; the settle-up currency always). */
function cashCurrencies(view: View, to: string): string[] {
  const accepted = view.instructions[to]?.acceptedCurrencies ?? view.defaultAcceptedCurrencies;
  return accepted.filter((c) => c === view.event.currency || todayRate(view, c, view.event.currency));
}

/** "Credit", "To pay", "To receive", "Settled" for a balance and its credit part. */
function balanceWords(remaining: bigint, credit: bigint): string {
  if (credit > 0n && credit >= remaining) return "Credit";
  return remaining > 0n ? "To receive" : remaining < 0n ? "To pay" : "Settled";
}

/**
 * The balance banner's word and note for this person (D64): "Credit" when all of
 * a positive balance comes from paying ahead; otherwise the usual word, with a
 * note when part of it is credit.
 */
export function creditLabel(view: View, memberId: string, fmt: (v: bigint) => string): { label?: string; caption?: string } {
  const b = view.balances.find((x) => x.memberId === memberId);
  if (!b || b.remaining === null) return {};
  const credit = BigInt(b.credit);
  if (credit <= 0n) return {};
  return credit >= BigInt(b.remaining) ? { label: "Credit", caption: "You paid ahead, and it counts toward anything you share later" } : { caption: `Includes ${fmt(credit)} credit from paying ahead` };
}

/**
 * Payments card. Home during Add & claim, Pay once frozen, Money when Done.
 * Shows the actual counterparties, anything waiting on you, and the history one tap away.
 */
export function CashPayments({ where }: { where: "home" | "pay" | "done" }) {
  const { view, me, name, money: fmt } = useEvent();
  const [recording, setRecording] = useState(false);
  const reports = view.cash.reports;
  const mine = view.balances.find((b) => b.memberId === me.memberId);
  const actionable = reports.filter(
    (c) => (c.status === "REPORTED" && (c.to === me.memberId || c.from === me.memberId)) || (c.dispute && c.dispute.status !== "RESOLVED" && (c.from === me.memberId || c.to === me.memberId)),
  );
  const history = [...reports].reverse().filter((c) => !actionable.includes(c));
  const canRecord = canRecordCash(view) && where !== "done";
  if (where === "done" && reports.length === 0) return null;

  // Summary: who I paid / who paid me, in one line each (D64 "Paid THB 2,000.00 to Maya").
  const confirmed = reports.filter((c) => c.status === "VERIFIED" && !c.reversal);
  const sent = confirmed.filter((c) => c.from === me.memberId);
  const received = confirmed.filter((c) => c.to === me.memberId);
  const total = (xs: CashView[]) => xs.reduce((a, c) => a + BigInt(c.amount), 0n);
  const people = (xs: CashView[], side: "to" | "from") => [...new Set(xs.map((c) => name(c[side])))];
  const sentLine = sent.length ? `Paid ${fmt(total(sent))} to ${people(sent, "to").join(", ")}${sent.length > 1 ? ` (${sent.length} payments)` : ""}` : null;
  const receivedLine = received.length ? `Received ${fmt(total(received))} from ${people(received, "from").join(", ")}${received.length > 1 ? ` (${received.length} payments)` : ""}` : null;
  const credit = mine ? BigInt(mine.credit) : 0n;

  return (
    <Card className="space-y-3" as="section">
      <div className="flex items-center gap-2" data-testid="cash-payments">
        <Icon name="cash" size={20} className="text-violet" />
        <h2 className="flex-1 font-semibold">{where === "pay" ? "Cash payments" : "Payments"}</h2>
        {credit > 0n && <Badge tone="receive">Credit {fmt(credit)}</Badge>}
      </div>
      {(sentLine || receivedLine) && (
        <div className="space-y-0.5 text-[15px]" data-testid="cash-summary">
          {sentLine && <p>{sentLine}</p>}
          {receivedLine && <p>{receivedLine}</p>}
          {mine && mine.remaining === null && <p className="text-muted">Balance pending until the split can be worked out</p>}
        </div>
      )}
      {!sentLine && !receivedLine && !actionable.length && where === "home" && (
        <p className="text-[14px] text-muted">Already gave someone money? Record it here</p>
      )}
      {where === "pay" && view.cash.paused && (
        <Notice tone="warn">Other payments are paused until the waiting cash payment is confirmed or sorted out</Notice>
      )}
      {actionable.map((c) => (
        <CashItem key={c.id} report={c} />
      ))}
      {canRecord && (
        <Button full variant="secondary" icon="plus" onClick={() => setRecording(true)}>
          {where === "pay" ? "Record cash payment" : "Record payment"}
        </Button>
      )}
      {history.length > 0 && (
        <Disclosure summary={`See payments (${history.length})`}>
          <ul className="space-y-2">
            {history.map((c) => (
              <CashRow key={c.id} report={c} />
            ))}
          </ul>
        </Disclosure>
      )}
      {recording && <CashPaymentSheet onClose={() => setRecording(false)} />}
    </Card>
  );
}

/** Something that needs this person: confirm cash that arrived, cancel their own pending report, or sort out a disagreement. */
function CashItem({ report: c }: { report: CashView }) {
  const { me, name, currency } = useEvent();
  const { run, error } = useInlineAction();
  const [problem, setProblem] = useState(false);
  if (c.dispute && c.dispute.status !== "RESOLVED") return <CashDisputeCard report={c} />;
  const iAmRecipient = c.to === me.memberId;
  return (
    <div className="space-y-2 rounded-xl border border-line p-3" data-testid="cash-item">
      <p className="text-[17px] font-semibold">{iAmRecipient ? `Did ${cashSent(c, currency)} from ${name(c.from)} arrive?` : `${cashSent(c, currency)} to ${name(c.to)} · Awaiting confirmation`}</p>
      <CashDetails report={c} />
      {iAmRecipient ? (
        <>
          <Button full variant="receive" icon="check" busyLabel="Confirming…" onClick={() => run(() => api.post(`/api/cash-payments/${c.id}/verify`, { expectedVersion: c.version }), `Confirmed ${cashSent(c, currency)} from ${name(c.from)}`)}>
            Confirm received
          </Button>
          <button type="button" onClick={() => setProblem(true)} className="inline-flex min-h-11 items-center px-1 text-[15px] font-semibold text-pay underline underline-offset-2">
            Report a problem
          </button>
          {problem && <CashProblemSheet report={c} onClose={() => setProblem(false)} />}
        </>
      ) : (
        <Button variant="tonal" busyLabel="Cancelling…" onClick={() => run(() => api.post(`/api/cash-payments/${c.id}/cancel`), "Cancelled")}>
          Cancel this
        </Button>
      )}
      <ActionError message={error} />
    </div>
  );
}

function CashDetails({ report: c }: { report: CashView }) {
  const { currency, money: fmt } = useEvent();
  return (
    <p className="text-[13px] text-muted">
      {c.method === "CASH" ? "Cash" : "Bank or e-wallet"} · {timeAgo(c.createdAt)}
      {c.paid ? ` · counts as ${fmt(c.amount)} (1 ${c.paid.currency} = ${c.paid.rate} ${currency}, ECB ${shortDay(c.paid.rateDate)})` : ""}
      {c.note ? ` · “${c.note}”` : ""}
      {c.replacesReportId ? " · recorded again after you both agreed" : ""}
    </p>
  );
}

/** One line of history, with the actual sender and recipient. The recipient can undo a mistaken confirmation once. */
function CashRow({ report: c }: { report: CashView }) {
  const { me, name, event, currency } = useEvent();
  const act = useAction();
  const status = c.reversal ? <Badge tone="warn">Undone</Badge> : c.status === "VERIFIED" ? <Badge tone="receive">✓ Confirmed</Badge> : c.status === "REPORTED" ? <Badge tone="warn">Waiting</Badge> : c.status === "REJECTED" ? <Badge tone="pay">Didn’t arrive</Badge> : <Badge>Cancelled</Badge>;
  const canUndo = c.to === me.memberId && c.status === "VERIFIED" && !c.reversal && event.phase !== "DONE" && !event.cancelled;
  return (
    <li className="rounded-xl border border-line p-3 text-[15px]" data-testid="cash-row">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          {name(c.from)} → {name(c.to)} · <b className="tnum">{cashSent(c, currency)}</b>
        </span>
        {status}
      </div>
      <CashDetails report={c} />
      {c.rejectReason && <p className="mt-1 text-[14px] text-pay">What happened: {c.rejectReason}</p>}
      {c.reversal && <p className="mt-1 text-[14px] text-warn">Undone by {name(c.to)}: {c.reversal.reason}</p>}
      {canUndo && (
        <Button
          variant="tonal"
          className="mt-2"
          busyLabel="Saving…"
          onClick={() => {
            const reason = prompt("Undo this confirmation? It fixes a mistake in the record and isn’t a refund (record money given back as a payment the other way)\n\nReason:");
            if (!reason || reason.trim().length < 3) return;
            return act(() => api.post(`/api/cash-payments/${c.id}/reverse`, { reason: reason.trim() }), "Undone, balances updated");
          }}
        >
          Undo confirmation
        </Button>
      )}
    </li>
  );
}

/** "Report a problem": the recipient says what happened; both people then sort it out together. */
function CashProblemSheet({ report: c, onClose }: { report: CashView; onClose: () => void }) {
  const { name } = useEvent();
  const { run, error } = useInlineAction();
  const [reason, setReason] = useState("");
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
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const ok = await run(() => api.post(`/api/cash-payments/${c.id}/reject`, { reason: reason.trim(), expectedVersion: c.version }), `Saved, ${name(c.from)} will see it`);
              if (ok) onClose();
              return ok;
            }}
          >
            Tell {name(c.from)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">Only continue if {name(c.from)} says they gave it to you and nothing came</p>
        <Field label="What happened?" hint="At least 3 characters">
          {(p) => <textarea {...p} className="field min-h-24" maxLength={200} value={reason} placeholder="e.g. I never got the cash" onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}

/** Both people pick the same answer; nobody else decides for them. */
export function CashDisputeCard({ report: c }: { report: CashView }) {
  const { me, name, currency } = useEvent();
  const act = useAction();
  const [recordAgain, setRecordAgain] = useState(false);
  const d = c.dispute!;
  const iAmSender = c.from === me.memberId;
  const other = name(iAmSender ? c.to : c.from);
  const mine = iAmSender ? d.senderChoice : d.recipientChoice;
  const theirs = iAmSender ? d.recipientChoice : d.senderChoice;
  const label = { NO_TRANSFER: "No money was handed over", REPLACEMENT: "It was handed over: record it again" } as const;
  if (d.status === "AWAITING_REPLACEMENT") {
    return (
      <div className="space-y-2 rounded-xl bg-warn-soft p-3" data-testid="cash-dispute">
        <p className="font-semibold">Agreed: record the {cashSent(c, currency)} again</p>
        {iAmSender ? (
          <>
            <p className="text-[14px]">Record the same money you already handed over, but don’t hand it over again</p>
            <Button full onClick={() => setRecordAgain(true)}>
              Record it again
            </Button>
            {recordAgain && <CashPaymentSheet replaces={c} onClose={() => setRecordAgain(false)} />}
          </>
        ) : (
          <p className="text-[14px]">{other} will record it again, then you’ll confirm it here</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-pay-soft p-3" data-testid="cash-dispute">
      <p className="font-semibold">
        Sort out the {cashSent(c, currency)} with {other}
      </p>
      {c.rejectReason && <p className="text-[14px]">What happened: {c.rejectReason}</p>}
      {(["NO_TRANSFER", "REPLACEMENT"] as const).map((choice) => (
        <Button key={choice} full variant={mine === choice ? "primary" : "secondary"} icon={mine === choice ? "check" : undefined} busyLabel="Saving…" onClick={() => act(() => api.post(`/api/cash-disputes/${d.id}`, { choice, expectedVersion: d.version }), "Answer saved")}>
          {label[choice]}
        </Button>
      ))}
      <p className="text-[13px] text-muted">{theirs ? `${other} chose: ${label[theirs as keyof typeof label]}` : `Waiting for ${other}`}</p>
    </div>
  );
}

/**
 * "Record a payment": who you gave money to, how much, and in which accepted
 * currency. It may be more than you owe (the rest becomes credit). Shows what
 * it does to your balance before you submit; the server recomputes everything.
 */
export function CashPaymentSheet({ onClose, replaces, prefill }: { onClose: () => void; replaces?: CashView; prefill?: { to?: string; amount?: string } }) {
  const { view, me, name, event, currency, money: fmt } = useEvent();
  const { run, error } = useInlineAction();
  const others = view.members.filter((m) => m.active && m.id !== me.memberId);
  const [to, setTo] = useState(replaces?.to ?? prefill?.to ?? others[0]?.id ?? "");
  const options = replaces ? [replaces.paid?.currency ?? currency] : to ? cashCurrencies(view, to) : [currency];
  const [chosen, setChosen] = useState<string | null>(replaces?.paid?.currency ?? null);
  const payIn = chosen && options.includes(chosen) ? chosen : options[0] ?? currency;
  const [amount, setAmount] = useState(replaces ? (replaces.paid ? replaces.paid.amount : replaces.amount) : (prefill?.amount ?? ""));
  const typedRaw = replaces ? amount : toMinor(amount, payIn);
  const [method, setMethod] = useState<"CASH" | "QR">((replaces?.method as "CASH" | "QR") ?? "CASH");
  const [note, setNote] = useState(replaces?.note ?? "");
  const key = useRef(newIdempotencyKey());
  const rate = payIn === currency ? null : replaces?.paid ? null : todayRate(view, payIn, currency);
  const sent = typedRaw && typedRaw !== "0" ? BigInt(typedRaw) : null;
  const credit = sent === null ? null : replaces ? BigInt(replaces.amount) : rate ? rate.convert(sent) : sent;
  const mine = view.balances.find((b) => b.memberId === me.memberId);
  const after = credit !== null && mine?.remaining != null ? BigInt(mine.remaining) + credit : null;
  const afterCredit = after !== null && mine?.expenseNet != null ? (after > 0n ? after : 0n) - (BigInt(mine.expenseNet) > 0n ? BigInt(mine.expenseNet) : 0n) : 0n;

  return (
    <Sheet
      open
      onClose={onClose}
      title={replaces ? `Record the ${cashSent(replaces, currency)} again` : "Record a payment"}
      footer={
        <div className="space-y-2">
          <ActionError message={error} />
          <Button
            full
            busyLabel="Saving…"
            disabled={!to || credit === null || credit <= 0n}
            onClick={async () => {
              if (!to || credit === null || sent === null) return;
              const body = {
                recipientMemberId: to,
                amount: credit.toString(),
                method,
                note,
                idempotencyKey: key.current,
                ...(payIn !== currency ? { paid: { currency: payIn, amount: sent.toString(), rateDate: replaces?.paid ? replaces.paid.rateDate : rate!.date } } : {}),
                ...(replaces ? { replacesReportId: replaces.id } : {}),
              };
              const ok = await run(() => api.post(`/api/events/${event.id}/cash-payments`, body), `Recorded, ${name(to)} will confirm`);
              if (ok) onClose();
              return ok;
            }}
          >
            {`Record ${sent !== null ? fmt(sent, payIn) : "payment"} to ${to ? name(to) : "…"}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="cash-sheet">
        <Notice tone="info">Only record money you already handed over, which counts once {to ? name(to) : "they"} confirm{to ? "s" : ""} it arrived</Notice>
        <Field label="Who did you give it to?">
          {(p) => (
            <select {...p} className="field" value={to} disabled={Boolean(replaces)} onChange={(e) => setTo(e.target.value)}>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
        </Field>
        {options.length > 1 && !replaces && (
          <div className="space-y-1.5">
            <p id="cash-currency" className="text-[14px] font-semibold text-muted">
              Currency
            </p>
            <div role="radiogroup" aria-labelledby="cash-currency" className="flex flex-wrap gap-1.5">
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
        <Field label={`Amount handed over (${payIn})`} hint={replaces ? "The same amount as before" : "It can be more than you owe: the rest becomes credit"}>
          {(p) => <MoneyInput {...p} currency={payIn} value={replaces ? money(amount, payIn).replace(`${payIn} `, "") : amount} readOnly={Boolean(replaces)} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {rate && credit !== null && (
          <p className="text-[15px]" data-testid="cash-counts-as">
            Counts as <b className="tnum">{fmt(credit)}</b> · 1 {payIn} = {rate.rateText()} {currency} (ECB, {shortDay(rate.date)})
          </p>
        )}
        {credit !== null && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-[15px]" data-testid="cash-estimate">
            {after === null
              ? "Balance pending: it’s worked out once the receipts add up"
              : `Once ${name(to)} confirms: ${balanceWords(after, afterCredit > 0n ? afterCredit : 0n)} ${fmt(after < 0n ? -after : after)}${afterCredit > 0n && afterCredit < after ? ` (includes ${fmt(afterCredit)} credit)` : ""}`}
          </p>
        )}
        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold">How</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "QR"] as const).map((m) => (
              <label key={m} className={`card flex min-h-12 items-center gap-2 p-3 ${method === m ? "border-violet ring-2 ring-violet-soft" : ""}`}>
                <input type="radio" name="cash-method" className="size-5 accent-[var(--violet)]" checked={method === m} onChange={() => setMethod(m)} />
                <Icon name={m === "CASH" ? "cash" : "qr"} size={18} /> {m === "CASH" ? "Cash" : "E-wallet"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Note (optional)" hint="e.g. “Taxi money” or a GCash ref ending 4821">
          {(p) => <input {...p} className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}
