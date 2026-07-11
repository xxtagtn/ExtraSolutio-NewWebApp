-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Collaborator" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "nif" TEXT,
    "iban" TEXT,
    "shortName" TEXT,
    "birthDate" DATETIME,
    "gender" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentExpiry" DATETIME,
    "documentExtended" BOOLEAN NOT NULL DEFAULT false,
    "residenceArea" TEXT,
    "insurancePolicy" TEXT,
    "allergies" TEXT,
    "greenReceipt" TEXT,
    "availability" TEXT,
    "photo" TEXT,
    "photoThumb" TEXT,
    "address" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "hourlyRate" DECIMAL NOT NULL DEFAULT 0,
    "includeVat" BOOLEAN NOT NULL DEFAULT false,
    "hasOwnCar" BOOLEAN NOT NULL DEFAULT false,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Collaborator" ("address", "allergies", "availability", "birthDate", "category", "createdAt", "documentExpiry", "documentExtended", "documentNumber", "documentType", "email", "gender", "greenReceipt", "hasOwnCar", "hourlyRate", "iban", "id", "includeVat", "insurancePolicy", "isPreferred", "name", "nif", "notes", "phone", "photo", "photoThumb", "residenceArea", "shortName", "status", "updatedAt") SELECT "address", "allergies", "availability", "birthDate", "category", "createdAt", "documentExpiry", "documentExtended", "documentNumber", "documentType", "email", "gender", "greenReceipt", "hasOwnCar", "hourlyRate", "iban", "id", "includeVat", "insurancePolicy", "isPreferred", "name", "nif", "notes", "phone", "photo", "photoThumb", "residenceArea", "shortName", "status", "updatedAt" FROM "Collaborator";
DROP TABLE "Collaborator";
ALTER TABLE "new_Collaborator" RENAME TO "Collaborator";
CREATE UNIQUE INDEX "Collaborator_email_key" ON "Collaborator"("email");
CREATE INDEX "Collaborator_status_idx" ON "Collaborator"("status");
CREATE INDEX "Collaborator_category_idx" ON "Collaborator"("category");
CREATE TABLE "new_Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "eventType" TEXT,
    "description" TEXT,
    "clientId" INTEGER,
    "clientName" TEXT,
    "location" TEXT,
    "useDefaultLocation" BOOLEAN NOT NULL DEFAULT true,
    "date" DATETIME NOT NULL,
    "endDate" DATETIME,
    "isContinuous" BOOLEAN NOT NULL DEFAULT false,
    "startTime" TEXT,
    "endTime" TEXT,
    "actualStartTime" TEXT,
    "actualEndTime" TEXT,
    "realHours" DECIMAL NOT NULL DEFAULT 0,
    "billableHours" DECIMAL NOT NULL DEFAULT 0,
    "minimumHoursSnapshot" DECIMAL NOT NULL DEFAULT 0,
    "guestsCount" INTEGER,
    "requiredRoles" TEXT,
    "externalCosts" TEXT,
    "uniform" TEXT,
    "meetingPoint" TEXT,
    "onsiteContactName" TEXT,
    "onsiteContactPhone" TEXT,
    "travelExpenseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "travelExpenseAmount" DECIMAL NOT NULL DEFAULT 0,
    "travelType" TEXT NOT NULL DEFAULT 'none',
    "travelPeople" INTEGER,
    "km" DECIMAL,
    "kmRate" DECIMAL,
    "durationHours" DECIMAL,
    "travelStaffHourlyRate" DECIMAL NOT NULL DEFAULT 0,
    "split5050" BOOLEAN NOT NULL DEFAULT false,
    "travelManualAmount" DECIMAL NOT NULL DEFAULT 0,
    "travelCars" TEXT,
    "assignmentDrafts" TEXT,
    "billingStatus" TEXT NOT NULL DEFAULT 'pending',
    "billingPaymentDate" DATETIME,
    "signaledAmount" DECIMAL NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "remainingPaymentDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalCost" DECIMAL NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("actualEndTime", "actualStartTime", "assignmentDrafts", "billableHours", "billingPaymentDate", "billingStatus", "clientId", "createdAt", "date", "description", "durationHours", "endDate", "endTime", "eventType", "externalCosts", "guestsCount", "id", "isContinuous", "km", "kmRate", "location", "meetingPoint", "minimumHoursSnapshot", "name", "notes", "onsiteContactName", "onsiteContactPhone", "paidAmount", "realHours", "remainingPaymentDate", "requiredRoles", "signaledAmount", "split5050", "startTime", "status", "totalCost", "totalRevenue", "travelCars", "travelExpenseAmount", "travelExpenseEnabled", "travelManualAmount", "travelPeople", "travelStaffHourlyRate", "travelType", "uniform", "updatedAt", "useDefaultLocation") SELECT "actualEndTime", "actualStartTime", "assignmentDrafts", "billableHours", "billingPaymentDate", "billingStatus", "clientId", "createdAt", "date", "description", "durationHours", "endDate", "endTime", "eventType", "externalCosts", "guestsCount", "id", "isContinuous", "km", "kmRate", "location", "meetingPoint", "minimumHoursSnapshot", "name", "notes", "onsiteContactName", "onsiteContactPhone", "paidAmount", "realHours", "remainingPaymentDate", "requiredRoles", "signaledAmount", "split5050", "startTime", "status", "totalCost", "totalRevenue", "travelCars", "travelExpenseAmount", "travelExpenseEnabled", "travelManualAmount", "travelPeople", "travelStaffHourlyRate", "travelType", "uniform", "updatedAt", "useDefaultLocation" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_clientId_idx" ON "Event"("clientId");
CREATE INDEX "Event_date_idx" ON "Event"("date");
CREATE INDEX "Event_status_idx" ON "Event"("status");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photo" TEXT,
    "calendarFeedToken" TEXT,
    "calendarFeedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "calendarFeedPreferences" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "accessProfileId" INTEGER,
    "permissionOverrides" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("accessProfileId", "calendarFeedEnabled", "calendarFeedPreferences", "calendarFeedToken", "createdAt", "email", "id", "name", "password", "permissionOverrides", "photo", "role", "updatedAt") SELECT "accessProfileId", "calendarFeedEnabled", "calendarFeedPreferences", "calendarFeedToken", "createdAt", "email", "id", "name", "password", "permissionOverrides", "photo", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_calendarFeedToken_key" ON "User"("calendarFeedToken");
CREATE INDEX "User_accessProfileId_idx" ON "User"("accessProfileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
