UPDATE "EventAssignment"
SET "clientRealHours" = "clientBillableHours";

UPDATE "Event"
SET "realHours" = "billableHours";
