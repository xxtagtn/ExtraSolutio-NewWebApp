CREATE TABLE `UserServiceOrder` (
  `userId` INTEGER NOT NULL,
  `scope` VARCHAR(10) NOT NULL,
  `mode` VARCHAR(10) NOT NULL DEFAULT 'date',
  `orderedIds` LONGTEXT NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`, `scope`),
  CONSTRAINT `UserServiceOrder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
