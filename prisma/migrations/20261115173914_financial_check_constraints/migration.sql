-- Database-level money and quantity guards (defence in depth behind Zod + domain checks).
-- Bound: PHP 1,000,000.00 = 100000000 centavos per receipt / line / adjustment.
ALTER TABLE "Receipt"        ADD CONSTRAINT receipt_payable_bounds   CHECK ("payableCentavos" >= 0 AND "payableCentavos" <= 100000000);
ALTER TABLE "ReceiptLine"    ADD CONSTRAINT line_amount_bounds       CHECK ("amountCentavos" >= 0 AND "amountCentavos" <= 100000000);
ALTER TABLE "ReceiptLine"    ADD CONSTRAINT line_quantity_positive   CHECK ("quantity" >= 1 AND "quantity" <= 1000);
ALTER TABLE "ReceiptLine"    ADD CONSTRAINT line_unit_price_bounds   CHECK ("unitPriceCentavos" IS NULL OR ("unitPriceCentavos" >= 0 AND "unitPriceCentavos" <= 100000000));
ALTER TABLE "Adjustment"     ADD CONSTRAINT adjustment_amount_bounds CHECK ("amountCentavos" >= 0 AND "amountCentavos" <= 100000000);
ALTER TABLE "FundingAck"     ADD CONSTRAINT funding_amount_bounds    CHECK ("amountCentavos" >= 0 AND "amountCentavos" <= 100000000);
ALTER TABLE "Claim"          ADD CONSTRAINT claim_units_positive     CHECK ("units" >= 1);
ALTER TABLE "SettlementEdge" ADD CONSTRAINT edge_amount_positive     CHECK ("amountCentavos" > 0);
ALTER TABLE "SettlementEdge" ADD CONSTRAINT edge_distinct_members    CHECK ("fromMemberId" <> "toMemberId");
ALTER TABLE "PaymentReport"  ADD CONSTRAINT report_amount_positive   CHECK ("amountCentavos" > 0);
ALTER TABLE "PaymentReport"  ADD CONSTRAINT report_distinct_members  CHECK ("senderMemberId" <> "recipientMemberId");
ALTER TABLE "SnapshotShare"  ADD CONSTRAINT share_nonnegative        CHECK ("fundingCentavos" >= 0 AND "costCentavos" >= 0);
