ALTER TABLE `Event`
  ADD COLUMN `travelType` VARCHAR(40) NOT NULL DEFAULT 'none',
  ADD COLUMN `travelPeople` INTEGER NULL,
  ADD COLUMN `km` DECIMAL(10, 2) NULL,
  ADD COLUMN `kmRate` DECIMAL(8, 2) NULL,
  ADD COLUMN `durationHours` DECIMAL(8, 2) NULL,
  ADD COLUMN `split5050` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `travelManualAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE `Event`
SET `travelType` = 'manual',
    `travelManualAmount` = `travelExpenseAmount`
WHERE `travelExpenseEnabled` = true
  AND `travelExpenseAmount` > 0;
