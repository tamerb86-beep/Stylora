/**
 * Fiken Invoice Sync Module
 * 
 * Handles syncing orders/invoices between Stylora and Fiken
 */

import { getDb } from "../db";
import { 
  orders, 
  orderItems, 
  fikenInvoiceMapping, 
  fikenCustomerMapping,
  fikenSyncLog 
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { FikenClient, FikenInvoice } from "./client";

export interface InvoiceSyncResult {
  success: boolean;
  orderId: number;
  fikenInvoiceId?: number;
  fikenInvoiceNumber?: string;
  error?: string;
}

/**
 * Map Stylora order to Fiken invoice format
 */
export async function mapOrderToFikenInvoice(
  tenantId: string,
  orderId: number
): Promise<Partial<FikenInvoice>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get order details
  const [order] = await db
    .select()
    .from(orders)
    .where(and(
      eq(orders.id, orderId),
      eq(orders.tenantId, tenantId)
    ))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Get order items
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  // Check if order has a customer
  if (!order.customerId) {
    throw new Error(`Order ${orderId} has no customer assigned. Cannot create invoice.`);
  }

  // Get Fiken customer ID
  const [customerMapping] = await db
    .select()
    .from(fikenCustomerMapping)
    .where(and(
      eq(fikenCustomerMapping.tenantId, tenantId),
      eq(fikenCustomerMapping.customerId, order.customerId)
    ))
    .limit(1);

  if (!customerMapping) {
    throw new Error(`Customer ${order.customerId} not synced to Fiken. Please sync customer first.`);
  }

  // Calculate dates
  const issueDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + 14); // 14 days payment term

  // Map order items to invoice lines
  const lines = items.map(item => {
    const netAmount = parseFloat(item.unitPrice.toString()) * item.quantity;
    const vatRate = parseFloat(item.vatRate.toString()) / 100; // Convert percentage to decimal
    const vatAmount = netAmount * vatRate;
    const grossAmount = netAmount + vatAmount;

    return {
      description: item.itemName,
      netAmount: Math.round(netAmount * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      grossAmount: Math.round(grossAmount * 100) / 100,
      vatType: "HIGH", // 25% VAT
    };
  });

  return {
    customerId: customerMapping.fikenContactId,
    issueDate: issueDate.toISOString().split('T')[0],
    dueDate: dueDate.toISOString().split('T')[0],
    lines,
    currency: "NOK",
  };
}

/**
 * Sync a single order to Fiken as an invoice
 */
