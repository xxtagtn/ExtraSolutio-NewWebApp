CREATE TABLE "CollaboratorRole" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "collaboratorId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaboratorRole_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CollaboratorRole_collaboratorId_role_key" ON "CollaboratorRole"("collaboratorId", "role");
CREATE INDEX "CollaboratorRole_role_idx" ON "CollaboratorRole"("role");

INSERT INTO "CollaboratorRole" ("collaboratorId", "role")
SELECT "id", "category"
FROM "Collaborator"
WHERE "category" IS NOT NULL AND TRIM("category") <> '';
