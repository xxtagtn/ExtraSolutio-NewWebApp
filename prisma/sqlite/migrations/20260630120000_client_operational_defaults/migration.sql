ALTER TABLE "Client" ADD COLUMN "defaultUniform" TEXT;
ALTER TABLE "Client" ADD COLUMN "defaultOnsiteContactName" TEXT;
ALTER TABLE "Client" ADD COLUMN "defaultOnsiteContactPhone" TEXT;
ALTER TABLE "Client" ADD COLUMN "prepaymentPercent" DECIMAL NOT NULL DEFAULT 70;
ALTER TABLE "Client" ADD COLUMN "prepaymentRemainingDaysBefore" INTEGER NOT NULL DEFAULT 7;
