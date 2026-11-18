"use client";

import { useRef, useState } from "react";
import { api, newIdempotencyKey } from "../api";
import { Icon } from "../components/Icon";
import { Badge, BalanceBanner, Button, Card, Field, MoneyInput, Notice, Progress, SectionTitle, Sheet, balanceLabel } from "../components/ui";
import { php, phpAbs, timeAgo, toCentavos, toInput } from "../format";
import { MAX_CLIENT_UPLOAD_BYTES, prepareImage, uploadName } from "../image";
import { EdgeView, useAction, useEvent } from "./EventContext";

/**
 * Settlement: frozen edges, payment instructions (cash/QR), "reported sent"
 * vs recipient-confirmed amounts, rejection disputes and reversal.
 */
export function SettlementSection() {
  const { view, me, event } = useEvent();
  const s = view.settlement!;
  const mine = s.positions.find((p) => p.memberId === me.memberId)!;
  const toPay = s.edges.filter((e) => e.from === me.memberId);
  const toReceive = s.edges.filter((e) => e.to === me.memberId);
  const others = s.edges.filter((e) => !e.involvesMe);

  return (
    <div className="space-y-3">
      <BalanceBanner
        net={mine.remaining}
        caption={mine.remaining === mine.net ? "Frozen statement · only recipient-confirmed payments change this" : `Bill net: ${balanceLabel(mine.net).text.toLowerCase()} ${phpAbs(mine.net)} · confirmed payments included`}
      />
      {event.phase === "DONE" && <Notice tone="receive" title="Done">Every transfer was confirmed by its recipient. This statement is read-only.</Notice>}
      {s.edges.length === 0 && <Notice tone="receive">Nobody owes anybody in this event.</Notice>}

      {toPay.length > 0 && <SectionTitle>You pay</SectionTitle>}
      {toPay.map((e) => (
        <PayEdge key={e.id} edge={e} />
      ))}

      {toReceive.length > 0 && <SectionTitle>You receive</SectionTitle>}
      {toReceive.map((e) => (
        <ReceiveEdge key={e.id} edge={e} />
      ))}

      {(toReceive.length > 0 || view.instructions[me.memberId]) && event.phase !== "DONE" && <InstructionsEditor />}

      {others.length > 0 && <SectionTitle>Other transfers</SectionTitle>}
      {others.map((e) => (
        <EdgeSummary key={e.id} edge={e} />
      ))}
    </div>
  );
}

function EdgeHeader({ edge }: { edge: EdgeView }) {
  const { name } = useEvent();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-semibold">
          {name(edge.from)} <span className="text-muted">→</span> {name(edge.to)}
        </p>
        {edge.settled ? <Badge tone="receive">✓ Settled</Badge> : edge.disputed ? <Badge tone="pay">Disputed</Badge> : edge.pending !== "0" ? <Badge tone="warn">Awaiting confirmation</Badge> : <Badge>Open</Badge>}
      </div>
      <Progress value={Number(edge.verified)} pending={Number(edge.pending)} max={Number(edge.amount)} tone="receive" />
      <dl className="tnum grid grid-cols-3 gap-1 text-[13px]">
        <div>
          <dt className="text-muted">Transfer</dt>
          <dd className="font-semibold">{php(edge.amount)}</dd>
        </div>
        <div>
          <dt className="text-muted">Confirmed</dt>
          <dd className="font-semibold text-receive">{php(edge.verified)}</dd>
        </div>
        <div>
          <dt className="text-muted">Reported, pending</dt>
          <dd className="font-semibold text-warn">{php(edge.pending)}</dd>
        </div>
      </dl>
    </div>
  );
}

