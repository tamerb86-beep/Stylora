#!/usr/bin/env node
/**
 * Seed Demo Account for Stylora
 * Creates a demo tenant with sample data for users to explore
 */

import mysql from 'mysql2/promise';
import { nanoid } from 'nanoid';

// Database connection
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('🚀 Starting demo account seed...\n');

// Demo tenant ID
const DEMO_TENANT_ID = 'demo-tenant-stylora';
const DEMO_USER_EMAIL = 'demo@stylora.no';
const DEMO_OPEN_ID = 'demo-owner-stylora-001';

try {
  // 1. Check/Create Demo Tenant
  console.log('📦 Checking demo tenant...');
  
  const [existingTenant] = await connection.query(
    'SELECT id FROM tenants WHERE id = ? LIMIT 1',
    [DEMO_TENANT_ID]
  );

  if (existingTenant.length > 0) {
    console.log('✅ Demo tenant exists');
  } else {
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await connection.query(`
      INSERT INTO tenants (id, name, subdomain, orgNumber, phone, email, address, timezone, currency, vatRate, status, trialEndsAt, emailVerified, emailVerifiedAt, onboardingCompleted, onboardingStep, onboardingCompletedAt, cancellationWindowHours, noShowThresholdForPrepayment, requirePrepayment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      DEMO_TENANT_ID,
      'Demo Barbershop',
      'demo-stylora',
      '123456789',
      '+47 12 34 56 78',
      DEMO_USER_EMAIL,
      'Karl Johans gate 1, 0154 Oslo, Norge',
      'Europe/Oslo',
      'NOK',
      '25.00',
      'trial',
      trialEndsAt,
      true,
      new Date(),
      true,
      'complete',
      new Date(),
      24,
      2,
      false
    ]);
    console.log('✅ Demo tenant created');
  }

  // 2. Check/Create Demo User (Owner)
  console.log('\n👤 Checking demo user...');
  
  const [existingUser] = await connection.query(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [DEMO_USER_EMAIL]
  );

  let demoUserId;
  if (existingUser.length > 0) {
    console.log('✅ Demo user exists');
    demoUserId = existingUser[0].id;
  } else {
    const [result] = await connection.query(`
      INSERT INTO users (tenantId, openId, email, name, phone, role, loginMethod, isActive, commissionType, commissionRate, uiMode, onboardingCompleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      DEMO_TENANT_ID,
      DEMO_OPEN_ID,
      DEMO_USER_EMAIL,
      'Demo Owner',
      '+47 12 34 56 78',
      'owner',
      'email',
      true,
      'percentage',
      '50.00',
      'advanced',
      true
    ]);
    demoUserId = result.insertId;
    console.log('✅ Demo user created');
  }

  // 3. Create Sample Employees
  console.log('\n👥 Creating sample employees...');
  
  const employees = [
    { name: 'Lars Olsen', phone: '+47 98 76 54 32', email: 'lars@demo.stylora.no', commissionRate: '45.00' },
    { name: 'Kari Hansen', phone: '+47 98 76 54 33', email: 'kari@demo.stylora.no', commissionRate: '40.00' },
  ];

  const employeeIds = [];
  for (const emp of employees) {
    const [existing] = await connection.query('SELECT id FROM users WHERE email = ? LIMIT 1', [emp.email]);
    if (existing.length > 0) {
      employeeIds.push(existing[0].id);
      console.log(`✅ Employee ${emp.name} exists`);
    } else {
      const [result] = await connection.query(`
        INSERT INTO users (tenantId, openId, email, name, phone, role, loginMethod, isActive, commissionType, commissionRate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [DEMO_TENANT_ID, `demo-employee-${nanoid()}`, emp.email, emp.name, emp.phone, 'employee', 'email', true, 'percentage', emp.commissionRate]);
      employeeIds.push(result.insertId);
      console.log(`✅ Employee ${emp.name} created`);
    }
  }

  // 4. Create Service Categories (no description column)
  console.log('\n📂 Creating service categories...');
  
  const categories = [
    { name: 'Hårklipp', displayOrder: 1 },
    { name: 'Skjegg', displayOrder: 2 },
    { name: 'Farge', displayOrder: 3 },
  ];

  const categoryIds = [];
  for (const cat of categories) {
    const [existing] = await connection.query(
      'SELECT id FROM serviceCategories WHERE tenantId = ? AND name = ? LIMIT 1',
      [DEMO_TENANT_ID, cat.name]
    );
    if (existing.length > 0) {
      categoryIds.push(existing[0].id);
      console.log(`✅ Category ${cat.name} exists`);
    } else {
      const [result] = await connection.query(
        'INSERT INTO serviceCategories (tenantId, name, displayOrder) VALUES (?, ?, ?)',
        [DEMO_TENANT_ID, cat.name, cat.displayOrder]
      );
      categoryIds.push(result.insertId);
      console.log(`✅ Category ${cat.name} created`);
    }
  }

  // 5. Create Services (using durationMinutes instead of duration, no color)
  console.log('\n✂️  Creating services...');
  
  const servicesData = [
    { categoryId: categoryIds[0], name: 'Herreklipp', description: 'Klassisk herreklipp med maskin og saks', durationMinutes: 30, price: '350.00' },
    { categoryId: categoryIds[0], name: 'Fade', description: 'Moderne fade med overgang', durationMinutes: 45, price: '450.00' },
    { categoryId: categoryIds[1], name: 'Skjeggtrim', description: 'Trim og styling av skjegg', durationMinutes: 20, price: '200.00' },
    { categoryId: categoryIds[1], name: 'Herreklipp + Skjegg', description: 'Komplett pakke med hårklipp og skjeggtrim', durationMinutes: 50, price: '500.00' },
    { categoryId: categoryIds[2], name: 'Hårfarge', description: 'Full hårfarge', durationMinutes: 90, price: '800.00' },
  ];

  const serviceIds = [];
  for (const svc of servicesData) {
    const [existing] = await connection.query(
      'SELECT id FROM services WHERE tenantId = ? AND name = ? LIMIT 1',
      [DEMO_TENANT_ID, svc.name]
    );
    if (existing.length > 0) {
      serviceIds.push(existing[0].id);
      console.log(`✅ Service ${svc.name} exists`);
    } else {
      const [result] = await connection.query(`
        INSERT INTO services (tenantId, categoryId, name, description, durationMinutes, price, isActive)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [DEMO_TENANT_ID, svc.categoryId, svc.name, svc.description, svc.durationMinutes, svc.price, true]);
      serviceIds.push(result.insertId);
      console.log(`✅ Service ${svc.name} created`);
    }
  }

  // 6. Create Sample Customers
  console.log('\n👨‍💼 Creating sample customers...');
  
  const customersData = [
    { firstName: 'Ole', lastName: 'Nordmann', phone: '+47 91 23 45 67', email: 'ole@example.no' },
    { firstName: 'Kari', lastName: 'Svendsen', phone: '+47 91 23 45 68', email: 'kari.s@example.no' },
    { firstName: 'Per', lastName: 'Hansen', phone: '+47 91 23 45 69', email: 'per@example.no' },
    { firstName: 'Lise', lastName: 'Johansen', phone: '+47 91 23 45 70', email: 'lise@example.no' },
    { firstName: 'Erik', lastName: 'Berg', phone: '+47 91 23 45 71', email: 'erik@example.no' },
  ];

  const customerIds = [];
  for (const cust of customersData) {
    const [existing] = await connection.query(
      'SELECT id FROM customers WHERE tenantId = ? AND email = ? LIMIT 1',
      [DEMO_TENANT_ID, cust.email]
    );
    if (existing.length > 0) {
      customerIds.push(existing[0].id);
      console.log(`✅ Customer ${cust.firstName} ${cust.lastName} exists`);
    } else {
      const [result] = await connection.query(`
        INSERT INTO customers (tenantId, firstName, lastName, phone, email, marketingSmsConsent, marketingEmailConsent, totalVisits, totalRevenue)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        DEMO_TENANT_ID, cust.firstName, cust.lastName, cust.phone, cust.email,
        true, true, Math.floor(Math.random() * 10) + 1, (Math.random() * 5000 + 1000).toFixed(2)
      ]);
      customerIds.push(result.insertId);
      console.log(`✅ Customer ${cust.firstName} ${cust.lastName} created`);
    }
  }

  // 7. Create Sample Appointments
  console.log('\n📅 Creating sample appointments...');
  
  const today = new Date();
  const appointmentsData = [
    { customerId: customerIds[0], employeeId: employeeIds[0], date: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), startTime: '10:00:00', endTime: '10:30:00', status: 'completed' },
    { customerId: customerIds[1], employeeId: employeeIds[1], date: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000), startTime: '14:00:00', endTime: '14:45:00', status: 'completed' },
    { customerId: customerIds[2], employeeId: employeeIds[0], date: today, startTime: '09:00:00', endTime: '09:30:00', status: 'confirmed' },
    { customerId: customerIds[3], employeeId: employeeIds[1], date: today, startTime: '11:00:00', endTime: '11:50:00', status: 'confirmed' },
    { customerId: customerIds[4], employeeId: employeeIds[0], date: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000), startTime: '15:00:00', endTime: '15:30:00', status: 'confirmed' },
    { customerId: customerIds[0], employeeId: employeeIds[1], date: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000), startTime: '10:00:00', endTime: '10:20:00', status: 'pending' },
  ];

  for (const apt of appointmentsData) {
    const dateStr = apt.date.toISOString().split('T')[0];
    const [existing] = await connection.query(
      'SELECT id FROM appointments WHERE tenantId = ? AND customerId = ? AND appointmentDate = ? AND startTime = ? LIMIT 1',
      [DEMO_TENANT_ID, apt.customerId, dateStr, apt.startTime]
    );
    if (existing.length === 0) {
      await connection.query(`
        INSERT INTO appointments (tenantId, customerId, employeeId, appointmentDate, startTime, endTime, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [DEMO_TENANT_ID, apt.customerId, apt.employeeId, dateStr, apt.startTime, apt.endTime, apt.status, 'Demo appointment']);
      console.log(`✅ Appointment for ${dateStr} ${apt.startTime} created`);
    } else {
      console.log(`✅ Appointment for ${dateStr} ${apt.startTime} exists`);
    }
  }

  console.log('\n✨ Demo account seed completed successfully!\n');
  console.log('📧 Demo Login:');
  console.log(`   Email: ${DEMO_USER_EMAIL}`);
  console.log(`   OpenID: ${DEMO_OPEN_ID}`);
  console.log('\n🎉 Users can now explore all features!\n');

} catch (error) {
  console.error('❌ Error seeding demo account:', error);
  process.exit(1);
} finally {
  await connection.end();
}
