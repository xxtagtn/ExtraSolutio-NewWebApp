CREATE TABLE `PushSubscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `endpointHash` VARCHAR(64) NOT NULL,
    `endpoint` TEXT NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `notifyEntry` BOOLEAN NOT NULL DEFAULT true,
    `notifyExit` BOOLEAN NOT NULL DEFAULT true,
    `sinceLogId` INTEGER NOT NULL DEFAULT 0,
    `lastTestAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `PushSubscription_endpointHash_key`(`endpointHash`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PushDelivery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subscriptionId` INTEGER NOT NULL,
    `logId` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedUntil` DATETIME(3) NULL,
    `leaseId` VARCHAR(36) NULL,
    `sentAt` DATETIME(3) NULL,
    `lastError` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PushDelivery_subscriptionId_logId_key`(`subscriptionId`, `logId`),
    INDEX `PushDelivery_logId_idx`(`logId`),
    INDEX `PushDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PushDelivery_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `PushSubscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `PushDelivery_logId_fkey` FOREIGN KEY (`logId`) REFERENCES `QrCheckLog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
