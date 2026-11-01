CREATE TABLE `CollaboratorAttendanceLink` (
  `collaboratorId` INTEGER NOT NULL,
  `token` VARCHAR(43) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`collaboratorId`),
  UNIQUE INDEX `CollaboratorAttendanceLink_token_key` (`token`),
  CONSTRAINT `CollaboratorAttendanceLink_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
