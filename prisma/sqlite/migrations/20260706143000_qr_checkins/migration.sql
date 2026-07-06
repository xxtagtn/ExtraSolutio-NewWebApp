-- CreateTable
CREATE TABLE "QrCheckCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "collaboratorId" INTEGER NOT NULL,
    "eventDate" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QrCheckCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QrCheckCode_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "EventAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QrCheckCode_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QrCheckLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qrCodeId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "collaboratorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QrCheckLog_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCheckCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QrCheckLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QrCheckLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "EventAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QrCheckLog_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QrCheckCode_token_key" ON "QrCheckCode"("token");

-- CreateIndex
CREATE UNIQUE INDEX "QrCheckCode_assignmentId_key" ON "QrCheckCode"("assignmentId");

-- CreateIndex
CREATE INDEX "QrCheckCode_eventId_idx" ON "QrCheckCode"("eventId");

-- CreateIndex
CREATE INDEX "QrCheckCode_assignmentId_idx" ON "QrCheckCode"("assignmentId");

-- CreateIndex
CREATE INDEX "QrCheckCode_collaboratorId_idx" ON "QrCheckCode"("collaboratorId");

-- CreateIndex
CREATE INDEX "QrCheckCode_eventDate_idx" ON "QrCheckCode"("eventDate");

-- CreateIndex
CREATE INDEX "QrCheckCode_expiresAt_idx" ON "QrCheckCode"("expiresAt");

-- CreateIndex
CREATE INDEX "QrCheckLog_qrCodeId_idx" ON "QrCheckLog"("qrCodeId");

-- CreateIndex
CREATE INDEX "QrCheckLog_eventId_idx" ON "QrCheckLog"("eventId");

-- CreateIndex
CREATE INDEX "QrCheckLog_assignmentId_idx" ON "QrCheckLog"("assignmentId");

-- CreateIndex
CREATE INDEX "QrCheckLog_collaboratorId_idx" ON "QrCheckLog"("collaboratorId");

-- CreateIndex
CREATE INDEX "QrCheckLog_action_idx" ON "QrCheckLog"("action");

-- CreateIndex
CREATE INDEX "QrCheckLog_recordedAt_idx" ON "QrCheckLog"("recordedAt");
