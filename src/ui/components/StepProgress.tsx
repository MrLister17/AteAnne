/** Thin segmented bar for one-question-per-screen flows (Start a split, Join): "Step 2 of 3". */
export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${total}`}
        className="flex flex-1 gap-1.5"
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-violet" : "bg-line"}`} />
        ))}
      </div>
      <span aria-hidden className="tnum text-[13px] text-muted">
        {step + 1} of {total}
      </span>
    </div>
  );
}
