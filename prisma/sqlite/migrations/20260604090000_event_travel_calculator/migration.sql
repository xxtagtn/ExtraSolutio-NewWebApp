ALTER TABLE "Event" ADD COLUMN "travelType" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Event" ADD COLUMN "travelPeople" INTEGER;
ALTER TABLE "Event" ADD COLUMN "km" DECIMAL;
ALTER TABLE "Event" ADD COLUMN "kmRate" DECIMAL;
ALTER TABLE "Event" ADD COLUMN "durationHours" DECIMAL;
ALTER TABLE "Event" ADD COLUMN "split5050" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "travelManualAmount" DECIMAL NOT NULL DEFAULT 0;

UPDATE "Event"
SET "travelType" = 'manual',
    "travelManualAmount" = "travelExpenseAmount"
WHERE "travelExpenseEnabled" = true
  AND "travelExpenseAmount" > 0;
