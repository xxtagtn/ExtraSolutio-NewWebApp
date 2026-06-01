CREATE TABLE "Budget" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "reference" TEXT NOT NULL,
  "clientId" INTEGER NOT NULL,
  "eventDate" DATETIME,
  "description" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Budget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Budget_reference_key" ON "Budget"("reference");
CREATE INDEX "Budget_clientId_idx" ON "Budget"("clientId");
CREATE INDEX "Budget_status_idx" ON "Budget"("status");
CREATE INDEX "Budget_paymentStatus_idx" ON "Budget"("paymentStatus");
CREATE INDEX "Budget_eventDate_idx" ON "Budget"("eventDate");
