-- v0.10.0 (D64): running event payments. Additive only: three new tables; no existing
-- table, column or row changes. Events without cash reports calculate exactly as before.

-- CreateTable
CREATE TABLE "CashReport" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "senderMemberId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "paidCurrency" CHAR(3),
    "paidMinor" BIGINT,
    "rate" VARCHAR(40),
    "rateDate" DATE,
    "rateSource" VARCHAR(20),
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'REPORTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "replacesReportId" TEXT,
    "rejectReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "CashReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReversal" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorMemberId" TEXT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDispute" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "senderChoice" "DisputeResolution",
    "recipientChoice" "DisputeResolution",
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolution" "DisputeResolution",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CashDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashReport_replacesReportId_key" ON "CashReport"("replacesReportId");

-- CreateIndex
CREATE INDEX "CashReport_eventId_idx" ON "CashReport"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReport_senderMemberId_idempotencyKey_key" ON "CashReport"("senderMemberId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashReversal_reportId_key" ON "CashReversal"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "CashDispute_reportId_key" ON "CashDispute"("reportId");

-- CreateIndex
CREATE INDEX "CashDispute_eventId_idx" ON "CashDispute"("eventId");

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_senderMemberId_fkey" FOREIGN KEY ("senderMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_replacesReportId_fkey" FOREIGN KEY ("replacesReportId") REFERENCES "CashReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReversal" ADD CONSTRAINT "CashReversal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CashReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDispute" ADD CONSTRAINT "CashDispute_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDispute" ADD CONSTRAINT "CashDispute_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CashReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Safety checks: two different people, a positive amount, and foreign-cash details all-or-none.
ALTER TABLE "CashReport" ADD CONSTRAINT "cash_report_distinct_parties" CHECK ("senderMemberId" <> "recipientMemberId");
ALTER TABLE "CashReport" ADD CONSTRAINT "cash_report_positive_amount" CHECK ("amountCentavos" > 0);
ALTER TABLE "CashReport" ADD CONSTRAINT "cash_report_foreign_all_or_none" CHECK (
  ("paidCurrency" IS NULL AND "paidMinor" IS NULL AND "rate" IS NULL AND "rateDate" IS NULL AND "rateSource" IS NULL)
  OR ("paidCurrency" IS NOT NULL AND "paidMinor" > 0 AND "rate" IS NOT NULL AND "rateDate" IS NOT NULL AND "rateSource" IS NOT NULL)
);

-- Same lockdown as every other table (see 20261115230235_lock_down_data_api).
ALTER TABLE "CashReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashReversal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashDispute" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CashReport', 'CashReversal', 'CashDispute'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM anon', current_schema(), t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM authenticated', current_schema(), t);
    END IF;
  END LOOP;
END $$;
