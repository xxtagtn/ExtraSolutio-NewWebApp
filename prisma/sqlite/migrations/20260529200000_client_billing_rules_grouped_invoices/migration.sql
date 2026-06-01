ALTER TABLE "Client" ADD COLUMN "billingMethod" TEXT NOT NULL DEFAULT 'per_event';
ALTER TABLE "Client" ADD COLUMN "billingCustomRule" TEXT;
ALTER TABLE "Client" ADD COLUMN "paymentTerm" TEXT NOT NULL DEFAULT 'days_30';
ALTER TABLE "Client" ADD COLUMN "paymentTermDays" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "eventIds" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "billingPeriodLabel" TEXT;
