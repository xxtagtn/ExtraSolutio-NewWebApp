-- CreateTable
CREATE TABLE `CommunicationLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `assignmentId` INTEGER NOT NULL,
    `collaboratorId` INTEGER NOT NULL,
    `type` VARCHAR(40) NOT NULL DEFAULT 'confirmation',
    `channel` VARCHAR(40) NOT NULL DEFAULT 'manual_whatsapp',
    `status` VARCHAR(40) NOT NULL DEFAULT 'prepared',
    `message` TEXT NULL,
    `response` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CommunicationLog_eventId_idx`(`eventId`),
    INDEX `CommunicationLog_assignmentId_idx`(`assignmentId`),
    INDEX `CommunicationLog_collaboratorId_idx`(`collaboratorId`),
    INDEX `CommunicationLog_status_idx`(`status`),
    INDEX `CommunicationLog_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CommunicationLog` ADD CONSTRAINT `CommunicationLog_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationLog` ADD CONSTRAINT `CommunicationLog_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `EventAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunicationLog` ADD CONSTRAINT `CommunicationLog_collaboratorId_fkey` FOREIGN KEY (`collaboratorId`) REFERENCES `Collaborator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