function PayEdge({ edge }: { edge: EdgeView }) {
  const { view, event, name } = useEvent();
  const [reporting, setReporting] = useState(false);
  const instr = view.instructions[edge.to];
  const agreedReplacement = edge.dispute?.status === "AWAITING_REPLACEMENT" ? edge.dispute.rejectedReportId : null;

  return (
    <Card className="space-y-3">
      <EdgeHeader edge={edge} />
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
                  <p className="mt-1 text-[12px] text-muted">Check the name shown in your e-wallet/bank app before sending. AteAnne doesn’t read or verify QR codes.</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-muted">Not shared yet — ask them, or pay cash.</p>
          )}
        </div>
      )}
      {edge.disputed && edge.dispute && <DisputeCard edge={edge} />}
      {!edge.settled && event.phase === "SETTLING" && (!edge.disputed || agreedReplacement) && edge.capacity !== "0" && (
        <Button full icon="arrowUp" onClick={() => setReporting(true)}>
          {agreedReplacement ? "Re-record the transfer you already sent" : "I sent money"}
        </Button>
      )}
      {edge.capacity === "0" && !edge.settled && <p className="text-[14px] text-muted">Everything left is reported and waiting for {name(edge.to)} to confirm.</p>}
      <ReportList edge={edge} role="sender" />
      {reporting && <ReportSheet edge={edge} replaces={agreedReplacement} hasQr={Boolean(instr?.qrAssetId)} onClose={() => setReporting(false)} />}
    </Card>
  );
}

