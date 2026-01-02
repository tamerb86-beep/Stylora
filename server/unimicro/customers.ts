/**
 * Unimicro Customer Sync
 * Handles syncing customers between Stylora and Unimicro
 */

import { getDb } from "../db";
import { getUnimicroClient } from "./client";
import { 
  customers, 
  unimicroCustomerMapping, 
  unimicroSyncLog,
  type Customer 
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Unimicro Customer API model
 * Based on https://developer.unimicro.no/docs/Customer
 */
export interface UnimicroCustomer {
  ID?: number;
  Name: string;
  Phone?: string;
  Email?: string;
  Address?: string;
  City?: string;
  PostalCode?: string;
  Country?: string;
  OrgNumber?: string;
  Notes?: string;
}

/**
 * Map Stylora customer to Unimicro Customer format
 */
function mapCustomerToUnimicro(customer: Customer): UnimicroCustomer {
  const fullName = `${customer.firstName}${customer.lastName ? ' ' + customer.lastName : ''}`.trim();
  
  // Parse address if available (assuming format: "Street, PostalCode City")
  let address = '';
  let city = '';
  let postalCode = '';
  
  if (customer.address) {
    const addressParts = customer.address.split(',').map(p => p.trim());
    if (addressParts.length >= 2) {
      address = addressParts[0];
      const cityParts = addressParts[1].split(' ');
      if (cityParts.length >= 2) {
        postalCode = cityParts[0];
        city = cityParts.slice(1).join(' ');
      } else {
        city = addressParts[1];
      }
    } else {
      address = customer.address;
    }
  }
  
  return {
    Name: fullName,
    Phone: customer.phone || undefined,
    Email: customer.email || undefined,
    Address: address || undefined,
    City: city || undefined,
    PostalCode: postalCode || undefined,
    Country: 'NO', // Default to Norway
    Notes: customer.notes || undefined,
  };
}

/**
 * Sync a single customer to Unimicro
 * Creates new customer or updates existing one
 */
export async function syncCustomerToUnimicro(
  tenantId: string,
  customerId: number
): Promise<{ success: boolean; unimicroCustomerId?: number; error?: string }> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    // Get customer from Stylora
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.id, customerId),
        eq(customers.tenantId, tenantId)
      ))
      .limit(1);
    
    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }
    
    // Check if customer is already synced
    const [existingMapping] = await db
      .select()
      .from(unimicroCustomerMapping)
      .where(and(
        eq(unimicroCustomerMapping.tenantId, tenantId),
        eq(unimicroCustomerMapping.customerId, customerId)
      ))
      .limit(1);
    
    // Get Unimicro client
    const client = await getUnimicroClient(tenantId);
    
    // Map customer data
    const unimicroCustomer = mapCustomerToUnimicro(customer);
    
    let unimicroCustomerId: number;
    
    if (existingMapping) {
      // Update existing customer in Unimicro
      unimicroCustomer.ID = existingMapping.unimicroCustomerId;
      await client.put(`/api/Customer/${existingMapping.unimicroCustomerId}`, unimicroCustomer);
      unimicroCustomerId = existingMapping.unimicroCustomerId;
      
      // Update mapping timestamp
      await db
        .update(unimicroCustomerMapping)
        .set({
          status: 'synced',
          syncedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(unimicroCustomerMapping.id, existingMapping.id));
    } else {
      // Create new customer in Unimicro
      const response = await client.post<UnimicroCustomer>('/api/Customer', unimicroCustomer);
      unimicroCustomerId = response.ID!;
      
      // Create mapping
      await db.insert(unimicroCustomerMapping).values({
        tenantId,
        customerId,
        unimicroCustomerId,
        status: 'synced',
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Log success
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'customer_sync',
      status: 'success',
      itemsProcessed: 1,
      itemsFailed: 0,
      details: { customerIds: [customerId] },
      duration,
      triggeredBy: 'manual',
    });
    
    return {
      success: true,
      unimicroCustomerId,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    
    // Update mapping with error if exists
    const [existingMapping] = await db
      .select()
      .from(unimicroCustomerMapping)
      .where(and(
        eq(unimicroCustomerMapping.tenantId, tenantId),
        eq(unimicroCustomerMapping.customerId, customerId)
      ))
      .limit(1);
    
    if (existingMapping) {
      await db
        .update(unimicroCustomerMapping)
        .set({
          status: 'failed',
          errorMessage,
        })
        .where(eq(unimicroCustomerMapping.id, existingMapping.id));
    }
    
    // Log failure
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'customer_sync',
      status: 'failed',
      itemsProcessed: 0,
      itemsFailed: 1,
      errorMessage,
      details: { 
        customerIds: [customerId],
        errors: [{ id: customerId, error: errorMessage }],
      },
      duration,
      triggeredBy: 'manual',
    });
    
    console.error(`[Unimicro] Customer sync failed for customer ${customerId}:`, error);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Sync multiple customers to Unimicro
 * Useful for bulk operations
 */
export async function syncCustomersToUnimicro(
  tenantId: string,
  customerIds: number[]
): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ customerId: number; error: string }>;
}> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  let processed = 0;
  let failed = 0;
  const errors: Array<{ customerId: number; error: string }> = [];
  
  for (const customerId of customerIds) {
    const result = await syncCustomerToUnimicro(tenantId, customerId);
    if (result.success) {
      processed++;
    } else {
      failed++;
      errors.push({ customerId, error: result.error || 'Unknown error' });
    }
  }
  
  const duration = Date.now() - startTime;
  const status = failed === 0 ? 'success' : (processed > 0 ? 'partial' : 'failed');
  
  // Log bulk sync
  await db.insert(unimicroSyncLog).values({
    tenantId,
    operation: 'customer_sync',
    status,
    itemsProcessed: processed,
    itemsFailed: failed,
    errorMessage: failed > 0 ? `${failed} customers failed to sync` : null,
    details: { 
      customerIds,
      errors: errors.length > 0 ? errors.map(e => ({ id: e.customerId, error: e.error })) : undefined,
    },
    duration,
    triggeredBy: 'manual',
  });
  
  return {
    success: failed === 0,
    processed,
    failed,
    errors,
  };
}

/**
 * Get customer sync status
 */
export async function getCustomerSyncStatus(
  tenantId: string,
  customerId: number
): Promise<{
  synced: boolean;
  unimicroCustomerId?: number;
  lastSyncedAt?: Date;
  error?: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [mapping] = await db
    .select()
    .from(unimicroCustomerMapping)
    .where(and(
      eq(unimicroCustomerMapping.tenantId, tenantId),
      eq(unimicroCustomerMapping.customerId, customerId)
    ))
    .limit(1);
  
  if (!mapping) {
    return { synced: false };
  }
  
  return {
    synced: mapping.status === 'synced',
    unimicroCustomerId: mapping.unimicroCustomerId,
    lastSyncedAt: mapping.syncedAt,
    error: mapping.errorMessage || undefined,
  };
}

/**
 * Get all unsynced customers for a tenant
 */
export async function getUnsyncedCustomers(tenantId: string): Promise<Customer[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get all customers that don't have a mapping
  const allCustomers = await db
    .select()
    .from(customers)
    .where(eq(customers.tenantId, tenantId));
  
  const syncedMappings = await db
    .select()
    .from(unimicroCustomerMapping)
    .where(eq(unimicroCustomerMapping.tenantId, tenantId));
  
  const syncedCustomerIds = new Set(syncedMappings.map(m => m.customerId));
  
  return allCustomers.filter(c => !syncedCustomerIds.has(c.id));
}
