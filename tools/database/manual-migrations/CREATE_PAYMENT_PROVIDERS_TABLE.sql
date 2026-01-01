-- Create paymentProviders table for iZettle integration
CREATE TABLE IF NOT EXISTS `paymentProviders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL,
  `providerType` ENUM('izettle', 'stripe_terminal', 'vipps', 'nets', 'manual_card', 'cash', 'generic') NOT NULL,
  `providerName` VARCHAR(100) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- OAuth fields (for iZettle, Vipps, etc.)
  `accessToken` TEXT,
  `refreshToken` TEXT,
  `tokenExpiresAt` TIMESTAMP NULL,
  `providerAccountId` VARCHAR(255),
  `providerEmail` VARCHAR(320),
  
  -- Configuration (stored as JSON)
  `config` JSON,
  
  -- Sync metadata
  `lastSyncAt` TIMESTAMP NULL,
  `lastErrorAt` TIMESTAMP NULL,
  `lastErrorMessage` TEXT,
  
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX `tenant_providers_idx` (`tenantId`, `isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
