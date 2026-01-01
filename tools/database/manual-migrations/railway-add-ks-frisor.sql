-- ============================================================================
-- Add K S Frisør to Railway Production Database
-- ============================================================================
-- Execute this in Railway MySQL Query tab
-- ============================================================================

-- 1. Create Tenant (Salon)
INSERT INTO tenants (id, name, subdomain, address, phone, email, createdAt, updatedAt)
VALUES (
  'ks-frisor-tenant',
  'K S Frisør',
  'ks-frisor',
  'Storgata 122 C, 3915 Porsgrunn',
  '+47 123 45 678',
  'khaled@ksfrisor.no',
  NOW(),
  NOW()
);

-- 2. Create Owner User (for login to admin dashboard)
INSERT INTO users (id, tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
VALUES (
  'ks-frisor-owner-001',
  'ks-frisor-tenant',
  'khaled-openid-ks-frisor',
  'Khaled',
  'khaled@ksfrisor.no',
  '+47 123 45 678',
  'admin',
  1,
  NOW(),
  NOW()
);

-- 3. Create Employee (for bookings)
INSERT INTO users (id, tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
VALUES (
  'ks-frisor-employee-001',
  'ks-frisor-tenant',
  'employee-ks-frisor-001',
  'Khaled',
  'khaled.employee@ksfrisor.no',
  '+47 123 45 679',
  'employee',
  1,
  NOW(),
  NOW()
);

-- 4. Create Services
INSERT INTO services (id, tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES 
  (
    1001,
    'ks-frisor-tenant',
    'Herreklipp',
    'Klassisk herreklipp med vask og styling',
    30,
    450.00,
    1,
    NOW(),
    NOW()
  ),
  (
    1002,
    'ks-frisor-tenant',
    'Dameklipp',
    'Profesjonell dameklipp med styling',
    45,
    650.00,
    1,
    NOW(),
    NOW()
  ),
  (
    1003,
    'ks-frisor-tenant',
    'Skjeggstell',
    'Skjeggtrim og styling',
    20,
    300.00,
    1,
    NOW(),
    NOW()
  ),
  (
    1004,
    'ks-frisor-tenant',
    'Hårfarge',
    'Profesjonell hårfarge med konsultasjon',
    90,
    1200.00,
    1,
    NOW(),
    NOW()
  ),
  (
    1005,
    'ks-frisor-tenant',
    'Permanent',
    'Permanent med styling',
    120,
    1500.00,
    1,
    NOW(),
    NOW()
  );

-- 5. Create Service Categories (optional but recommended)
INSERT INTO serviceCategories (id, tenantId, name, displayOrder, createdAt, updatedAt)
VALUES 
  (
    101,
    'ks-frisor-tenant',
    'Klipping',
    1,
    NOW(),
    NOW()
  ),
  (
    102,
    'ks-frisor-tenant',
    'Farge & Styling',
    2,
    NOW(),
    NOW()
  );

-- 6. Link Services to Categories
UPDATE services SET categoryId = 101 WHERE id IN (1001, 1002, 1003) AND tenantId = 'ks-frisor-tenant';
UPDATE services SET categoryId = 102 WHERE id IN (1004, 1005) AND tenantId = 'ks-frisor-tenant';

-- 7. Create Default Working Hours for Employee (Monday-Friday 09:00-17:00)
INSERT INTO employeeShifts (id, employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES
  (1001, 'ks-frisor-employee-001', 'ks-frisor-tenant', 1, '09:00:00', '17:00:00', 1, NOW(), NOW()),
  (1002, 'ks-frisor-employee-001', 'ks-frisor-tenant', 2, '09:00:00', '17:00:00', 1, NOW(), NOW()),
  (1003, 'ks-frisor-employee-001', 'ks-frisor-tenant', 3, '09:00:00', '17:00:00', 1, NOW(), NOW()),
  (1004, 'ks-frisor-employee-001', 'ks-frisor-tenant', 4, '09:00:00', '17:00:00', 1, NOW(), NOW()),
  (1005, 'ks-frisor-employee-001', 'ks-frisor-tenant', 5, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- ============================================================================
-- Verification Queries (run these to check if data was inserted correctly)
-- ============================================================================

-- Check tenant
SELECT * FROM tenants WHERE id = 'ks-frisor-tenant';

-- Check users
SELECT id, name, email, role FROM users WHERE tenantId = 'ks-frisor-tenant';

-- Check services
SELECT id, name, durationMinutes, price FROM services WHERE tenantId = 'ks-frisor-tenant';

-- Check working hours
SELECT * FROM employeeShifts WHERE tenantId = 'ks-frisor-tenant';

-- ============================================================================
-- Access URLs after setup:
-- ============================================================================
-- Admin Dashboard: https://www.stylora.no (login with khaled@ksfrisor.no)
-- Public Booking: https://www.stylora.no/book?tenantId=ks-frisor-tenant
-- Or (if subdomain configured): https://ks-frisor.stylora.no/book
-- ============================================================================
