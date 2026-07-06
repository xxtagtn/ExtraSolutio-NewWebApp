-- CreateTable
CREATE TABLE `QrCheckCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `eventId` INTEGER NOT NULL,
    `assignmentId` INTEGER NOT NULL,
    `collaboratorId` INTEGER NOT NULL,
    `eventDate` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QrCheckCode_token_key`(`token`),
    UNIQUE INDEX `QrCheckCode_assignmentId_key`(`assignmentId`),
    INDEX `QrCheckCode_eventId_idx`(`eventId`),
    INDEX `QrCheckCode_assignmentId_idx`(`assignmentId`),
    INDEX `QrCheckCode_collaboratorId_idx`(`collaboratorId`),
    INDEX `QrCheckCode_eventDate_idx`(`eventDate`),
    INDEX `QrCheckCode_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QrCheckLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qrCodeId` INTEGER NOT NULL,
    `eventId` INTEGER NOT NULL,
    `assignmentId` INTEGER NOT NULL,
    `collaboratorId` INTEGER NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QrCheckLog_qrCodeId_idx`(`qrCodeId`),
    INDEX `QrCheckLog_eventId_idx`(`eventId`),
    INDEX `QrCheckLog_assignmentId_idx`(`assignmentId`),
    INDEX `QrCheckLog_collaboratorId_idx`(`collaboratorId`),
    INDEX `QrCheckLog_action_idx`(`action`),
    INDEX `QrCheckLog_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `QrCheckCode` ADD CONSTRAINT `QrCheckCode_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckCode` ADD CONSTRAINT `QrCheckCode_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `EventAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckCode` ADD CONSTRAINT `QrCheckCode_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckLog` ADD CONSTRAINT `QrCheckLog_qrCodeId_fkey` FOREIGN KEY (`qrCodeId`) REFERENCES `QrCheckCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckLog` ADD CONSTRAINT `QrCheckLog_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckLog` ADD CONSTRAINT `QrCheckLog_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `EventAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QrCheckLog` ADD CONSTRAINT `QrCheckLog_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
