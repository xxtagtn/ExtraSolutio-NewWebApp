ALTER TABLE "CommunicationLog" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "CommunicationLog_dedupeKey_key" ON "CommunicationLog"("dedupeKey");
