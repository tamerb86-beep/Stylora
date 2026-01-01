-- Fix paymentProviders table to support long tokens
ALTER TABLE `paymentProviders`
  MODIFY `accessToken` TEXT NULL,
  MODIFY `refreshToken` TEXT NULL,
  MODIFY `tokenExpiresAt` TIMESTAMP(3) NULL;
