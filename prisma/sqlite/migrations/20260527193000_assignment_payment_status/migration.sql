ALTER TABLE "EventAssignment" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid';
CREATE INDEX "EventAssignment_paymentStatus_idx" ON "EventAssignment"("paymentStatus");
