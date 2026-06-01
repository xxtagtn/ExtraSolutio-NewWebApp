CREATE TABLE `CollaboratorRole` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `collaboratorId` INTEGER NOT NULL,
  `role` VARCHAR(80) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `CollaboratorRole_collaboratorId_role_key`(`collaboratorId`, `role`),
  INDEX `CollaboratorRole_role_idx`(`role`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CollaboratorRole`
ADD CONSTRAINT `CollaboratorRole_collaboratorId_fkey`
FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `CollaboratorRole` (`collaboratorId`, `role`)
SELECT `id`, `category`
FROM `Collaborator`
WHERE `category` IS NOT NULL AND TRIM(`category`) <> '';
