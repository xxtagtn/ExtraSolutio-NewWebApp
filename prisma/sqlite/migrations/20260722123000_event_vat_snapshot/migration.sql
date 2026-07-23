ALTER TABLE "Event" ADD COLUMN "vatRateSnapshot" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Event" ADD COLUMN "taxAmount" DECIMAL NOT NULL DEFAULT 0;

UPDATE "Event"
SET
  "vatRateSnapshot" = COALESCE((
    SELECT "Budget"."vatRate"
    FROM "Budget"
    WHERE instr(COALESCE("Event"."notes", ''), '[BUDGET_REF:' || "Budget"."reference" || ']') > 0
    LIMIT 1
  ), "vatRateSnapshot"),
  "taxAmount" = COALESCE((
    SELECT "Budget"."taxAmount"
    FROM "Budget"
    WHERE instr(COALESCE("Event"."notes", ''), '[BUDGET_REF:' || "Budget"."reference" || ']') > 0
    LIMIT 1
  ), "taxAmount");