export async function syncOrderToFiken(
  tenantId: string,
  orderId: number
): Promise<InvoiceSyncResult> {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      orderId,
      error: "Database not available",
    };
  }

  try {
    // Check if order is already synced
    const [existingMapping] = await db
      .select()
      .from(fikenInvoiceMapping)
      .where(and(
        eq(fikenInvoiceMapping.tenantId, tenantId),
        eq(fikenInvoiceMapping.orderId, orderId)
      ))
      .limit(1);

    if (existingMapping && existingMapping.status === "sent") {
      return {
        success: true,
        orderId,
        fikenInvoiceId: existingMapping.fikenInvoiceId,
        fikenInvoiceNumber: existingMapping.fikenInvoiceNumber || undefined,
      };
    }

    // Map order to Fiken invoice
    const invoiceData = await mapOrderToFikenInvoice(tenantId, orderId);

    // Initialize Fiken client
    const fikenClient = new FikenClient(tenantId);
    await fikenClient.initialize();

    // Create invoice in Fiken
    const fikenInvoice = await fikenClient.createInvoice(invoiceData);

    if (existingMapping) {
      // Update existing mapping
      await db
        .update(fikenInvoiceMapping)
        .set({
          fikenInvoiceId: fikenInvoice.invoiceId,
          fikenInvoiceNumber: fikenInvoice.invoiceNumber || null,
          status: "sent",
          syncedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(fikenInvoiceMapping.id, existingMapping.id));
    } else {
      // Create new mapping
      await db.insert(fikenInvoiceMapping).values({
        tenantId,
        orderId,
        fikenInvoiceId: fikenInvoice.invoiceId,
        fikenInvoiceNumber: fikenInvoice.invoiceNumber || null,
        status: "sent",
        syncedAt: new Date(),
      });
    }

    return {
      success: true,
      orderId,
      fikenInvoiceId: fikenInvoice.invoiceId,
      fikenInvoiceNumber: fikenInvoice.invoiceNumber || undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log error in mapping table
    const [existingMapping] = await db
      .select()
      .from(fikenInvoiceMapping)
      .where(and(
        eq(fikenInvoiceMapping.tenantId, tenantId),
        eq(fikenInvoiceMapping.orderId, orderId)
      ))
      .limit(1);

    if (existingMapping) {
      await db
        .update(fikenInvoiceMapping)
        .set({
          status: "failed",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(fikenInvoiceMapping.id, existingMapping.id));
    } else {
      // Create failed mapping record
      await db.insert(fikenInvoiceMapping).values({
        tenantId,
        orderId,
        fikenInvoiceId: 0, // Placeholder
        status: "failed",
        errorMessage,
      });
    }

    return {
      success: false,
      orderId,
      error: errorMessage,
    };
  }
}

/**
 * Bulk sync orders to Fiken
 */
export async function bulkSyncOrders(
  tenantId: string,
  orderIds?: number[]
): Promise<{
  success: boolean;
  results: InvoiceSyncResult[];
  totalProcessed: number;
  totalFailed: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const startTime = Date.now();

  try {
    // Get orders to sync
    let ordersToSync;

    if (orderIds && orderIds.length > 0) {
      // Sync specific orders
      ordersToSync = await db
        .select()
        .from(orders)
        .where(eq(orders.tenantId, tenantId));
      
      ordersToSync = ordersToSync.filter(o => orderIds.includes(o.id));
    } else {
      // Sync all unsynced orders
      const syncedOrderIds = await db
        .select({ orderId: fikenInvoiceMapping.orderId })
        .from(fikenInvoiceMapping)
        .where(and(
          eq(fikenInvoiceMapping.tenantId, tenantId),
          eq(fikenInvoiceMapping.status, "sent")
        ));

      const syncedIds = syncedOrderIds.map(m => m.orderId);

      ordersToSync = await db
        .select()
        .from(orders)
        .where(eq(orders.tenantId, tenantId));

      if (syncedIds.length > 0) {
        ordersToSync = ordersToSync.filter(o => !syncedIds.includes(o.id));
      }
    }

    // Sync each order
    const results: InvoiceSyncResult[] = [];

    for (const order of ordersToSync) {
      const result = await syncOrderToFiken(tenantId, order.id);
      results.push(result);
    }

    const totalProcessed = results.length;
    const totalFailed = results.filter(r => !r.success).length;
    const duration = Date.now() - startTime;

    // Log sync operation
    await db.insert(fikenSyncLog).values({
      tenantId,
      operation: "invoice_sync",
      status: totalFailed === 0 ? "success" : totalFailed === totalProcessed ? "failed" : "partial",
      itemsProcessed: totalProcessed,
      itemsFailed: totalFailed,
      details: {
        invoiceIds: results.map(r => r.orderId),
        errors: results.filter(r => !r.success).map(r => ({
          id: r.orderId,
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
      operation: "invoice_sync",
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
 * Get unsynced orders count
 */
export async function getUnsyncedOrdersCount(tenantId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get all orders
  const allOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.tenantId, tenantId));

  // Get synced order IDs
  const syncedOrders = await db
    .select({ orderId: fikenInvoiceMapping.orderId })
    .from(fikenInvoiceMapping)
    .where(and(
      eq(fikenInvoiceMapping.tenantId, tenantId),
      eq(fikenInvoiceMapping.status, "sent")
    ));

  const syncedIds = syncedOrders.map(m => m.orderId);
  const unsyncedCount = allOrders.filter(o => !syncedIds.includes(o.id)).length;

  return unsyncedCount;
}
