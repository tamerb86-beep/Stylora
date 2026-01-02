/**
 * Fiken Customer Sync Module
 * 
 * Handles syncing customers between Stylora and Fiken
 */

import { getDb } from "../db";
import { customers, fikenCustomerMapping, fikenSyncLog } from "../../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";
import { FikenClient, FikenContact } from "./client";

export interface CustomerSyncResult {
  success: boolean;
  customerId: number;
  fikenContactId?: number;
  error?: string;
}

/**
 * Map Stylora customer to Fiken contact format
 */
export function mapCustomerToFiken(customer: {
  id: number;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): Partial<FikenContact> {
  const fullName = customer.lastName 
    ? `${customer.firstName} ${customer.lastName}` 
    : customer.firstName;

  return {
    name: fullName,
    email: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
  };
}

/**
 * Sync a single customer to Fiken
 */
export async function syncCustomerToFiken(
  tenantId: string,
  customerId: number
): Promise<CustomerSyncResult> {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      customerId,
      error: "Database not available",
    };
  }

  try {
    // Get customer from database
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.id, customerId),
        eq(customers.tenantId, tenantId)
      ))
      .limit(1);

    if (!customer) {
      return {
        success: false,
        customerId,
        error: "Customer not found",
      };
    }

    // Check if customer is already synced
    const [existingMapping] = await db
      .select()
      .from(fikenCustomerMapping)
      .where(and(
        eq(fikenCustomerMapping.tenantId, tenantId),
        eq(fikenCustomerMapping.customerId, customerId)
      ))
      .limit(1);

    // Initialize Fiken client
    const fikenClient = new FikenClient(tenantId);
    await fikenClient.initialize();

    if (existingMapping) {
      // Update existing contact in Fiken
      const contactData = mapCustomerToFiken(customer);
      
      await fikenClient.updateContact(
        existingMapping.fikenContactId,
        contactData
      );

      // Update mapping status
      await db
        .update(fikenCustomerMapping)
        .set({
          status: "synced",
          syncedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(fikenCustomerMapping.id, existingMapping.id));

      return {
        success: true,
        customerId,
        fikenContactId: existingMapping.fikenContactId,
      };
    } else {
      // Create new contact in Fiken
      const contactData = mapCustomerToFiken(customer);
      const fikenContact = await fikenClient.createContact(contactData);

      // Create mapping record
      await db.insert(fikenCustomerMapping).values({
        tenantId,
        customerId,
        fikenContactId: fikenContact.contactId,
        status: "synced",
        syncedAt: new Date(),
      });

      return {
        success: true,
        customerId,
        fikenContactId: fikenContact.contactId,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log error in mapping table if mapping exists
    const [existingMapping] = await db
      .select()
      .from(fikenCustomerMapping)
      .where(and(
        eq(fikenCustomerMapping.tenantId, tenantId),
        eq(fikenCustomerMapping.customerId, customerId)
      ))
      .limit(1);

    if (existingMapping) {
      await db
        .update(fikenCustomerMapping)
        .set({
          status: "failed",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(fikenCustomerMapping.id, existingMapping.id));
    } else {
      // Create failed mapping record
      await db.insert(fikenCustomerMapping).values({
        tenantId,
        customerId,
        fikenContactId: 0, // Placeholder
        status: "failed",
        errorMessage,
      });
    }

    return {
      success: false,
      customerId,
      error: errorMessage,
    };
  }
}

/**
 * Bulk sync customers to Fiken
 */
export async function bulkSyncCustomers(
  tenantId: string,
  customerIds?: number[]
): Promise<{
  success: boolean;
  results: CustomerSyncResult[];
  totalProcessed: number;
  totalFailed: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const startTime = Date.now();

  try {
    // Get customers to sync
    let customersToSync;

    if (customerIds && customerIds.length > 0) {
      // Sync specific customers
      customersToSync = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          eq(customers.deletedAt, null as any)
        ));
      
      customersToSync = customersToSync.filter(c => customerIds.includes(c.id));
    } else {
      // Sync all unsynced customers
      const syncedCustomerIds = await db
        .select({ customerId: fikenCustomerMapping.customerId })
        .from(fikenCustomerMapping)
        .where(and(
          eq(fikenCustomerMapping.tenantId, tenantId),
          eq(fikenCustomerMapping.status, "synced")
        ));

      const syncedIds = syncedCustomerIds.map(m => m.customerId);

      customersToSync = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.tenantId, tenantId),
          eq(customers.deletedAt, null as any)
        ));

      if (syncedIds.length > 0) {
        customersToSync = customersToSync.filter(c => !syncedIds.includes(c.id));
      }
    }

    // Sync each customer
    const results: CustomerSyncResult[] = [];

    for (const customer of customersToSync) {
      const result = await syncCustomerToFiken(tenantId, customer.id);
      results.push(result);
    }

    const totalProcessed = results.length;
    const totalFailed = results.filter(r => !r.success).length;
    const duration = Date.now() - startTime;

    // Log sync operation
    await db.insert(fikenSyncLog).values({
      tenantId,
      operation: "customer_sync",
      status: totalFailed === 0 ? "success" : totalFailed === totalProcessed ? "failed" : "partial",
      itemsProcessed: totalProcessed,
      itemsFailed: totalFailed,
      details: {
        customerIds: results.map(r => r.customerId),
        errors: results.filter(r => !r.success).map(r => ({
          id: r.customerId,
          error: r.error || "Unknown error",
        })),
      },
      duration,
      triggeredBy: "manual",
    });

    return {
      success: totalFailed === 0,
      results,
      totalProcessed,
      totalFailed,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failed sync
    await db.insert(fikenSyncLog).values({
      tenantId,
      operation: "customer_sync",
      status: "failed",
      itemsProcessed: 0,
      itemsFailed: 0,
      errorMessage,
      duration,
      triggeredBy: "manual",
    });

    throw error;
  }
}

/**
 * Get unsynced customers count
 */
export async function getUnsyncedCustomersCount(tenantId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get all customers
  const allCustomers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(
      eq(customers.tenantId, tenantId),
      eq(customers.deletedAt, null as any)
    ));

  // Get synced customer IDs
  const syncedCustomers = await db
    .select({ customerId: fikenCustomerMapping.customerId })
    .from(fikenCustomerMapping)
    .where(and(
      eq(fikenCustomerMapping.tenantId, tenantId),
      eq(fikenCustomerMapping.status, "synced")
    ));

  const syncedIds = syncedCustomers.map(m => m.customerId);
  const unsyncedCount = allCustomers.filter(c => !syncedIds.includes(c.id)).length;

  return unsyncedCount;
}
