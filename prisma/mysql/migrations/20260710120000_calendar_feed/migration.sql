ALTER TABLE `User`
  ADD COLUMN `calendarFeedToken` VARCHAR(191) NULL,
  ADD COLUMN `calendarFeedEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `calendarFeedPreferences` LONGTEXT NULL;

CREATE UNIQUE INDEX `User_calendarFeedToken_key` ON `User`(`calendarFeedToken`);
