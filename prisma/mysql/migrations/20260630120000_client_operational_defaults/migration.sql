ALTER TABLE `Client`
  ADD COLUMN `defaultUniform` VARCHAR(80) NULL,
  ADD COLUMN `defaultOnsiteContactName` VARCHAR(191) NULL,
  ADD COLUMN `defaultOnsiteContactPhone` VARCHAR(40) NULL,
  ADD COLUMN `prepaymentPercent` DECIMAL(5, 2) NOT NULL DEFAULT 70,
  ADD COLUMN `prepaymentRemainingDaysBefore` INT NOT NULL DEFAULT 7;
