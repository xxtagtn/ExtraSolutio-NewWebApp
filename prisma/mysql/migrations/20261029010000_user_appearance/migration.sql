CREATE TABLE `UserAppearance` (
  `userId` INTEGER NOT NULL,
  `preference` VARCHAR(20) NOT NULL DEFAULT 'original',
  `publicScope` VARCHAR(20) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UserAppearance_publicScope_key` (`publicScope`),
  PRIMARY KEY (`userId`),
  CONSTRAINT `UserAppearance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
