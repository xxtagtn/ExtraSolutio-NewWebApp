ALTER TABLE "User" ADD COLUMN "accessProfileId" INTEGER;
ALTER TABLE "User" ADD COLUMN "permissionOverrides" TEXT;

CREATE TABLE "AccessProfile" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "permissions" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PermissionAuditLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "actorId" INTEGER,
  "targetUserId" INTEGER,
  "accessProfileId" INTEGER,
  "action" TEXT NOT NULL,
  "changes" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PermissionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PermissionAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PermissionAuditLog_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AccessProfile_key_key" ON "AccessProfile"("key");
CREATE INDEX "AccessProfile_isSystem_idx" ON "AccessProfile"("isSystem");
CREATE INDEX "User_accessProfileId_idx" ON "User"("accessProfileId");
CREATE INDEX "PermissionAuditLog_actorId_idx" ON "PermissionAuditLog"("actorId");
CREATE INDEX "PermissionAuditLog_targetUserId_idx" ON "PermissionAuditLog"("targetUserId");
CREATE INDEX "PermissionAuditLog_accessProfileId_idx" ON "PermissionAuditLog"("accessProfileId");
