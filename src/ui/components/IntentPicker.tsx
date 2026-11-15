"use client";

type Intent = "WILL_PAY_ONLY" | "PAID_EXPENSE";

/** Initial intention — guides the UI only; anyone can both pay and consume later. */
export function IntentPicker({ value, onChange }: { value: Intent; onChange: (v: Intent) => void }) {
  const options: { v: Intent; title: string; text: string }[] = [
    { v: "PAID_EXPENSE", title: "I paid an expense", text: "I’ll add a receipt I paid for." },
    { v: "WILL_PAY_ONLY", title: "I’ll just pay my share", text: "Someone else paid; I’ll claim what I had." },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-[15px] font-semibold">How are you starting?</legend>
      {options.map((o) => (
        <label key={o.v} className={`card flex min-h-14 cursor-pointer items-start gap-3 p-3.5 ${value === o.v ? "border-violet ring-2 ring-violet-soft" : ""}`}>
          <input type="radio" name="intent" className="mt-1 size-5 accent-[var(--violet)]" checked={value === o.v} onChange={() => onChange(o.v)} />
          <span>
            <span className="block font-semibold">{o.title}</span>
            <span className="block text-[14px] text-muted">{o.text}</span>
          </span>
        </label>
      ))}
      <p className="px-1 text-[13px] text-muted">This is just a starting point — you can still add receipts and claim items either way.</p>
    </fieldset>
  );
}
