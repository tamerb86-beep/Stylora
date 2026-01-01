import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

console.log('Creating Fiken integration tables...');

try {
  // Create fikenSettings table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fikenSettings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(36) NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      clientId VARCHAR(255),
      clientSecret VARCHAR(255),
      accessToken TEXT,
      refreshToken TEXT,
      tokenExpiresAt TIMESTAMP NULL,
      companySlug VARCHAR(100),
      companyName VARCHAR(255),
      organizationNumber VARCHAR(20),
      syncFrequency ENUM('manual', 'daily', 'weekly', 'monthly') NOT NULL DEFAULT 'manual',
      autoSyncCustomers BOOLEAN NOT NULL DEFAULT TRUE,
      autoSyncInvoices BOOLEAN NOT NULL DEFAULT TRUE,
      autoSyncPayments BOOLEAN NOT NULL DEFAULT TRUE,
      autoSyncProducts BOOLEAN NOT NULL DEFAULT FALSE,
      lastSyncAt TIMESTAMP NULL,
      lastSyncStatus ENUM('success', 'failed', 'partial'),
      lastSyncError TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX fiken_settings_tenant_idx (tenantId)
    )
  `);
  console.log('✓ fikenSettings table created');

  // Create fikenCustomerMapping table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fikenCustomerMapping (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(36) NOT NULL,
      customerId INT NOT NULL,
      fikenContactId INT NOT NULL,
      fikenContactPersonId INT,
      status ENUM('synced', 'failed', 'pending') NOT NULL DEFAULT 'synced',
      errorMessage TEXT,
      syncedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX fiken_customer_tenant_customer_idx (tenantId, customerId),
      INDEX fiken_contact_id_idx (fikenContactId),
      INDEX fiken_customer_status_idx (status)
    )
  `);
  console.log('✓ fikenCustomerMapping table created');

  // Create fikenInvoiceMapping table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fikenInvoiceMapping (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(36) NOT NULL,
      orderId INT NOT NULL,
      fikenInvoiceId INT NOT NULL,
      fikenInvoiceNumber VARCHAR(50),
      fikenDraftId INT,
      status ENUM('draft', 'sent', 'paid', 'failed') NOT NULL DEFAULT 'draft',
      errorMessage TEXT,
      syncedAt TIMESTAMP NULL,
      sentAt TIMESTAMP NULL,
      paidAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX fiken_invoice_tenant_order_idx (tenantId, orderId),
      INDEX fiken_invoice_id_idx (fikenInvoiceId),
      INDEX fiken_invoice_status_idx (status)
    )
  `);
  console.log('✓ fikenInvoiceMapping table created');

  // Create fikenProductMapping table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fikenProductMapping (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(36) NOT NULL,
      productId INT,
      serviceId INT,
      fikenProductId INT NOT NULL,
      status ENUM('synced', 'failed', 'pending') NOT NULL DEFAULT 'synced',
      errorMessage TEXT,
      syncedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX fiken_product_tenant_product_idx (tenantId, productId),
      INDEX fiken_product_tenant_service_idx (tenantId, serviceId),
      INDEX fiken_product_id_idx (fikenProductId)
    )
  `);
  console.log('✓ fikenProductMapping table created');

  // Create fikenSyncLog table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS fikenSyncLog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(36) NOT NULL,
      operation ENUM('customer_sync', 'invoice_sync', 'payment_sync', 'product_sync', 'full_sync', 'test_connection', 'oauth_refresh') NOT NULL,
      status ENUM('success', 'failed', 'partial') NOT NULL,
      itemsProcessed INT DEFAULT 0,
      itemsFailed INT DEFAULT 0,
      errorMessage TEXT,
      details JSON,
      duration INT,
      triggeredBy ENUM('scheduled', 'manual', 'api', 'auto') NOT NULL DEFAULT 'manual',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX fiken_log_tenant_operation_idx (tenantId, operation, createdAt),
      INDEX fiken_log_status_idx (status),
      INDEX fiken_log_created_idx (createdAt)
    )
  `);
  console.log('✓ fikenSyncLog table created');

  console.log('\n✅ All Fiken tables created successfully!');
} catch (error) {
  console.error('❌ Error creating tables:', error.message);
  process.exit(1);
} finally {
  await connection.end();
}
