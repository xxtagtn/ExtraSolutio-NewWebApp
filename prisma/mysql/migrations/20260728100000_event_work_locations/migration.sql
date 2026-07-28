ALTER TABLE `Event`
    ADD COLUMN `workLocationsEnabled` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `EventWorkLocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EventWorkLocation_eventId_name_key`(`eventId`, `name`),
    INDEX `EventWorkLocation_eventId_sortOrder_idx`(`eventId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EventWorkLocation`
    ADD CONSTRAINT `EventWorkLocation_eventId_fkey`
    FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `EventAssignment`
    ADD COLUMN `workLocationId` INTEGER NULL,
    ADD INDEX `EventAssignment_workLocationId_idx`(`workLocationId`),
    ADD CONSTRAINT `EventAssignment_workLocationId_fkey`
    FOREIGN KEY (`workLocationId`) REFERENCES `EventWorkLocation`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
