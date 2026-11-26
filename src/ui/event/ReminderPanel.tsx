"use client";

import { useState } from "react";
import { Button, CopyButton, Sheet, useToast } from "../components/ui";
import { useEvent } from "./EventContext";
import { reminderMessage, remindersFor } from "./reminders";

/**
 * "Copy reminder" button for the Home tab's next-step card, plus its sheet.
 * Copy only: the person chooses where to paste it; no Messenger account is connected.
 */
export function ReminderButton() {
  const { view, reload } = useEvent();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const reminders = remindersFor(view);
  if (!reminders.length) return null;
  const selected = memberId ? reminders.filter((r) => r.memberId === memberId) : reminders;
  const eventUrl = typeof window === "undefined" ? "" : `${window.location.origin}/e/${view.event.id}`;
  const text = reminderMessage(view, selected, eventUrl);
  return (
    <>
      <Button full variant="secondary" icon="copy" onClick={async () => {
        try {
          await reload();
          setMemberId("");
          setOpen(true);
        } catch {
          toast("Couldn’t refresh, so try again before copying a reminder", "error");
        }
      }}>Copy reminder</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Copy reminder for Messenger">
        <div className="space-y-4">
          <p className="text-[14px] text-muted">Waiting for someone? Copy their next steps and paste them into your group or private chat, since Hatian doesn’t send reminders by itself</p>
          <label className="block space-y-2 text-[15px] font-semibold">
            <span>Who is this for?</span>
            <select className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Everyone with something to do</option>
              {reminders.map((r) => <option key={r.memberId} value={r.memberId}>{r.name}</option>)}
            </select>
          </label>
          <p className="text-[14px] text-muted">Review the message, then copy it (recipients need their existing event access)</p>
          {selected.length ? (
            <>
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-sans text-[14px]" data-testid="reminder-preview">{text}</pre>
              <CopyButton text={text} label="Copy message" />
            </>
          ) : <p role="status">Their to-do list has changed, so choose another person or close this reminder</p>}
        </div>
      </Sheet>
    </>
  );
}
