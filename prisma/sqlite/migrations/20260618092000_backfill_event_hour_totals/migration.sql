UPDATE "Event"
SET
  "realHours" = COALESCE((
    SELECT SUM("clientRealHours")
    FROM "EventAssignment"
    WHERE "eventId" = "Event"."id"
      AND LOWER(COALESCE("status", '')) NOT IN ('missed_justified', 'missed_unjustified', 'cancelled')
  ), "realHours", 0),
  "billableHours" = COALESCE((
    SELECT SUM("clientBillableHours")
    FROM "EventAssignment"
    WHERE "eventId" = "Event"."id"
      AND LOWER(COALESCE("status", '')) NOT IN ('missed_justified', 'missed_unjustified', 'cancelled')
  ), "billableHours", 0);
