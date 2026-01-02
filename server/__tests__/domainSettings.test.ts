import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../routers";
import { getDb } from "../db";
import type { Context } from "../_core/context";

describe("Domain Settings", () => {
  let testTenantId: string;
  let testUserId: string;
  let testSubdomain: string;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const { tenants, users } = await import("../../drizzle/schema");
    const { nanoid } = await import("nanoid");
    const { randomUUID } = await import("crypto");

    // Create test tenant with unique subdomain
    testTenantId = randomUUID();
    testSubdomain = `test-domain-${Date.now()}`;
    await db
      .insert(tenants)
      .values({
        id: testTenantId,
        name: "Test Domain Salon",
        subdomain: testSubdomain,
        email: `domain-test-${Date.now()}@example.com`,
        phone: "12345678",
        orgNumber: "123456789",
      });

    // Create test admin user
    testUserId = `test-domain-admin-${nanoid()}`;
    await db
      .insert(users)
      .values({
        openId: testUserId,
        name: "Domain Test Admin",
        email: `domain-admin-${Date.now()}@example.com`,
        tenantId: testTenantId,
        role: "admin",
      });
  });

  describe("getDomainInfo", () => {
    it("should return domain info for tenant", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      const result = await caller.salonSettings.getDomainInfo();

      expect(result).toBeDefined();
      expect(result.subdomain).toBe(testSubdomain);
      expect(result.bookingUrl).toBe(`https://${testSubdomain}.stylora.no/book`);
      expect(result.lastUpdated).toBeDefined();
    });

    it("should throw error if user has no tenant", async () => {
      const ctx: Context = {
        user: {
          openId: "no-tenant-user",
          name: "No Tenant User",
          email: "notenantuser@example.com",
          tenantId: null,
          role: "customer",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(caller.salonSettings.getDomainInfo()).rejects.toThrow("No tenant access");
    });
  });

  describe("checkSubdomainAvailability", () => {
    it("should return available=true for unused subdomain", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      const unusedSubdomain = `unused-${Date.now()}`;
      const result = await caller.salonSettings.checkSubdomainAvailability({ 
        subdomain: unusedSubdomain 
      });

      expect(result.available).toBe(true);
    });

    it("should return available=false for taken subdomain", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { tenants } = await import("../../drizzle/schema");

      // Create another tenant with a specific subdomain
      const { randomUUID } = await import("crypto");
      const takenSubdomain = `taken-${Date.now()}`;
      await db.insert(tenants).values({
        id: randomUUID(),
        name: "Another Salon",
        subdomain: takenSubdomain,
        email: `taken-${Date.now()}@example.com`,
        phone: "87654321",
        orgNumber: "987654321",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      const result = await caller.salonSettings.checkSubdomainAvailability({ 
        subdomain: takenSubdomain 
      });

      expect(result.available).toBe(false);
    });

    it("should return available=true for own subdomain", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      const result = await caller.salonSettings.checkSubdomainAvailability({ 
        subdomain: testSubdomain 
      });

      // Should be available because it's the current tenant's own subdomain
      expect(result.available).toBe(true);
    });
  });

  describe("updateSubdomain", () => {
    it("should update subdomain successfully", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      const newSubdomain = `updated-${Date.now()}`;
      
      const result = await caller.salonSettings.updateSubdomain({ 
        subdomain: newSubdomain 
      });

      expect(result.success).toBe(true);
      expect(result.subdomain).toBe(newSubdomain);
      expect(result.bookingUrl).toBe(`https://${newSubdomain}.stylora.no/book`);

      // Verify it was actually updated
      const domainInfo = await caller.salonSettings.getDomainInfo();
      expect(domainInfo.subdomain).toBe(newSubdomain);
    });

    it("should reject subdomain that is too short", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: "ab" })
      ).rejects.toThrow();
    });

    it("should reject subdomain with invalid characters", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: "Invalid_Domain!" })
      ).rejects.toThrow();
    });

    it("should reject subdomain starting with hyphen", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: "-invalid" })
      ).rejects.toThrow();
    });

    it("should reject subdomain ending with hyphen", async () => {
      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: "invalid-" })
      ).rejects.toThrow();
    });

    it("should reject subdomain already taken by another tenant", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { tenants } = await import("../../drizzle/schema");

      // Create another tenant
      const { randomUUID } = await import("crypto");
      const existingSubdomain = `existing-${Date.now()}`;
      await db.insert(tenants).values({
        id: randomUUID(),
        name: "Existing Salon",
        subdomain: existingSubdomain,
        email: `existing-${Date.now()}@example.com`,
        phone: "11111111",
        orgNumber: "111111111",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

      const ctx: Context = {
        user: {
          openId: testUserId,
          name: "Domain Test Admin",
          email: "test@example.com",
          tenantId: testTenantId,
          role: "admin",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: existingSubdomain })
      ).rejects.toThrow("Subdomain is already taken");
    });

    it("should reject if user is not admin", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { users } = await import("../../drizzle/schema");
      const { nanoid } = await import("nanoid");

      // Create employee user
      const employeeOpenId = `test-employee-${nanoid()}`;
      await db.insert(users).values({
        openId: employeeOpenId,
        name: "Test Employee",
        email: `employee-${Date.now()}@example.com`,
        tenantId: testTenantId,
        role: "employee",
      });

      const { eq } = await import("drizzle-orm");
      const [employee] = await db
        .select()
        .from(users)
        .where(eq(users.openId, employeeOpenId))
        .limit(1);

      const ctx: Context = {
        user: {
          openId: employee.openId,
          name: "Test Employee",
          email: employee.email,
          tenantId: testTenantId,
          role: "employee",
        },
        req: {} as any,
        res: {} as any,
      };

      const caller = appRouter.createCaller(ctx);
      
      await expect(
        caller.salonSettings.updateSubdomain({ subdomain: `new-${Date.now()}` })
      ).rejects.toThrow("Admin access required");
    });
  });
});
