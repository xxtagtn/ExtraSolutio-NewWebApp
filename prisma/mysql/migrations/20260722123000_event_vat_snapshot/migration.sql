ALTER TABLE `Event`
  ADD COLUMN `vatRateSnapshot` DECIMAL(8, 4) NOT NULL DEFAULT 0,
  ADD COLUMN `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE `Event` AS event_row
INNER JOIN `Budget` AS budget_row
  ON INSTR(COALESCE(event_row.`notes`, ''), CONCAT('[BUDGET_REF:', budget_row.`reference`, ']')) > 0
SET
  event_row.`vatRateSnapshot` = budget_row.`vatRate`,
  event_row.`taxAmount` = budget_row.`taxAmount`;
