ALTER TABLE "Transaction" ADD COLUMN "vatAmount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "supplier" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "documentName" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "documentData" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "sentToAccountant" BOOLEAN NOT NULL DEFAULT false;
