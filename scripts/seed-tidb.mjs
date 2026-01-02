/**
 * Seed demo data into TiDB database
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  console.log('🚀 Starting TiDB seed...');
  
  const conn = await mysql.createConnection(DATABASE_URL);
  
  try {
    // Create demo tenant
    console.log('📦 Creating demo tenant...');
    const tenantId = 'demo-tenant-stylora';
    
    // Check if tenant exists
    const [existingTenant] = await conn.query(
      'SELECT id FROM tenants WHERE id = ?',
      [tenantId]
    );
    
    if (existingTenant.length === 0) {
      await conn.query(`
        INSERT INTO tenants (id, name, subdomain, email, phone, status, emailVerified, emailVerifiedAt, onboardingCompleted, onboardingStep)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `, [
        tenantId,
        'Demo Barbershop',
        'demo-barbershop',
        'demo@stylora.no',
        '+47 12 34 56 78',
        'active',
        true,
        true,
        'completed'
      ]);
      console.log('✅ Demo tenant created');
    } else {
      console.log('ℹ️ Demo tenant already exists');
    }
    
    // Create demo user with password
    console.log('👤 Creating demo user...');
    const passwordHash = await bcrypt.hash('demo123', 10);
    const demoOpenId = 'demo-owner-stylora-001';
    
    // Check if user exists
    const [existingUser] = await conn.query(
      'SELECT id FROM users WHERE openId = ?',
      [demoOpenId]
    );
    
    if (existingUser.length === 0) {
      await conn.query(`
        INSERT INTO users (tenantId, openId, email, name, phone, passwordHash, role, loginMethod, isActive, commissionType, commissionRate, uiMode, onboardingCompleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        tenantId,
        demoOpenId,
        'demo@stylora.no',
        'Demo Owner',
        '+47 12 34 56 78',
        passwordHash,
        'owner',
        'email',
        true,
        'percentage',
        '50.00',
        'advanced',
        true
      ]);
      console.log('✅ Demo user created');
    } else {
      // Update password hash
      await conn.query(
        'UPDATE users SET passwordHash = ? WHERE openId = ?',
        [passwordHash, demoOpenId]
      );
      console.log('ℹ️ Demo user password updated');
    }
    
    // Create service categories
    console.log('📂 Creating service categories...');
    const categories = [
      { id: 1, tenantId, name: 'Hårklipp', description: 'Alle typer hårklipp' },
      { id: 2, tenantId, name: 'Skjegg', description: 'Skjeggtrimming og styling' },
      { id: 3, tenantId, name: 'Farge', description: 'Hårfarge og behandlinger' }
    ];
    
    // Check if serviceCategories table exists
    const [scTables] = await conn.query("SHOW TABLES LIKE 'serviceCategories'");
    if (scTables.length === 0) {
      await conn.query(`
        CREATE TABLE serviceCategories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId VARCHAR(36) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    
    for (const cat of categories) {
      const [existing] = await conn.query(
        'SELECT id FROM serviceCategories WHERE tenantId = ? AND name = ?',
        [cat.tenantId, cat.name]
      );
      if (existing.length === 0) {
        await conn.query(
          'INSERT INTO serviceCategories (tenantId, name, description) VALUES (?, ?, ?)',
          [cat.tenantId, cat.name, cat.description]
        );
      }
    }
    console.log('✅ Service categories created');
    
    // Create services
    console.log('✂️ Creating services...');
    
    // Check if services table exists
    const [sTables] = await conn.query("SHOW TABLES LIKE 'services'");
    if (sTables.length === 0) {
      await conn.query(`
        CREATE TABLE services (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId VARCHAR(36) NOT NULL,
          categoryId INT,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          duration INT NOT NULL DEFAULT 30,
          price DECIMAL(10,2) NOT NULL,
          isActive BOOLEAN DEFAULT true,
          displayOrder INT DEFAULT 0,
          color VARCHAR(20),
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    }
    
    const services = [
      { tenantId, categoryId: 1, name: 'Herreklipp', description: 'Standard herreklipp', duration: 30, price: 350 },
      { tenantId, categoryId: 1, name: 'Fade', description: 'Moderne fade klipp', duration: 45, price: 450 },
      { tenantId, categoryId: 2, name: 'Skjeggtrim', description: 'Trimming og forming av skjegg', duration: 20, price: 200 },
      { tenantId, categoryId: 2, name: 'Skjegg og klipp', description: 'Komplett pakke', duration: 60, price: 550 },
      { tenantId, categoryId: 3, name: 'Hårfarge', description: 'Full farge behandling', duration: 90, price: 800 }
    ];
    
    for (const svc of services) {
      const [existing] = await conn.query(
        'SELECT id FROM services WHERE tenantId = ? AND name = ?',
        [svc.tenantId, svc.name]
      );
      if (existing.length === 0) {
        await conn.query(
          'INSERT INTO services (tenantId, categoryId, name, description, duration, price) VALUES (?, ?, ?, ?, ?, ?)',
          [svc.tenantId, svc.categoryId, svc.name, svc.description, svc.duration, svc.price]
        );
      }
    }
    console.log('✅ Services created');
    
    // Create customers
    console.log('👥 Creating customers...');
    
    // Check if customers table exists
    const [cTables] = await conn.query("SHOW TABLES LIKE 'customers'");
    if (cTables.length === 0) {
      await conn.query(`
        CREATE TABLE customers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId VARCHAR(36) NOT NULL,
          firstName VARCHAR(100) NOT NULL,
          lastName VARCHAR(100),
          phone VARCHAR(20),
          email VARCHAR(320),
          dateOfBirth DATE,
          address TEXT,
          notes TEXT,
          marketingSmsConsent BOOLEAN DEFAULT false,
          marketingEmailConsent BOOLEAN DEFAULT false,
          consentTimestamp TIMESTAMP,
          consentIp VARCHAR(45),
          preferredEmployeeId INT,
          totalVisits INT DEFAULT 0,
          totalRevenue DECIMAL(10,2) DEFAULT 0,
          lastVisitDate DATE,
          noShowCount INT DEFAULT 0,
          deletedAt TIMESTAMP,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    }
    
    const customers = [
      { tenantId, firstName: 'Erik', lastName: 'Hansen', phone: '+47 91 23 45 67', email: 'erik@example.no' },
      { tenantId, firstName: 'Ole', lastName: 'Nordmann', phone: '+47 92 34 56 78', email: 'ole@example.no' },
      { tenantId, firstName: 'Knut', lastName: 'Berg', phone: '+47 93 45 67 89', email: 'knut@example.no' },
      { tenantId, firstName: 'Per', lastName: 'Olsen', phone: '+47 94 56 78 90', email: 'per@example.no' },
      { tenantId, firstName: 'Jonas', lastName: 'Lie', phone: '+47 95 67 89 01', email: 'jonas@example.no' }
    ];
    
    for (const cust of customers) {
      const [existing] = await conn.query(
        'SELECT id FROM customers WHERE tenantId = ? AND email = ?',
        [cust.tenantId, cust.email]
      );
      if (existing.length === 0) {
        await conn.query(
          'INSERT INTO customers (tenantId, firstName, lastName, phone, email) VALUES (?, ?, ?, ?, ?)',
          [cust.tenantId, cust.firstName, cust.lastName, cust.phone, cust.email]
        );
      }
    }
    console.log('✅ Customers created');
    
    console.log('\n🎉 TiDB seed completed successfully!');
    console.log('\n📝 Demo credentials:');
    console.log('   Email: demo@stylora.no');
    console.log('   Password: demo123');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
