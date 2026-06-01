PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Budget" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "reference" TEXT NOT NULL,
  "clientId" INTEGER,
  "eventDate" DATETIME,
  "leadName" TEXT,
  "companyName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "nif" TEXT,
  "eventType" TEXT,
  "guestsCount" INTEGER,
  "startTime" TEXT,
  "endTime" TEXT,
  "leadSource" TEXT,
  "serviceType" TEXT,
  "eventLevel" TEXT,
  "regularClient" BOOLEAN,
  "locationScope" TEXT,
  "minimumHours" DECIMAL NOT NULL DEFAULT 0,
  "sentAt" DATETIME,
  "lostReason" TEXT,
  "followUpHistory" TEXT,
  "responseTemplate" TEXT,
  "commercialEmailText" TEXT,
  "commercialWhatsappText" TEXT,
  "commercialPdfText" TEXT,
  "budgetType" TEXT NOT NULL DEFAULT 'company',
  "location" TEXT,
  "description" TEXT,
  "amount" DECIMAL NOT NULL DEFAULT 0,
  "vatRate" DECIMAL NOT NULL DEFAULT 23,
  "travelType" TEXT NOT NULL DEFAULT 'none',
  "travelPeople" INTEGER,
  "km" DECIMAL,
  "kmRate" DECIMAL,
  "durationHours" DECIMAL,
  "split5050" BOOLEAN NOT NULL DEFAULT false,
  "baseAmount" DECIMAL NOT NULL DEFAULT 0,
  "travelAmount" DECIMAL NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL NOT NULL DEFAULT 0,
  "totalWithTax" DECIMAL NOT NULL DEFAULT 0,
  "discountRate" DECIMAL NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL NOT NULL DEFAULT 0,
  "marginAmount" DECIMAL NOT NULL DEFAULT 0,
  "categories" TEXT,
  "paymentPlan" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new_request',
  "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Budget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Budget" (
  "id",
  "reference",
  "clientId",
  "eventDate",
  "budgetType",
  "location",
  "description",
  "amount",
  "vatRate",
  "travelType",
  "travelPeople",
  "km",
  "kmRate",
  "durationHours",
  "split5050",
  "baseAmount",
  "travelAmount",
  "taxAmount",
  "totalWithTax",
  "discountRate",
  "discountAmount",
  "totalAmount",
  "categories",
  "paymentPlan",
  "status",
  "paymentStatus",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "reference",
  "clientId",
  "eventDate",
  "budgetType",
  "location",
  "description",
  "amount",
  "vatRate",
  "travelType",
  "travelPeople",
  "km",
  "kmRate",
  "durationHours",
  "split5050",
  "baseAmount",
  "travelAmount",
  "taxAmount",
  "totalWithTax",
  "discountRate",
  "discountAmount",
  "totalAmount",
  "categories",
  "paymentPlan",
  CASE "status"
    WHEN 'draft' THEN 'new_request'
    WHEN 'rejected' THEN 'lost'
    ELSE "status"
  END,
  "paymentStatus",
  "notes",
  "createdAt",
  "updatedAt"
FROM "Budget";

DROP TABLE "Budget";
ALTER TABLE "new_Budget" RENAME TO "Budget";

CREATE UNIQUE INDEX "Budget_reference_key" ON "Budget"("reference");
CREATE INDEX "Budget_clientId_idx" ON "Budget"("clientId");
CREATE INDEX "Budget_status_idx" ON "Budget"("status");
CREATE INDEX "Budget_paymentStatus_idx" ON "Budget"("paymentStatus");
CREATE INDEX "Budget_eventDate_idx" ON "Budget"("eventDate");
CREATE INDEX "Budget_sentAt_idx" ON "Budget"("sentAt");
CREATE INDEX "Budget_leadSource_idx" ON "Budget"("leadSource");

PRAGMA foreign_keys=ON;
