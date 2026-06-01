ALTER TABLE `Event`
  ADD COLUMN `travelExpenseEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `travelExpenseAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;
