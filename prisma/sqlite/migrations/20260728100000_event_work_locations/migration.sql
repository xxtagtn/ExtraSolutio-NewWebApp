ALTER TABLE "Event" ADD COLUMN "workLocationsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EventWorkLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventWorkLocation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "EventAssignment" ADD COLUMN "workLocationId" INTEGER REFERENCES "EventWorkLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "EventWorkLocation_eventId_name_key" ON "EventWorkLocation"("eventId", "name");
CREATE INDEX "EventWorkLocation_eventId_sortOrder_idx" ON "EventWorkLocation"("eventId", "sortOrder");
CREATE INDEX "EventAssignment_workLocationId_idx" ON "EventAssignment"("workLocationId");
