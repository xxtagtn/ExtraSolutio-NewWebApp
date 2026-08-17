ALTER TABLE `CommunicationLog` ADD COLUMN `dedupeKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `CommunicationLog_dedupeKey_key` ON `CommunicationLog`(`dedupeKey`);
