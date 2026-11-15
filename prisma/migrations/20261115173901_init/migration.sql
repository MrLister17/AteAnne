-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('COLLECTING', 'ALLOCATING', 'REVIEWING', 'SETTLING', 'DONE');

-- CreateEnum
CREATE TYPE "Intent" AS ENUM ('WILL_PAY_ONLY', 'PAID_EXPENSE');

-- CreateEnum
CREATE TYPE "ShareMode" AS ENUM ('SHARED', 'UNITS');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('DISCOUNT', 'SERVICE', 'CHARGE');

-- CreateEnum
CREATE TYPE "ReceiptAckKind" AS ENUM ('FINISHED', 'NONE');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QR');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('REPORTED', 'VERIFIED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'AWAITING_REPLACEMENT', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('NO_TRANSFER', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('RECEIPT', 'QR');

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "phase" "Phase" NOT NULL DEFAULT 'COLLECTING',
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "ownerMemberId" TEXT,
    "joinCodeHash" TEXT,
    "joinCodeCiphertext" TEXT,
    "joinCodeExpiresAt" TIMESTAMP(3),
    "structuralVersion" INTEGER NOT NULL DEFAULT 1,
    "financialVersion" INTEGER NOT NULL DEFAULT 1,
    "nextMemberSeq" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rosterLockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorId" TEXT,
    "displayName" VARCHAR(40) NOT NULL,
    "intent" "Intent" NOT NULL DEFAULT 'WILL_PAY_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "entryComplete" BOOLEAN NOT NULL DEFAULT false,
    "claimVersion" INTEGER NOT NULL DEFAULT 1,
    "recoveryHash" TEXT NOT NULL,
    "recoveryExpiresAt" TIMESTAMP(3) NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "payerMemberId" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "payableCentavos" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL,
    "imageAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "unitPriceCentavos" BIGINT,
    "mode" "ShareMode" NOT NULL DEFAULT 'SHARED',

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "scopeAll" BOOLEAN NOT NULL DEFAULT true,
    "eligibleLineIds" TEXT[],

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingAck" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "receiptVersion" INTEGER NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "receiptVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAck" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "kind" "ReceiptAckKind" NOT NULL,
    "receiptVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewApproval" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "financialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "financialVersion" INTEGER NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
    "policyVersion" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "firstReportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotShare" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fundingCentavos" BIGINT NOT NULL,
    "costCentavos" BIGINT NOT NULL,
    "netCentavos" BIGINT NOT NULL,

    CONSTRAINT "SnapshotShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementEdge" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "amountCentavos" BIGINT NOT NULL,

    CONSTRAINT "SettlementEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInstruction" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptsCash" BOOLEAN NOT NULL DEFAULT true,
    "cashNote" VARCHAR(200) NOT NULL DEFAULT '',
    "qrAssetId" TEXT,
    "qrLabel" VARCHAR(60) NOT NULL DEFAULT '',
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReport" (
    "id" TEXT NOT NULL,
    "edgeId" TEXT NOT NULL,
    "senderMemberId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "instructionId" TEXT,
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'REPORTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "replacesReportId" TEXT,
    "rejectReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorMemberId" TEXT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "edgeId" TEXT NOT NULL,
    "rejectedReportId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "senderChoice" "DisputeResolution",
    "recipientChoice" "DisputeResolution",
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolution" "DisputeResolution",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ownerMemberId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "type" VARCHAR(60) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_ownerMemberId_key" ON "Event"("ownerMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_joinCodeHash_key" ON "Event"("joinCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Member_recoveryHash_key" ON "Member"("recoveryHash");

-- CreateIndex
CREATE INDEX "Member_actorId_idx" ON "Member"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_eventId_actorId_key" ON "Member"("eventId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_eventId_seq_key" ON "Member"("eventId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_imageAssetId_key" ON "Receipt"("imageAssetId");

-- CreateIndex
CREATE INDEX "Receipt_eventId_idx" ON "Receipt"("eventId");

-- CreateIndex
CREATE INDEX "ReceiptLine_receiptId_idx" ON "ReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "Adjustment_receiptId_idx" ON "Adjustment"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingAck_receiptId_receiptVersion_key" ON "FundingAck"("receiptId", "receiptVersion");

-- CreateIndex
CREATE INDEX "Claim_lineId_idx" ON "Claim"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_memberId_lineId_key" ON "Claim"("memberId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptAck_memberId_receiptId_key" ON "ReceiptAck"("memberId", "receiptId");

-- CreateIndex
CREATE INDEX "ReviewApproval_eventId_financialVersion_idx" ON "ReviewApproval"("eventId", "financialVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewApproval_memberId_financialVersion_key" ON "ReviewApproval"("memberId", "financialVersion");

-- CreateIndex
CREATE INDEX "Snapshot_eventId_status_idx" ON "Snapshot"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotShare_snapshotId_memberId_key" ON "SnapshotShare"("snapshotId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementEdge_snapshotId_position_key" ON "SettlementEdge"("snapshotId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInstruction_memberId_version_key" ON "PaymentInstruction"("memberId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReport_replacesReportId_key" ON "PaymentReport"("replacesReportId");

-- CreateIndex
CREATE INDEX "PaymentReport_edgeId_idx" ON "PaymentReport"("edgeId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReport_senderMemberId_idempotencyKey_key" ON "PaymentReport"("senderMemberId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_reportId_key" ON "PaymentReversal"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_rejectedReportId_key" ON "Dispute"("rejectedReportId");

-- CreateIndex
CREATE INDEX "Dispute_edgeId_idx" ON "Dispute"("edgeId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_eventId_idx" ON "Asset"("eventId");

-- CreateIndex
CREATE INDEX "AuditEvent_eventId_createdAt_idx" ON "AuditEvent"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_payerMemberId_fkey" FOREIGN KEY ("payerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAck" ADD CONSTRAINT "FundingAck_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAck" ADD CONSTRAINT "FundingAck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ReceiptLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAck" ADD CONSTRAINT "ReceiptAck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAck" ADD CONSTRAINT "ReceiptAck_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewApproval" ADD CONSTRAINT "ReviewApproval_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewApproval" ADD CONSTRAINT "ReviewApproval_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotShare" ADD CONSTRAINT "SnapshotShare_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotShare" ADD CONSTRAINT "SnapshotShare_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEdge" ADD CONSTRAINT "SettlementEdge_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEdge" ADD CONSTRAINT "SettlementEdge_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEdge" ADD CONSTRAINT "SettlementEdge_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_qrAssetId_fkey" FOREIGN KEY ("qrAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "SettlementEdge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_senderMemberId_fkey" FOREIGN KEY ("senderMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "PaymentInstruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_replacesReportId_fkey" FOREIGN KEY ("replacesReportId") REFERENCES "PaymentReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PaymentReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "SettlementEdge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_rejectedReportId_fkey" FOREIGN KEY ("rejectedReportId") REFERENCES "PaymentReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
