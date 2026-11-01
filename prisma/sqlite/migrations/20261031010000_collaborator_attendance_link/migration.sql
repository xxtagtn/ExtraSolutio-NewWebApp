CREATE TABLE "CollaboratorAttendanceLink" (
  "collaboratorId" INTEGER NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CollaboratorAttendanceLink_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CollaboratorAttendanceLink_token_key" ON "CollaboratorAttendanceLink"("token");
