CREATE TABLE "ImportMapping" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "source" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT 'global',
  "field" TEXT NOT NULL,
  "externalValue" TEXT NOT NULL,
  "internalValue" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ImportMapping_source_scopeKey_field_externalValue_key"
ON "ImportMapping"("source", "scopeKey", "field", "externalValue");

CREATE INDEX "ImportMapping_source_field_idx"
ON "ImportMapping"("source", "field");
