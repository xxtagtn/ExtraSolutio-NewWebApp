ALTER TABLE `EventAssignment`
  ADD COLUMN `paymentDeferredMonth` VARCHAR(7) NULL;

CREATE INDEX `EventAssignment_paymentDeferredMonth_idx` ON `EventAssignment`(`paymentDeferredMonth`);
