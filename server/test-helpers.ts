/**
 * Centralized Test Helpers for Stylora
 * 
 * This file provides standard utilities for setting up test environments,
 * creating mock data, and ensuring consistent test patterns across the codebase.
 */

import { getDb } from "./db";
import { tenants, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

/**
 * Standard test tenant configuration
 */
export interface TestTenantConfig {
  name?: string;
  subdomain?: string;
  email?: string;
  emailVerified?: boolean;
  status?: "trial" | "active" | "suspended" | "canceled";
}

/**
 * Standard test user configuration
 */
export interface TestUserConfig {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: "owner" | "admin" | "employee";
  phone?: string;
}

/**
 * Creates a test tenant with all required fields for testing
 * 
 * @param config Optional configuration to override defaults
 * @returns Object containing tenantId and tenant data
 */
export async function createTestTenant(config: TestTenantConfig = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);
  
  const tenantData = {
    id: randomUUID(),
    name: config.name || `Test Salon ${timestamp}`,
    subdomain: config.subdomain || `test-${randomSuffix}`,
    email: config.email || `test-${randomSuffix}@example.com`,
    phone: "+4712345678",
    address: "Test Address 123",
    city: "Oslo",
    postalCode: "0123",
    country: "Norway",
    orgNumber: `${timestamp}`.substring(0, 9),
    emailVerified: config.emailVerified !== false, // Default to true
    emailVerifiedAt: config.emailVerified !== false ? new Date() : null,
    status: config.status || "active",
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    onboardingCompleted: true,
    onboardingCompletedAt: new Date(),
  };

  await db.insert(tenants).values([tenantData]);
  
  // Query the inserted tenant
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantData.id));
  
  return {
    tenantId: tenant!.id,
    tenant: tenant!,
  };
}

/**
 * Creates a test user associated with a tenant
 * 
 * @param tenantId The tenant ID to associate the user with
 * @param config Optional configuration to override defaults
 * @returns Object containing userId and user data
 */
export async function createTestUser(tenantId: string, config: TestUserConfig = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);
  
  const firstName = config.firstName || "Test";
  const lastName = config.lastName || "User";
  
  const userData = {
    tenantId,
    openId: `test-openid-${randomSuffix}`,
    name: `${firstName} ${lastName}`,
    email: config.email || `testuser-${randomSuffix}@example.com`,
    phone: config.phone || "+4798765432",
    role: config.role || "admin",
    isActive: true,
    uiMode: "simple" as const,
    onboardingCompleted: true,
    sidebarOpen: true,
  };

  await db.insert(users).values([userData]);
  
  // Query the inserted user
  const insertedUsers = await db.select().from(users).where(eq(users.openId, userData.openId));
  const user = insertedUsers[0];
  
  return {
    userId: user!.id,
    user: user!,
  };
}

/**
 * Creates a complete test environment with tenant and admin user
 * 
 * @param tenantConfig Optional tenant configuration
 * @param userConfig Optional user configuration
 * @returns Object containing tenantId, userId, tenant, user, and mock context
 */
