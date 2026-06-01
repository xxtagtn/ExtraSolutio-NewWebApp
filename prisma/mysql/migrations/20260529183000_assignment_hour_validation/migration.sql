ALTER TABLE `EventAssignment`
  ADD COLUMN `clientCheckIn` VARCHAR(20) NULL,
  ADD COLUMN `clientCheckOut` VARCHAR(20) NULL,
  ADD COLUMN `validatedCheckIn` VARCHAR(20) NULL,
  ADD COLUMN `validatedCheckOut` VARCHAR(20) NULL,
  ADD COLUMN `clientBillableHours` DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN `staffPayableHours` DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN `validationStatus` VARCHAR(40) NOT NULL DEFAULT 'pending',
  ADD COLUMN `validationNotes` TEXT NULL;
