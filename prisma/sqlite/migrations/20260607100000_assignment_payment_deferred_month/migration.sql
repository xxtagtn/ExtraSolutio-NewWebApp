ALTER TABLE "EventAssignment" ADD COLUMN "paymentDeferredMonth" TEXT;
CREATE INDEX "EventAssignment_paymentDeferredMonth_idx" ON "EventAssignment"("paymentDeferredMonth");
