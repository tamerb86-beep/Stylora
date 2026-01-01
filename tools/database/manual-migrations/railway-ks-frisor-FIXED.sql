-- ============================================================================
-- K S Frisør - Railway Production Setup (FIXED)
-- ============================================================================
-- Execute each query separately in Railway MySQL Query tab
-- ============================================================================

-- QUERY 1: Create Tenant
INSERT INTO tenants (id, name, subdomain, address, phone, email, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'K S Frisør', 'ks-frisor', 'Storgata 122 C, 3915 Porsgrunn', '+47 123 45 678', 'khaled@ksfrisor.no', NOW(), NOW());

-- QUERY 2: Create Owner User (for admin dashboard login)
INSERT INTO users (tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'khaled-openid-ks-frisor', 'Khaled', 'khaled@ksfrisor.no', '+47 123 45 678', 'admin', 1, NOW(), NOW());

-- QUERY 3: Create Employee (for bookings)
INSERT INTO users (tenantId, openId, name, email, phone, role, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'employee-ks-frisor-001', 'Khaled', 'khaled.employee@ksfrisor.no', '+47 123 45 679', 'employee', 1, NOW(), NOW());

-- QUERY 4: Create Service 1 - Herreklipp
INSERT INTO services (tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'Herreklipp', 'Klassisk herreklipp med vask og styling', 30, 450.00, 1, NOW(), NOW());

-- QUERY 5: Create Service 2 - Dameklipp
INSERT INTO services (tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'Dameklipp', 'Profesjonell dameklipp med styling', 45, 650.00, 1, NOW(), NOW());

-- QUERY 6: Create Service 3 - Skjeggstell
INSERT INTO services (tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'Skjeggstell', 'Skjeggtrim og styling', 20, 300.00, 1, NOW(), NOW());

-- QUERY 7: Create Service 4 - Hårfarge
INSERT INTO services (tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'Hårfarge', 'Profesjonell hårfarge med konsultasjon', 90, 1200.00, 1, NOW(), NOW());

-- QUERY 8: Create Service 5 - Permanent
INSERT INTO services (tenantId, name, description, durationMinutes, price, isActive, createdAt, updatedAt)
VALUES ('ks-frisor-tenant', 'Permanent', 'Permanent med styling', 120, 1500.00, 1, NOW(), NOW());

-- ============================================================================
-- IMPORTANT: Get Employee ID before adding working hours
-- ============================================================================

-- QUERY 9: Get Employee ID (copy the id from result)
SELECT id, name, email, role FROM users WHERE tenantId = 'ks-frisor-tenant' AND role = 'employee';

-- ============================================================================
-- QUERY 10-14: Add Working Hours (Monday-Friday 09:00-17:00)
-- REPLACE {EMPLOYEE_ID} with the actual ID from QUERY 9 result
-- ============================================================================

-- QUERY 10: Monday
INSERT INTO timesheets (employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES ({EMPLOYEE_ID}, 'ks-frisor-tenant', 1, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- QUERY 11: Tuesday
INSERT INTO timesheets (employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES ({EMPLOYEE_ID}, 'ks-frisor-tenant', 2, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- QUERY 12: Wednesday
INSERT INTO timesheets (employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES ({EMPLOYEE_ID}, 'ks-frisor-tenant', 3, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- QUERY 13: Thursday
INSERT INTO timesheets (employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES ({EMPLOYEE_ID}, 'ks-frisor-tenant', 4, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- QUERY 14: Friday
INSERT INTO timesheets (employeeId, tenantId, dayOfWeek, startTime, endTime, isActive, createdAt, updatedAt)
VALUES ({EMPLOYEE_ID}, 'ks-frisor-tenant', 5, '09:00:00', '17:00:00', 1, NOW(), NOW());

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check tenant
SELECT * FROM tenants WHERE id = 'ks-frisor-tenant';

-- Check users
SELECT id, name, email, role FROM users WHERE tenantId = 'ks-frisor-tenant';

-- Check services
SELECT id, name, durationMinutes, price FROM services WHERE tenantId = 'ks-frisor-tenant';

-- Check working hours
SELECT * FROM timesheets WHERE tenantId = 'ks-frisor-tenant';

-- ============================================================================
-- DONE! Test booking page:
-- https://www.stylora.no/book?tenantId=ks-frisor-tenant
-- ============================================================================
