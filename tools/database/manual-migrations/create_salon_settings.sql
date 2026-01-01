-- Create salonSettings table
CREATE TABLE IF NOT EXISTS `salonSettings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` VARCHAR(36) NOT NULL UNIQUE,
  `bookingBranding` JSON DEFAULT ('{"logoUrl":null,"primaryColor":"#2563eb","accentColor":"#ea580c","welcomeTitle":"Velkommen!","welcomeSubtitle":"Bestill din time på nett.","showStaffSection":true,"showSummaryCard":true}'),
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `salon_settings_tenant_idx` (`tenantId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
