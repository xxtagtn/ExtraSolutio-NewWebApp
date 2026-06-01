ALTER TABLE `Budget` DROP FOREIGN KEY `Budget_clientId_fkey`;

ALTER TABLE `Budget`
  MODIFY `clientId` INTEGER NULL,
  MODIFY `description` TEXT NULL,
  ADD COLUMN `leadName` VARCHAR(191) NULL,
  ADD COLUMN `companyName` VARCHAR(191) NULL,
  ADD COLUMN `phone` VARCHAR(40) NULL,
  ADD COLUMN `email` VARCHAR(191) NULL,
  ADD COLUMN `nif` VARCHAR(30) NULL,
  ADD COLUMN `eventType` VARCHAR(80) NULL,
  ADD COLUMN `guestsCount` INTEGER NULL,
  ADD COLUMN `startTime` VARCHAR(20) NULL,
  ADD COLUMN `endTime` VARCHAR(20) NULL,
  ADD COLUMN `leadSource` VARCHAR(80) NULL,
  ADD COLUMN `serviceType` VARCHAR(80) NULL,
  ADD COLUMN `eventLevel` VARCHAR(40) NULL,
  ADD COLUMN `regularClient` BOOLEAN NULL,
  ADD COLUMN `locationScope` VARCHAR(40) NULL,
  ADD COLUMN `minimumHours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `sentAt` DATETIME(3) NULL,
  ADD COLUMN `lostReason` VARCHAR(120) NULL,
  ADD COLUMN `followUpHistory` LONGTEXT NULL,
  ADD COLUMN `responseTemplate` VARCHAR(80) NULL,
  ADD COLUMN `commercialEmailText` LONGTEXT NULL,
  ADD COLUMN `commercialWhatsappText` LONGTEXT NULL,
  ADD COLUMN `commercialPdfText` LONGTEXT NULL,
  ADD COLUMN `marginAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE `Budget`
SET `status` = CASE `status`
  WHEN 'draft' THEN 'new_request'
  WHEN 'rejected' THEN 'lost'
  ELSE `status`
END;

CREATE INDEX `Budget_sentAt_idx` ON `Budget`(`sentAt`);
CREATE INDEX `Budget_leadSource_idx` ON `Budget`(`leadSource`);

ALTER TABLE `Budget` ADD CONSTRAINT `Budget_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