function ReportSheet({ edge, replaces, hasQr, onClose }: { edge: EdgeView; replaces: string | null; hasQr: boolean; onClose: () => void }) {
  const { name } = useEvent();
  const act = useAction();
  const [amount, setAmount] = useState(toInput(edge.capacity));
  const [method, setMethod] = useState<"CASH" | "QR">(hasQr ? "QR" : "CASH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey()); // same key on retry → no duplicate report
  const cents = toCentavos(amount);
  const tooMuch = cents !== null && BigInt(cents) > BigInt(edge.capacity);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Report money sent to ${name(edge.to)}`}
      footer={
        <Button
          full
          busy={busy}
          disabled={!cents || cents === "0" || tooMuch}
          onClick={async () => {
            setBusy(true);
            const ok = await act(() => api.post(`/api/edges/${edge.id}/reports`, { amount: cents, method, note, idempotencyKey: key.current, ...(replaces ? { replacesReportId: replaces } : {}) }), `Reported — waiting for ${name(edge.to)} to confirm`);
            setBusy(false);
            if (ok) onClose();
          }}
        >
          Report {cents ? php(cents) : ""} sent
        </Button>
      }
    >
      <div className="space-y-4">
        <Notice tone="info">Only report money you have actually sent. It stays “pending” until {name(edge.to)} confirms it arrived.</Notice>
        <Field label="Amount sent" hint={`Up to ${php(edge.capacity)} on this transfer. Partial payments are fine.`} error={tooMuch ? `More than the ${php(edge.capacity)} still open` : null}>
          {(p) => <MoneyInput {...p} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
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
        <Field label="Note (optional)" hint="e.g. GCash ref ending 4821 — never paste full account numbers.">
          {(p) => <input {...p} className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}

function ReceiveEdge({ edge }: { edge: EdgeView }) {
  return (
    <Card className="space-y-3">
      <EdgeHeader edge={edge} />
      {edge.disputed && edge.dispute && <DisputeCard edge={edge} />}
      <ReportList edge={edge} role="recipient" />
    </Card>
  );
}

function ReportList({ edge, role }: { edge: EdgeView; role: "sender" | "recipient" }) {
  const { name, event } = useEvent();
  const act = useAction();
  if (!edge.reports.length) return null;
  const sorted = [...edge.reports].reverse();
  return (
    <ul className="space-y-2">
      {sorted.map((r) => (
        <li key={r.id} className="rounded-xl border border-line p-3 text-[15px]">
          <div className="flex items-center gap-2">
            <Icon name={r.method === "CASH" ? "cash" : "qr"} size={18} className="text-muted" />
            <b className="tnum">{php(r.amount)}</b>
            <span className="text-[13px] text-muted">{timeAgo(r.createdAt)}</span>
            <span className="ml-auto">
              {r.reversal ? <Badge tone="warn">Confirmation reversed</Badge> : r.status === "VERIFIED" ? <Badge tone="receive">✓ Received</Badge> : r.status === "REPORTED" ? <Badge tone="warn">Pending</Badge> : r.status === "REJECTED" ? <Badge tone="pay">Not received</Badge> : <Badge>Cancelled</Badge>}
            </span>
          </div>
          {r.note && <p className="mt-1 text-[14px] text-muted">“{r.note}”</p>}
          {r.replacesReportId && <p className="mt-1 text-[13px] text-muted">Re-recorded transfer (replaces a rejected report — not a new payment).</p>}
          {r.rejectReason && <p className="mt-1 text-[14px] text-pay">Reason: {r.rejectReason}</p>}
          {r.reversal && <p className="mt-1 text-[14px] text-warn">Reversed by {name(edge.to)}: {r.reversal.reason}</p>}

          {role === "recipient" && r.status === "REPORTED" && event.phase === "SETTLING" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="receive" icon="check" onClick={() => act(() => api.post(`/api/payments/${r.id}/verify`, { expectedVersion: r.version }), "Confirmed received")}>
                Received
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const reason = prompt("Why? (e.g. “Nothing arrived in my GCash”)");
                  if (reason && reason.trim().length >= 3) void act(() => api.post(`/api/payments/${r.id}/reject`, { reason, expectedVersion: r.version }), "Marked not received");
                }}
              >
                Not received
              </Button>
            </div>
          )}
          {role === "sender" && r.status === "REPORTED" && (
            <Button variant="tonal" className="mt-2" onClick={() => act(() => api.post(`/api/payments/${r.id}/cancel`), "Report cancelled")}>
              Cancel this report
            </Button>
          )}
          {role === "recipient" && r.status === "VERIFIED" && !r.reversal && event.phase === "SETTLING" && (
            <Button
              variant="tonal"
              className="mt-2"
              onClick={() => {
                const reason = prompt("You can undo your confirmation once, before the event is Done. This is a record correction, not a refund. Reason:");
                if (reason && reason.trim().length >= 3) void act(() => api.post(`/api/payments/${r.id}/reverse`, { reason }), "Confirmation reversed; the amount is open again");
              }}
            >
              I confirmed this by mistake
            </Button>
          )}
        </li>
      ))}
    </ul>
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
  const label = { NO_TRANSFER: "No money was actually sent", REPLACEMENT: "Money was sent; re-record it correctly" } as const;
  if (d.status === "AWAITING_REPLACEMENT") {
    return <Notice tone="warn" title="Agreed: re-record the transfer">{iAmSender ? "Record the money you already sent (don’t send again). Then the recipient confirms it." : `${other} will re-record the transfer they already sent. You’ll confirm it here.`}</Notice>;
  }
  return (
    <div className="space-y-2 rounded-xl bg-pay-soft p-3">
      <p className="font-semibold">Resolve this before paying again</p>
      <p className="text-[14px]">A report was marked not received. You both need to pick the same answer. Nobody — including the organizer — can decide for you.</p>
      {(["NO_TRANSFER", "REPLACEMENT"] as const).map((c) => (
        <Button key={c} full variant={myChoice === c ? "primary" : "secondary"} icon={myChoice === c ? "check" : undefined} onClick={() => act(() => api.post(`/api/disputes/${d.id}`, { choice: c, expectedVersion: d.version }), "Answer saved")}>
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
  const { view, me, event } = useEvent();
  const act = useAction();
  const cur = view.instructions[me.memberId];
  const [open, setOpen] = useState(false);
  const [cash, setCash] = useState(cur?.acceptsCash ?? true);
  const [cashNote, setCashNote] = useState(cur?.cashNote ?? "");
  const [qrLabel, setQrLabel] = useState(cur?.qrLabel ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card className="flex items-center gap-3">
        <Icon name="wallet" className="text-violet" />
        <div className="min-w-0 flex-1 text-[15px]">
          <p className="font-semibold">How you get paid</p>
          <p className="text-muted">{cur ? [cur.acceptsCash && "Cash", cur.hasQr && "QR"].filter(Boolean).join(" + ") + ` · v${cur.version}` : "Not shared yet"}</p>
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
                      return api.post(`/api/events/${event.id}/assets`, fd);
                    }, "Payment details saved")
                  : await act(() => api.post(`/api/events/${event.id}/instructions`, { acceptsCash: cash, cashNote, qrLabel, keepQr: !removeQr }), "Payment details saved");
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
            <p className="text-[13px] text-muted">Changing these never changes the approved amounts. Earlier payment reports keep the version they used.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}
