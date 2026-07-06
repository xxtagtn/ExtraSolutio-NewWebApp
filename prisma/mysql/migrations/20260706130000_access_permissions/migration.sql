ALTER TABLE `User`
  ADD COLUMN `accessProfileId` INTEGER NULL,
  ADD COLUMN `permissionOverrides` LONGTEXT NULL;

CREATE TABLE `AccessProfile` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(80) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) NULL,
  `permissions` LONGTEXT NOT NULL,
  `isSystem` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PermissionAuditLog` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `actorId` INTEGER NULL,
  `targetUserId` INTEGER NULL,
  `accessProfileId` INTEGER NULL,
  `action` VARCHAR(80) NOT NULL,
  `changes` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `AccessProfile_key_key` ON `AccessProfile`(`key`);
CREATE INDEX `AccessProfile_isSystem_idx` ON `AccessProfile`(`isSystem`);
CREATE INDEX `User_accessProfileId_idx` ON `User`(`accessProfileId`);
CREATE INDEX `PermissionAuditLog_actorId_idx` ON `PermissionAuditLog`(`actorId`);
CREATE INDEX `PermissionAuditLog_targetUserId_idx` ON `PermissionAuditLog`(`targetUserId`);
CREATE INDEX `PermissionAuditLog_accessProfileId_idx` ON `PermissionAuditLog`(`accessProfileId`);

ALTER TABLE `User`
  ADD CONSTRAINT `User_accessProfileId_fkey` FOREIGN KEY (`accessProfileId`) REFERENCES `AccessProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PermissionAuditLog`
  ADD CONSTRAINT `PermissionAuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PermissionAuditLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PermissionAuditLog_accessProfileId_fkey` FOREIGN KEY (`accessProfileId`) REFERENCES `AccessProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
