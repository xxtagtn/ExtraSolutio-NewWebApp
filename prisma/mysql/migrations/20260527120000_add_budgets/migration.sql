CREATE TABLE `Budget` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `reference` VARCHAR(60) NOT NULL,
  `clientId` INTEGER NOT NULL,
  `eventDate` DATETIME(3) NULL,
  `description` TEXT NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'draft',
  `paymentStatus` VARCHAR(40) NOT NULL DEFAULT 'pending',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Budget_reference_key`(`reference`),
  INDEX `Budget_clientId_idx`(`clientId`),
  INDEX `Budget_status_idx`(`status`),
  INDEX `Budget_paymentStatus_idx`(`paymentStatus`),
  INDEX `Budget_eventDate_idx`(`eventDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Budget` ADD CONSTRAINT `Budget_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
