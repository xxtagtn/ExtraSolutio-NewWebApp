CREATE TABLE "UserServiceOrder" (
  "userId" INTEGER NOT NULL,
  "scope" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'date',
  "orderedIds" TEXT NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("userId", "scope"),
  CONSTRAINT "UserServiceOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
