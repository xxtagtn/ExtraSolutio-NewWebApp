CREATE TABLE "User" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Collaborator" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "nif" TEXT,
  "iban" TEXT,
  "address" TEXT,
  "category" TEXT NOT NULL,
  "hourlyRate" DECIMAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Client" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "nif" TEXT,
  "address" TEXT,
  "postalCode" TEXT,
  "city" TEXT,
  "contactPerson" TEXT,
  "type" TEXT NOT NULL DEFAULT 'company',
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Event" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "clientId" INTEGER NOT NULL,
  "location" TEXT,
  "date" DATETIME NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "totalCost" DECIMAL NOT NULL DEFAULT 0,
  "totalRevenue" DECIMAL NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EventAssignment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "collaboratorId" INTEGER NOT NULL,
  "role" TEXT,
  "hoursWorked" DECIMAL NOT NULL DEFAULT 0,
  "hourlyRate" DECIMAL NOT NULL DEFAULT 0,
  "totalPay" DECIMAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "EventAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventAssignment_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Invoice" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "number" TEXT NOT NULL,
  "clientId" INTEGER NOT NULL,
  "eventId" INTEGER,
  "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" DATETIME,
  "subtotal" DECIMAL NOT NULL DEFAULT 0,
  "taxRate" DECIMAL NOT NULL DEFAULT 23,
  "taxAmount" DECIMAL NOT NULL DEFAULT 0,
  "total" DECIMAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Invoice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "InvoiceItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "invoiceId" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL NOT NULL DEFAULT 0,
  "total" DECIMAL NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Payment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "collaboratorId" INTEGER NOT NULL,
  "amount" DECIMAL NOT NULL,
  "description" TEXT,
  "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Payment_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Transaction" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "description" TEXT,
  "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referenceId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Collaborator_email_key" ON "Collaborator"("email");
CREATE INDEX "Collaborator_status_idx" ON "Collaborator"("status");
CREATE INDEX "Collaborator_category_idx" ON "Collaborator"("category");
CREATE INDEX "Client_status_idx" ON "Client"("status");
CREATE INDEX "Client_type_idx" ON "Client"("type");
CREATE INDEX "Event_clientId_idx" ON "Event"("clientId");
CREATE INDEX "Event_date_idx" ON "Event"("date");
CREATE INDEX "Event_status_idx" ON "Event"("status");
CREATE UNIQUE INDEX "EventAssignment_eventId_collaboratorId_role_key" ON "EventAssignment"("eventId", "collaboratorId", "role");
CREATE INDEX "EventAssignment_collaboratorId_idx" ON "EventAssignment"("collaboratorId");
CREATE INDEX "EventAssignment_status_idx" ON "EventAssignment"("status");
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX "Invoice_eventId_idx" ON "Invoice"("eventId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "Payment_collaboratorId_idx" ON "Payment"("collaboratorId");
CREATE INDEX "Payment_date_idx" ON "Payment"("date");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");
CREATE INDEX "Transaction_category_idx" ON "Transaction"("category");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
