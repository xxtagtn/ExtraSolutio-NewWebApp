CREATE TABLE "EventTemplate" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "eventType" TEXT,
  "description" TEXT,
  "payload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "EventTemplate_name_key" ON "EventTemplate"("name");
CREATE INDEX "EventTemplate_eventType_idx" ON "EventTemplate"("eventType");
