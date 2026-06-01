ALTER TABLE `EventAssignment`
  ADD COLUMN `paymentStatus` VARCHAR(40) NOT NULL DEFAULT 'unpaid';

CREATE INDEX `EventAssignment_paymentStatus_idx` ON `EventAssignment`(`paymentStatus`);
