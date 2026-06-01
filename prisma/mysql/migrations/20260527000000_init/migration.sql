CREATE TABLE `User` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(191) NOT NULL,
  `password` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `role` VARCHAR(40) NOT NULL DEFAULT 'admin',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `User_email_key`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Collaborator` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `nif` VARCHAR(30) NULL,
  `iban` VARCHAR(60) NULL,
  `address` TEXT NULL,
  `category` VARCHAR(80) NOT NULL,
  `hourlyRate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Collaborator_email_key`(`email`),
  INDEX `Collaborator_status_idx`(`status`),
  INDEX `Collaborator_category_idx`(`category`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Client` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(40) NULL,
  `nif` VARCHAR(30) NULL,
  `address` TEXT NULL,
  `postalCode` VARCHAR(20) NULL,
  `city` VARCHAR(100) NULL,
  `contactPerson` VARCHAR(191) NULL,
  `type` VARCHAR(40) NOT NULL DEFAULT 'company',
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Client_status_idx`(`status`),
  INDEX `Client_type_idx`(`type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `clientId` INTEGER NOT NULL,
  `location` TEXT NULL,
  `date` DATETIME(3) NOT NULL,
  `startTime` VARCHAR(20) NULL,
  `endTime` VARCHAR(20) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'pending',
  `totalCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `totalRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Event_clientId_idx`(`clientId`),
  INDEX `Event_date_idx`(`date`),
  INDEX `Event_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EventAssignment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `eventId` INTEGER NOT NULL,
  `collaboratorId` INTEGER NOT NULL,
  `role` VARCHAR(80) NULL,
  `hoursWorked` DECIMAL(8, 2) NOT NULL DEFAULT 0,
  `hourlyRate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `totalPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'assigned',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EventAssignment_eventId_collaboratorId_role_key`(`eventId`, `collaboratorId`, `role`),
  INDEX `EventAssignment_collaboratorId_idx`(`collaboratorId`),
  INDEX `EventAssignment_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Invoice` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(60) NOT NULL,
  `clientId` INTEGER NOT NULL,
  `eventId` INTEGER NULL,
  `issueDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `dueDate` DATETIME(3) NULL,
  `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 23,
  `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `total` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'draft',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Invoice_number_key`(`number`),
  INDEX `Invoice_clientId_idx`(`clientId`),
  INDEX `Invoice_eventId_idx`(`eventId`),
  INDEX `Invoice_status_idx`(`status`),
  INDEX `Invoice_issueDate_idx`(`issueDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InvoiceItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `invoiceId` INTEGER NOT NULL,
  `description` TEXT NOT NULL,
  `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 1,
  `unitPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `total` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  INDEX `InvoiceItem_invoiceId_idx`(`invoiceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Payment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `collaboratorId` INTEGER NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `description` TEXT NULL,
  `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` VARCHAR(40) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Payment_collaboratorId_idx`(`collaboratorId`),
  INDEX `Payment_date_idx`(`date`),
  INDEX `Payment_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Transaction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(40) NOT NULL,
  `category` VARCHAR(80) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `description` TEXT NULL,
  `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `referenceId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Transaction_type_idx`(`type`),
  INDEX `Transaction_category_idx`(`category`),
  INDEX `Transaction_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Event` ADD CONSTRAINT `Event_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EventAssignment` ADD CONSTRAINT `EventAssignment_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EventAssignment` ADD CONSTRAINT `EventAssignment_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
