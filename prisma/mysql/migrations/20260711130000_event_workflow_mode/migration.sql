-- Persist whether an operational event status is controlled by the workflow or explicitly by an administrator.
ALTER TABLE `Event`
  ADD COLUMN `statusMode` VARCHAR(20) NOT NULL DEFAULT 'automatic';
