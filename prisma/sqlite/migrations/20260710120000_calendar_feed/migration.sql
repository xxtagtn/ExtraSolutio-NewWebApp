ALTER TABLE "User" ADD COLUMN "calendarFeedToken" TEXT;
ALTER TABLE "User" ADD COLUMN "calendarFeedEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "calendarFeedPreferences" TEXT;

CREATE UNIQUE INDEX "User_calendarFeedToken_key" ON "User"("calendarFeedToken");
