/**
 * Seed K S Frisør to Railway Production Database
 * 
 * Usage:
 *   railway run node seed-ks-frisor.mjs
 * 
 * Or with direct DATABASE_URL:
 *   DATABASE_URL="mysql://..." node seed-ks-frisor.mjs
 */

import mysql from 'mysql2/promise';

const TENANT_ID = 'ks-frisor-tenant';

async function main() {
  console.log('🚀 Starting K S Frisør setup...\n');

  // Get database URL from environment
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ ERROR: DATABASE_URL environment variable is not set!');
    console.error('   Run with: railway run node seed-ks-frisor.mjs');
    process.exit(1);
  }

  let connection;
  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    connection = await mysql.createConnection(databaseUrl);
    console.log('✅ Connected!\n');

    // 1. Create Tenant
    console.log('1️⃣  Creating tenant...');
    await connection.execute(
      `INSERT INTO tenants (id, name, subdomain, address, phone, email, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        TENANT_ID,
        'K S Frisør',
        'ks-frisor',
        'Storgata 122 C, 3915 Porsgrunn',
        '+47 123 45 678',
        'khaled@ksfrisor.no'
      ]
    );
    console.log('   ✅ Tenant created: K S Frisør\n');

    // 2. Create Owner User
    console.log('2️⃣  Creating owner user...');
    await connection.execute(
      `INSERT INTO users (id, tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        'ks-frisor-owner-001',
        TENANT_ID,
        'khaled-openid-ks-frisor',
        'Khaled',
        'khaled@ksfrisor.no',
        '+47 123 45 678',
        'admin',
        1
      ]
    );
    console.log('   ✅ Owner created: khaled@ksfrisor.no\n');

    // 3. Create Employee
    console.log('3️⃣  Creating employee...');
    await connection.execute(
      `INSERT INTO users (id, tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        'ks-frisor-employee-001',
        TENANT_ID,
        'employee-ks-frisor-001',
        'Khaled',
        'khaled.employee@ksfrisor.no',
        '+47 123 45 679',
        'employee',
        1
      ]
    );
    console.log('   ✅ Employee created: Khaled\n');

    // 4. Create Services
    console.log('4️⃣  Creating services...');
    const services = [
      [1001, 'Herreklipp', 'Klassisk herreklipp med vask og styling', 30, 450.00],
      [1002, 'Dameklipp', 'Profesjonell dameklipp med styling', 45, 650.00],
      [1003, 'Skjeggstell', 'Skjeggtrim og styling', 20, 300.00],
      [1004, 'Hårfarge', 'Profesjonell hårfarge med konsultasjon', 90, 1200.00],
      [1005, 'Permanent', 'Permanent med styling', 120, 1500.00]
    ];

    for (const [id, name, description, duration, price] of services) {
      await connection.execute(
        `INSERT INTO services (id, tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, TENANT_ID, name, description, duration, price, 1]
      );
      console.log(`   ✅ Service created: ${name} (${duration} min, ${price} kr)`);
    }
    console.log('');

    // 5. Create Service Categories
    console.log('5️⃣  Creating service categories...');
    await connection.execute(
      `INSERT INTO serviceCategories (id, tenantId, name, displayOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [101, TENANT_ID, 'Klipping', 1]
    );
    await connection.execute(
      `INSERT INTO serviceCategories (id, tenantId, name, displayOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [102, TENANT_ID, 'Farge & Styling', 2]
    );
    console.log('   ✅ Categories created: Klipping, Farge & Styling\n');

    // 6. Link Services to Categories
    console.log('6️⃣  Linking services to categories...');
    await connection.execute(
      `UPDATE services SET categoryId = ? WHERE id IN (?, ?, ?) AND tenantId = ?`,
      [101, 1001, 1002, 1003, TENANT_ID]
    );
    await connection.execute(
      `UPDATE services SET categoryId = ? WHERE id IN (?, ?) AND tenantId = ?`,
      [102, 1004, 1005, TENANT_ID]
    );
    console.log('   ✅ Services linked to categories\n');

    // 7. Create Working Hours (Monday-Friday 09:00-17:00)
    console.log('7️⃣  Creating working hours...');
    const workingDays = [
      [1001, 1, 'Monday'],
      [1002, 2, 'Tuesday'],
      [1003, 3, 'Wednesday'],
      [1004, 4, 'Thursday'],
      [1005, 5, 'Friday']
    ];

    for (const [id, dayOfWeek, dayName] of workingDays) {
      await connection.execute(
        `INSERT INTO employeeShifts (id, employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, 'ks-frisor-employee-001', TENANT_ID, dayOfWeek, '09:00:00', '17:00:00', 1]
      );
      console.log(`   ✅ ${dayName}: 09:00-17:00`);
    }
    console.log('');

    // Verification
    console.log('8️⃣  Verifying setup...');
    const [tenants] = await connection.execute(
      'SELECT * FROM tenants WHERE id = ?',
      [TENANT_ID]
    );
    const [users] = await connection.execute(
      'SELECT id, name, email, role FROM users WHERE tenantId = ?',
      [TENANT_ID]
    );
    const [servicesResult] = await connection.execute(
      'SELECT id, name, price FROM services WHERE tenantId = ?',
      [TENANT_ID]
    );

    console.log(`   ✅ Tenant: ${tenants.length} record(s)`);
    console.log(`   ✅ Users: ${users.length} record(s)`);
    console.log(`   ✅ Services: ${servicesResult.length} record(s)`);
    console.log('');

    // Success message
    console.log('🎉 SUCCESS! K S Frisør has been set up!\n');
    console.log('📋 Access Information:');
    console.log('   Admin Dashboard: https://www.stylora.no');
    console.log('   Login Email: khaled@ksfrisor.no');
    console.log('   Public Booking: https://www.stylora.no/book?tenantId=ks-frisor-tenant');
    console.log('   Or: https://ks-frisor.stylora.no/book (if subdomain configured)\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    // Check for duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      console.error('\n💡 TIP: K S Frisør might already exist in the database.');
      console.error('   Check with: SELECT * FROM tenants WHERE id = "ks-frisor-tenant";');
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('📡 Database connection closed.');
    }
  }
}

main();
