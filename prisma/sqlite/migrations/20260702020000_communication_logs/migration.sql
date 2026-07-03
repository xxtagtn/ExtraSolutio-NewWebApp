-- CreateTable
CREATE TABLE "CommunicationLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "collaboratorId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'confirmation',
    "channel" TEXT NOT NULL DEFAULT 'manual_whatsapp',
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "message" TEXT,
    "response" TEXT,
    "sentAt" DATETIME,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunicationLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunicationLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "EventAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunicationLog_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CommunicationLog_eventId_idx" ON "CommunicationLog"("eventId");

-- CreateIndex
CREATE INDEX "CommunicationLog_assignmentId_idx" ON "CommunicationLog"("assignmentId");

-- CreateIndex
CREATE INDEX "CommunicationLog_collaboratorId_idx" ON "CommunicationLog"("collaboratorId");

-- CreateIndex
CREATE INDEX "CommunicationLog_status_idx" ON "CommunicationLog"("status");

-- CreateIndex
CREATE INDEX "CommunicationLog_type_idx" ON "CommunicationLog"("type");
