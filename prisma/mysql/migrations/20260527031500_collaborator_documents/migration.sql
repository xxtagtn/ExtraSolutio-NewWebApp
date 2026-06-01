ALTER TABLE `Collaborator`
ADD COLUMN `documentType` VARCHAR(40) NULL,
ADD COLUMN `documentNumber` VARCHAR(80) NULL,
ADD COLUMN `documentExpiry` DATETIME(3) NULL;
