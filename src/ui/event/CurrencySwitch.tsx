"use client";

import { currencyInfo, shortDay } from "@/domain/money/Currency";
import { todayRate, useEvent, viewCurrencies } from "./EventContext";

/**
 * "Show totals in" (D60): each person can see the settle-up totals in another
 * currency used here (or pesos) at today's daily rate, marked "≈". Only what
 * this phone shows changes: inputs, receipts and anything paid or confirmed
 * stay exact. Hidden when the event only uses pesos.
 */
export function CurrencySwitch() {
  const { view, currency, viewCurrency, setViewCurrency } = useEvent();
  const options = viewCurrencies(view);
  if (options.length < 2) return null;
  const rate = todayRate(view, currency, viewCurrency);
  const reverse = rate ? todayRate(view, viewCurrency, currency) : null;
  return (
    <div className="space-y-1" data-testid="currency-switch">
      <div className="flex items-center gap-2">
        <span id="show-totals-in" className="shrink-0 text-[14px] font-semibold text-muted">
          Show totals in
        </span>
        <div role="radiogroup" aria-labelledby="show-totals-in" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {options.map((code) => {
            const on = code === viewCurrency;
            const available = code === currency || Boolean(todayRate(view, currency, code));
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!available}
                onClick={() => setViewCurrency(code)}
                title={currencyInfo(code).name}
                className={`min-h-11 rounded-full border px-3.5 text-[15px] font-semibold ${on ? "border-violet bg-violet text-violet-ink" : "border-line bg-surface text-ink active:bg-surface-2"} disabled:opacity-40`}
              >
                {currencyInfo(code).symbol} {code}
              </button>
            );
          })}
        </div>
      </div>
      {rate && reverse ? (
        <p className="text-[13px] text-muted" data-testid="view-rate">
          ≈ today’s rate: 1 {viewCurrency} = {reverse.rateText()} {currency} (ECB, {shortDay(rate.date)}). Payments stay in {currency}.
        </p>
      ) : (
        !view.fx.today && <p className="text-[13px] text-muted">Today’s rate isn’t available right now, so totals show in {currency}.</p>
      )}
    </div>
  );
}
