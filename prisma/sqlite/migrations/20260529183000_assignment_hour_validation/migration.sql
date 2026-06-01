ALTER TABLE "EventAssignment" ADD COLUMN "clientCheckIn" TEXT;
ALTER TABLE "EventAssignment" ADD COLUMN "clientCheckOut" TEXT;
ALTER TABLE "EventAssignment" ADD COLUMN "validatedCheckIn" TEXT;
ALTER TABLE "EventAssignment" ADD COLUMN "validatedCheckOut" TEXT;
ALTER TABLE "EventAssignment" ADD COLUMN "clientBillableHours" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "EventAssignment" ADD COLUMN "staffPayableHours" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "EventAssignment" ADD COLUMN "validationStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "EventAssignment" ADD COLUMN "validationNotes" TEXT;
