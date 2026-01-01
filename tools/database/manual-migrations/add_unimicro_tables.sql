-- Unimicro Integration Tables

CREATE TABLE IF NOT EXISTS `unimicroSettings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL UNIQUE,
  `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `clientId` TEXT,
  `clientSecret` TEXT,
  `certificatePath` TEXT,
  `companyId` INT,
  `accessToken` TEXT,
  `refreshToken` TEXT,
  `tokenExpiresAt` TIMESTAMP NULL,
  `syncFrequency` ENUM('daily', 'weekly', 'monthly', 'manual', 'custom') NOT NULL DEFAULT 'daily',
  `syncDayOfWeek` INT,
  `syncDayOfMonth` INT,
  `syncHour` INT NOT NULL DEFAULT 23,
  `syncMinute` INT NOT NULL DEFAULT 0,
  `lastSyncAt` TIMESTAMP NULL,
  `nextSyncAt` TIMESTAMP NULL,
  `lastSyncStatus` ENUM('success', 'failed', 'partial'),
  `lastSyncErrors` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `unimicro_settings_tenant_idx` (`tenantId`)
);

CREATE TABLE IF NOT EXISTS `unimicroInvoiceMapping` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL,
  `orderId` INT NOT NULL,
  `unimicroInvoiceId` INT NOT NULL,
  `unimicroInvoiceNumber` VARCHAR(50) NOT NULL,
  `status` ENUM('pending', 'synced', 'failed', 'paid') NOT NULL DEFAULT 'pending',
  `errorMessage` TEXT,
  `syncedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `unimicro_invoice_tenant_order_idx` (`tenantId`, `orderId`),
  INDEX `unimicro_invoice_id_idx` (`unimicroInvoiceId`),
  INDEX `unimicro_invoice_status_idx` (`status`)
);

CREATE TABLE IF NOT EXISTS `unimicroCustomerMapping` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL,
  `customerId` INT NOT NULL,
  `unimicroCustomerId` INT NOT NULL,
  `status` ENUM('synced', 'failed') NOT NULL DEFAULT 'synced',
  `errorMessage` TEXT,
  `syncedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `unimicro_customer_tenant_customer_idx` (`tenantId`, `customerId`),
  INDEX `unimicro_customer_id_idx` (`unimicroCustomerId`)
);

CREATE TABLE IF NOT EXISTS `unimicroSyncLog` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL,
  `operation` ENUM('invoice_sync', 'customer_sync', 'payment_sync', 'full_sync', 'test_connection') NOT NULL,
  `status` ENUM('success', 'failed', 'partial') NOT NULL,
  `itemsProcessed` INT DEFAULT 0,
  `itemsFailed` INT DEFAULT 0,
  `errorMessage` TEXT,
  `details` JSON,
  `duration` INT,
  `triggeredBy` ENUM('scheduled', 'manual', 'api') NOT NULL DEFAULT 'scheduled',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `unimicro_log_tenant_operation_idx` (`tenantId`, `operation`, `createdAt`),
  INDEX `unimicro_log_status_idx` (`status`),
  INDEX `unimicro_log_created_idx` (`createdAt`)
);
