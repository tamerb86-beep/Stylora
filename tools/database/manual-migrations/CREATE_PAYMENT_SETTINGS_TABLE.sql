-- Create paymentSettings table for Railway MySQL database
-- This table stores payment configuration for each tenant

CREATE TABLE IF NOT EXISTS `paymentSettings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL UNIQUE,
  
  -- Enable/disable payment methods
  `vippsEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `cardEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `cashEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `payAtSalonEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Vipps configuration
  `vippsClientId` TEXT,
  `vippsClientSecret` TEXT,
  `vippsSubscriptionKey` TEXT,
  `vippsMerchantSerialNumber` VARCHAR(20),
  `vippsTestMode` BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Stripe configuration
  `stripePublishableKey` TEXT,
  `stripeSecretKey` TEXT,
  `stripeTestMode` BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Default payment method
  `defaultPaymentMethod` ENUM('vipps', 'card', 'cash', 'pay_at_salon') DEFAULT 'pay_at_salon',
  
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX `idx_tenantId` (`tenantId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default settings for platform-admin-tenant
INSERT INTO `paymentSettings` (
  `tenantId`,
  `vippsEnabled`,
  `cardEnabled`,
  `cashEnabled`,
  `payAtSalonEnabled`,
  `defaultPaymentMethod`
) VALUES (
  'platform-admin-tenant',
  FALSE,
  FALSE,
  TRUE,
  TRUE,
  'pay_at_salon'
) ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP;
