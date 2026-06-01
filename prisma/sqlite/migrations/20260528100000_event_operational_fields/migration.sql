ALTER TABLE "Event" ADD COLUMN "eventType" TEXT;
ALTER TABLE "Event" ADD COLUMN "useDefaultLocation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN "actualStartTime" TEXT;
ALTER TABLE "Event" ADD COLUMN "actualEndTime" TEXT;
ALTER TABLE "Event" ADD COLUMN "billableHours" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Event" ADD COLUMN "uniform" TEXT;
ALTER TABLE "Event" ADD COLUMN "meetingPoint" TEXT;
ALTER TABLE "Event" ADD COLUMN "onsiteContactName" TEXT;
ALTER TABLE "Event" ADD COLUMN "onsiteContactPhone" TEXT;
