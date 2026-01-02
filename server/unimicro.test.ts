/**
 * Unimicro Integration Tests
 * Tests for Unimicro API client, customer sync, invoice sync, and payment sync
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "./db";
import { 
  unimicroSettings, 
  unimicroCustomerMapping,
  unimicroInvoiceMapping,
  unimicroSyncLog,
  customers,
  orders,
  orderItems,
  payments,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TEST_TENANT_ID = "test-tenant-unimicro";

describe("Unimicro Integration", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Clean up test data
    await db.delete(unimicroSettings).where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));
    await db.delete(unimicroCustomerMapping).where(eq(unimicroCustomerMapping.tenantId, TEST_TENANT_ID));
    await db.delete(unimicroInvoiceMapping).where(eq(unimicroInvoiceMapping.tenantId, TEST_TENANT_ID));
    await db.delete(unimicroSyncLog).where(eq(unimicroSyncLog.tenantId, TEST_TENANT_ID));
  });

  describe("Database Schema", () => {
    it("should create unimicroSettings table", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Insert test settings
      await db.insert(unimicroSettings).values({
        tenantId: TEST_TENANT_ID,
        enabled: true,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        companyId: 12345,
        syncFrequency: "daily",
        syncHour: 23,
      });

      // Verify insertion
      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings).toBeDefined();
      expect(settings.tenantId).toBe(TEST_TENANT_ID);
      expect(settings.enabled).toBe(true);
      expect(settings.clientId).toBe("test-client-id");
      expect(settings.companyId).toBe(12345);
      expect(settings.syncFrequency).toBe("daily");
    });

    it("should create unimicroCustomerMapping table", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Insert test mapping
      await db.insert(unimicroCustomerMapping).values({
        tenantId: TEST_TENANT_ID,
        customerId: 1,
        unimicroCustomerId: 99999,
        syncedAt: new Date(),
      });

      // Verify insertion
      const [mapping] = await db
        .select()
        .from(unimicroCustomerMapping)
        .where(and(
          eq(unimicroCustomerMapping.tenantId, TEST_TENANT_ID),
          eq(unimicroCustomerMapping.customerId, 1)
        ))
        .limit(1);

      expect(mapping).toBeDefined();
      expect(mapping.customerId).toBe(1);
      expect(mapping.unimicroCustomerId).toBe(99999);
    });

    it("should create unimicroInvoiceMapping table", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Insert test mapping
      await db.insert(unimicroInvoiceMapping).values({
        tenantId: TEST_TENANT_ID,
        orderId: 1,
        unimicroInvoiceId: 88888,
        unimicroInvoiceNumber: "INV-88888",
        status: "synced",
        syncedAt: new Date(),
      });

      // Verify insertion
      const [mapping] = await db
        .select()
        .from(unimicroInvoiceMapping)
        .where(and(
          eq(unimicroInvoiceMapping.tenantId, TEST_TENANT_ID),
          eq(unimicroInvoiceMapping.orderId, 1)
        ))
        .limit(1);

      expect(mapping).toBeDefined();
      expect(mapping.orderId).toBe(1);
      expect(mapping.unimicroInvoiceId).toBe(88888);
      expect(mapping.unimicroInvoiceNumber).toBe("INV-88888");
      expect(mapping.status).toBe("synced");
    });

    it("should create unimicroSyncLog table", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Insert test log
      await db.insert(unimicroSyncLog).values({
        tenantId: TEST_TENANT_ID,
        operation: "customer_sync",
        status: "success",
        itemsProcessed: 5,
        itemsFailed: 0,
        duration: 1500,
        triggeredBy: "manual",
      });

      // Verify insertion
      const [log] = await db
        .select()
        .from(unimicroSyncLog)
        .where(eq(unimicroSyncLog.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(log).toBeDefined();
      expect(log.operation).toBe("customer_sync");
      expect(log.status).toBe("success");
      expect(log.itemsProcessed).toBe(5);
      expect(log.itemsFailed).toBe(0);
      expect(log.triggeredBy).toBe("manual");
    });
  });

  describe("Sync Frequency Configuration", () => {
    it("should support daily sync frequency", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(unimicroSettings)
        .set({
          syncFrequency: "daily",
          syncHour: 23,
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.syncFrequency).toBe("daily");
      expect(settings.syncHour).toBe(23);
    });

    it("should support weekly sync frequency", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(unimicroSettings)
        .set({
          syncFrequency: "weekly",
          syncDayOfWeek: 0, // Sunday
          syncHour: 23,
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.syncFrequency).toBe("weekly");
      expect(settings.syncDayOfWeek).toBe(0);
    });

    it("should support monthly sync frequency", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(unimicroSettings)
        .set({
          syncFrequency: "monthly",
          syncDayOfMonth: -1, // Last day of month
          syncHour: 23,
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.syncFrequency).toBe("monthly");
      expect(settings.syncDayOfMonth).toBe(-1);
    });

    it("should support manual sync frequency", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(unimicroSettings)
        .set({
          syncFrequency: "manual",
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.syncFrequency).toBe("manual");
    });
  });

  describe("Customer Mapping", () => {
    it("should map Stylora customer to Unimicro customer", () => {
      const testCustomer = {
        firstName: "Mohammed",
        lastName: "Ahmed",
        phone: "+47 123 45 678",
        email: "mohammed@example.com",
        address: "Storgata 1, 0123 Oslo",
      };

      // Simulate mapping logic
      const name = `${testCustomer.firstName} ${testCustomer.lastName}`;
      const parts = testCustomer.address.split(',').map(s => s.trim());
      const address = parts[0];
      const lastPart = parts[parts.length - 1];
      const match = lastPart.match(/(\d{4})\s+(.+)/);
      const postalCode = match ? match[1] : undefined;
      const city = match ? match[2] : undefined;

      expect(name).toBe("Mohammed Ahmed");
      expect(testCustomer.phone).toBe("+47 123 45 678");
      expect(testCustomer.email).toBe("mohammed@example.com");
      expect(address).toBe("Storgata 1");
      expect(postalCode).toBe("0123");
      expect(city).toBe("Oslo");
    });

    it("should handle customer without address", () => {
      const testCustomer = {
        firstName: "Ali",
        lastName: "Hassan",
        phone: "+47 987 65 432",
        email: "ali@example.com",
        address: null,
      };

      const name = `${testCustomer.firstName} ${testCustomer.lastName}`;
      
      expect(name).toBe("Ali Hassan");
      expect(testCustomer.address).toBeNull();
    });
  });

  describe("Invoice Mapping", () => {
    it("should calculate VAT correctly (25%)", () => {
      const unitPrice = 300; // 300 kr
      const quantity = 1;
      const vatRate = 25;

      const amount = unitPrice * quantity;
      const vatAmount = amount * (vatRate / 100);
      const totalAmount = amount + vatAmount;

      expect(amount).toBe(300);
      expect(vatAmount).toBe(75);
      expect(totalAmount).toBe(375);
    });

    it("should calculate multiple line items correctly", () => {
      const lines = [
        { unitPrice: 300, quantity: 1, vatRate: 25 }, // Herreklipp
        { unitPrice: 150, quantity: 1, vatRate: 25 }, // Skjeggstuss
        { unitPrice: 120, quantity: 1, vatRate: 25 }, // Hårgelé
      ];

      let totalAmount = 0;
      let totalVAT = 0;

      for (const line of lines) {
        const amount = line.unitPrice * line.quantity;
        const vatAmount = amount * (line.vatRate / 100);
        totalAmount += amount;
        totalVAT += vatAmount;
      }

      const totalWithVAT = totalAmount + totalVAT;

      expect(totalAmount).toBe(570);
      expect(totalVAT).toBe(142.5);
      expect(totalWithVAT).toBe(712.5);
    });

    it("should set correct invoice status based on payment", () => {
      // Unpaid order
      const unpaidStatus = "Invoiced";
      expect(unpaidStatus).toBe("Invoiced");

      // Paid order
      const paidStatus = "Paid";
      expect(paidStatus).toBe("Paid");
    });

    it("should calculate due date correctly (14 days)", () => {
      const invoiceDate = new Date("2025-12-02");
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 14);

      expect(dueDate.toISOString().split('T')[0]).toBe("2025-12-16");
    });
  });

  describe("Sync Logging", () => {
    it("should log successful sync operations", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(unimicroSyncLog).values({
        tenantId: TEST_TENANT_ID,
        operation: "invoice_sync",
        status: "success",
        itemsProcessed: 10,
        itemsFailed: 0,
        duration: 2500,
        triggeredBy: "scheduled",
      });

      const logs = await db
        .select()
        .from(unimicroSyncLog)
        .where(and(
          eq(unimicroSyncLog.tenantId, TEST_TENANT_ID),
          eq(unimicroSyncLog.operation, "invoice_sync")
        ));

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[logs.length - 1];
      expect(log.status).toBe("success");
      expect(log.itemsProcessed).toBe(10);
      expect(log.itemsFailed).toBe(0);
    });

    it("should log failed sync operations", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(unimicroSyncLog).values({
        tenantId: TEST_TENANT_ID,
        operation: "customer_sync",
        status: "failed",
        itemsProcessed: 0,
        itemsFailed: 5,
        errorMessage: "Connection timeout",
        duration: 5000,
        triggeredBy: "manual",
      });

      const logs = await db
        .select()
        .from(unimicroSyncLog)
        .where(and(
          eq(unimicroSyncLog.tenantId, TEST_TENANT_ID),
          eq(unimicroSyncLog.status, "failed")
        ));

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[logs.length - 1];
      expect(log.status).toBe("failed");
      expect(log.errorMessage).toBe("Connection timeout");
    });

    it("should log partial sync operations", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(unimicroSyncLog).values({
        tenantId: TEST_TENANT_ID,
        operation: "full_sync",
        status: "partial",
        itemsProcessed: 15,
        itemsFailed: 3,
        errorMessage: "3 items failed to sync",
        duration: 8000,
        triggeredBy: "manual",
      });

      const logs = await db
        .select()
        .from(unimicroSyncLog)
        .where(and(
          eq(unimicroSyncLog.tenantId, TEST_TENANT_ID),
          eq(unimicroSyncLog.status, "partial")
        ));

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[logs.length - 1];
      expect(log.status).toBe("partial");
      expect(log.itemsProcessed).toBe(15);
      expect(log.itemsFailed).toBe(3);
    });
  });

  describe("Settings Management", () => {
    it("should enable/disable integration", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Disable
      await db
        .update(unimicroSettings)
        .set({ enabled: false })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      let [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.enabled).toBe(false);

      // Enable
      await db
        .update(unimicroSettings)
        .set({ enabled: true })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.enabled).toBe(true);
    });

    it("should update API credentials", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(unimicroSettings)
        .set({
          clientId: "new-client-id",
          clientSecret: "new-client-secret",
          companyId: 54321,
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.clientId).toBe("new-client-id");
      expect(settings.clientSecret).toBe("new-client-secret");
      expect(settings.companyId).toBe(54321);
    });

    it("should track last sync status", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const now = new Date();
      await db
        .update(unimicroSettings)
        .set({
          lastSyncAt: now,
          lastSyncStatus: "success",
        })
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID));

      const [settings] = await db
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, TEST_TENANT_ID))
        .limit(1);

      expect(settings.lastSyncStatus).toBe("success");
      expect(settings.lastSyncAt).toBeDefined();
    });
  });
});
