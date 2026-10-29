CREATE TABLE "UserAppearance" (
  "userId" INTEGER NOT NULL PRIMARY KEY,
  "preference" TEXT NOT NULL DEFAULT 'original',
  "publicScope" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserAppearance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserAppearance_publicScope_key" ON "UserAppearance"("publicScope");
