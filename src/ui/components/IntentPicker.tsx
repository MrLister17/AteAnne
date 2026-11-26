"use client";

type Intent = "WILL_PAY_ONLY" | "PAID_EXPENSE";

/** Initial intention — guides the UI only; anyone can both pay and consume later. */
export function IntentPicker({ value, onChange }: { value: Intent; onChange: (v: Intent) => void }) {
  const options: { v: Intent; title: string; text: string }[] = [
    { v: "PAID_EXPENSE", title: "I paid", text: "I’ll add the receipt" },
    { v: "WILL_PAY_ONLY", title: "Someone else paid", text: "I’ll just claim what I had" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-[15px] font-semibold">Who paid the bill?</legend>
      {options.map((o) => (
        <label key={o.v} className={`card flex min-h-14 cursor-pointer items-start gap-3 p-3.5 ${value === o.v ? "border-violet ring-2 ring-violet-soft" : ""}`}>
          <input type="radio" name="intent" className="mt-1 size-5 accent-[var(--violet)]" checked={value === o.v} onChange={() => onChange(o.v)} />
          <span>
            <span className="block font-semibold">{o.title}</span>
            <span className="block text-[14px] text-muted">{o.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
