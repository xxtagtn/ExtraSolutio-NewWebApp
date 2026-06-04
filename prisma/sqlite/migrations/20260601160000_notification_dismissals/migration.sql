CREATE TABLE "NotificationDismissal" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationDismissal_userId_key_key" ON "NotificationDismissal"("userId", "key");
CREATE INDEX "NotificationDismissal_userId_idx" ON "NotificationDismissal"("userId");
