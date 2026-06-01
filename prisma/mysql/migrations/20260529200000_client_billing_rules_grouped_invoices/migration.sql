ALTER TABLE `Client`
  ADD COLUMN `billingMethod` VARCHAR(40) NOT NULL DEFAULT 'per_event',
  ADD COLUMN `billingCustomRule` TEXT NULL,
  ADD COLUMN `paymentTerm` VARCHAR(40) NOT NULL DEFAULT 'days_30',
  ADD COLUMN `paymentTermDays` INT NULL;

ALTER TABLE `Invoice`
  ADD COLUMN `eventIds` LONGTEXT NULL,
  ADD COLUMN `billingPeriodLabel` VARCHAR(191) NULL;
