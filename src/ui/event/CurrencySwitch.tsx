"use client";

import { currencyInfo, shortDay } from "@/domain/money/Currency";
import { useId, useState } from "react";
import { Icon } from "../components/Icon";
import { todayRate, useEvent, viewCurrencies } from "./EventContext";

/**
 * "Show totals in" (D60): each person can see the settle-up totals in another
 * currency used here (or pesos) at today's daily rate, marked "≈". Only what
 * this phone shows changes: inputs, receipts and anything paid or confirmed
 * stay exact. Hidden when the event only uses pesos.
 */
export function CurrencySwitch() {
  const { view, currency, viewCurrency, setViewCurrency } = useEvent();
  const rateId = useId();
  const [showRate, setShowRate] = useState(false);
  const options = viewCurrencies(view);
  if (options.length < 2) return null;
  const rate = todayRate(view, currency, viewCurrency);
  const reverse = rate ? todayRate(view, viewCurrency, currency) : null;
  return (
    <div className="space-y-1" data-testid="currency-switch">
      <div className="flex items-center gap-2">
        <Icon name="wallet" size={19} className="shrink-0 text-muted" />
        <div role="radiogroup" aria-label="Show totals in" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
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
        {rate && reverse && (
          <button
            type="button"
            aria-label="Today’s exchange rate"
            aria-expanded={showRate}
            aria-controls={rateId}
            onClick={() => setShowRate((open) => !open)}
            className="inline-grid size-11 shrink-0 place-items-center rounded-full text-violet active:bg-violet-soft"
          >
            <Icon name="info" size={19} />
          </button>
        )}
      </div>
      {rate && reverse ? (
        <p id={rateId} hidden={!showRate} className="px-1 text-[13px] text-muted" data-testid="view-rate">
          1 {viewCurrency} = {reverse.rateText()} {currency} (ECB, {shortDay(rate.date)}), and settlement balances are calculated in {currency}
        </p>
      ) : (
        !view.fx.today && <p className="text-[13px] text-muted">Rates unavailable · showing {currency}</p>
      )}
    </div>
  );
}
