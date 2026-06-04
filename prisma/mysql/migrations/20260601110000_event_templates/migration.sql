CREATE TABLE `EventTemplate` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(80) NULL,
  `description` TEXT NULL,
  `payload` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `EventTemplate_name_key`(`name`),
  INDEX `EventTemplate_eventType_idx`(`eventType`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
