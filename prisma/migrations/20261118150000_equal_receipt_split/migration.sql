-- Existing receipts keep item-by-item claiming.
ALTER TABLE "Receipt" ADD COLUMN "equalSplit" BOOLEAN NOT NULL DEFAULT false;