export async function createTestEnvironment(
  tenantConfig: TestTenantConfig = {},
  userConfig: TestUserConfig = {}
) {
  const { tenantId, tenant } = await createTestTenant(tenantConfig);
  const { userId, user } = await createTestUser(tenantId, userConfig);

  // Create a mock context object that can be used in tRPC procedures
  const mockContext = {
    user: {
      id: user.id,
      tenantId: user.tenantId,
      openId: user.openId,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    req: {} as any,
    res: {} as any,
  };

  return {
    tenantId,
    userId,
    tenant,
    user,
    mockContext,
  };
}

/**
 * Cleans up test data by deleting a tenant and all associated records
 * 
 * @param tenantId The tenant ID to clean up
 */
export async function cleanupTestTenant(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete users first (foreign key constraint)
  await db.delete(users).where(eq(users.tenantId, tenantId));
  
  // Delete tenant
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

/**
 * Generates a unique subdomain for testing
 * 
 * @returns A unique subdomain string
 */
export function generateTestSubdomain(): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${randomSuffix}`;
}

/**
 * Generates a unique email for testing
 * 
 * @returns A unique email string
 */
export function generateTestEmail(): string {
  const randomSuffix = Math.random().toString(36).substring(7);
  return `test-${randomSuffix}@example.com`;
}

/**
 * Hashes a password for testing (matches production bcrypt usage)
 * 
 * @param password Plain text password
 * @returns Hashed password
 */
export async function hashTestPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Creates a test employee with PIN for time clock testing
 * 
 * @param tenantId The tenant ID
 * @param pin Optional PIN (defaults to "1234") - stored as plain text in DB for testing
 * @returns Object containing userId and user data
 */
export async function createTestEmployee(tenantId: string, pin: string = "1234") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Store PIN as plain text for testing (max 6 chars)
  const randomSuffix = Math.random().toString(36).substring(7);
  
  const userData = {
    tenantId,
    openId: `test-employee-${randomSuffix}`,
    name: "Test Employee",
    email: `employee-${randomSuffix}@example.com`,
    phone: "+4798765432",
    role: "employee" as const,
    pin: pin, // Store as plain text for testing
    isActive: true,
    uiMode: "simple" as const,
    onboardingCompleted: true,
    sidebarOpen: true,
  };

  await db.insert(users).values([userData]);
  
  // Query the inserted user
  const insertedUsers = await db.select().from(users).where(eq(users.openId, userData.openId));
  const user = insertedUsers[0];
  
  return {
    userId: user!.id,
    user: user!,
    pin, // Return plain PIN for testing
  };
}

/**
 * Waits for a specified number of milliseconds (useful for async operations)
 * 
 * @param ms Milliseconds to wait
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard test timeout values
 */
export const TEST_TIMEOUTS = {
  SHORT: 5000,    // 5 seconds
  MEDIUM: 10000,  // 10 seconds
  LONG: 30000,    // 30 seconds
};

/**
 * Standard test data patterns
 */
export const TEST_PATTERNS = {
  NORWEGIAN_PHONE: /^\+47\d{8}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  ORG_NUMBER: /^\d{9}$/,
  SUBDOMAIN: /^[a-z0-9-]+$/,
};

/**
 * Standard test service configuration
 */
export interface TestServiceConfig {
  name?: string;
  description?: string;
  price?: string;
  durationMinutes?: number;
  isActive?: boolean;
}

/**
 * Creates a test service associated with a tenant
 * 
 * @param tenantId The tenant ID to associate the service with
 * @param config Optional configuration to override defaults
 * @returns Object containing serviceId and service data
 */
export async function createTestService(tenantId: string, config: TestServiceConfig = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const { services } = await import("../drizzle/schema");
  const randomSuffix = Math.random().toString(36).substring(7);
  
  const serviceData = {
    tenantId,
    name: config.name || `Test Service ${randomSuffix}`,
    description: config.description || "Test service description",
    price: config.price || "300.00",
    durationMinutes: config.durationMinutes || 30,
    isActive: config.isActive !== false, // Default to true
  };

  const [result] = await db.insert(services).values([serviceData]);
  
  // Query the inserted service
  const insertedServices = await db.select().from(services).where(eq(services.id, Number(result.insertId)));
  const service = insertedServices[0];
  
  return {
    serviceId: service!.id,
    service: service!,
  };
}

/**
 * Standard test customer configuration
 */
export interface TestCustomerConfig {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}

/**
 * Creates a test customer associated with a tenant
 * 
 * @param tenantId The tenant ID to associate the customer with
 * @param config Optional configuration to override defaults
 * @returns Object containing customerId and customer data
 */
export async function createTestCustomer(tenantId: string, config: TestCustomerConfig = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const { customers } = await import("../drizzle/schema");
  const randomSuffix = Math.random().toString(36).substring(7);
  
  const customerData = {
    tenantId,
    firstName: config.firstName || "Test",
    lastName: config.lastName || "Customer",
    phone: config.phone || `+4798${randomSuffix.substring(0, 6)}`,
    email: config.email || `customer-${randomSuffix}@example.com`,
  };

  const [result] = await db.insert(customers).values([customerData]);
  
  // Query the inserted customer
  const insertedCustomers = await db.select().from(customers).where(eq(customers.id, Number(result.insertId)));
  const customer = insertedCustomers[0];
  
  return {
    customerId: customer!.id,
    customer: customer!,
  };
}
