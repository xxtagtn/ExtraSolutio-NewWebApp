CREATE TABLE `ImportMapping` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `source` VARCHAR(80) NOT NULL,
  `scopeKey` VARCHAR(80) NOT NULL DEFAULT 'global',
  `field` VARCHAR(80) NOT NULL,
  `externalValue` VARCHAR(255) NOT NULL,
  `internalValue` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ImportMapping_source_scope_field_external_key`
ON `ImportMapping`(`source`, `scopeKey`, `field`, `externalValue`);

CREATE INDEX `ImportMapping_source_field_idx`
ON `ImportMapping`(`source`, `field`);
