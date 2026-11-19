-- S10 (v0.9.0, D58–D62): receipts in any currency, one settle-up currency per
-- event, payments sent in another currency, and a daily exchange-rate cache.
-- Additive only: existing rows read as pesos, bought on the day they were
-- entered, and paid in the settle-up currency.

ALTER TABLE "Event" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'PHP';

ALTER TABLE "Receipt" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'PHP';
ALTER TABLE "Receipt" ADD COLUMN "purchasedOn" DATE;

ALTER TABLE "PaymentInstruction" ADD COLUMN "acceptedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "PaymentReport" ADD COLUMN "paidCurrency" CHAR(3);
ALTER TABLE "PaymentReport" ADD COLUMN "paidMinor" BIGINT;
ALTER TABLE "PaymentReport" ADD COLUMN "rate" VARCHAR(40);
ALTER TABLE "PaymentReport" ADD COLUMN "rateDate" DATE;
ALTER TABLE "PaymentReport" ADD COLUMN "rateSource" VARCHAR(20);
-- A payment sent in another currency carries everything needed to recheck it.
ALTER TABLE "PaymentReport" ADD CONSTRAINT "payment_report_foreign_all_or_none" CHECK (
  ("paidCurrency" IS NULL AND "paidMinor" IS NULL AND "rate" IS NULL AND "rateDate" IS NULL AND "rateSource" IS NULL)
  OR ("paidCurrency" IS NOT NULL AND "paidMinor" > 0 AND "rate" IS NOT NULL AND "rateDate" IS NOT NULL AND "rateSource" IS NOT NULL)
);

CREATE TABLE "ExchangeRate" (
    "source" VARCHAR(20) NOT NULL,
    "day" DATE NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "perEur" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("source","day")
);

-- Same lockdown as every other table (see 20261115230235_lock_down_data_api).
ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON TABLE %I."ExchangeRate" FROM anon', current_schema());
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON TABLE %I."ExchangeRate" FROM authenticated', current_schema());
  END IF;
END $$;
