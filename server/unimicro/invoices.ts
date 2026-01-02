/**
 * Unimicro Invoice Sync
 * Handles syncing orders/invoices between Stylora and Unimicro
 */

import { getDb } from "../db";
import { getUnimicroClient } from "./client";
import { syncCustomerToUnimicro } from "./customers";
import { 
  orders,
  orderItems,
  customers,
  services,
  products,
  payments,
  unimicroInvoiceMapping,
  unimicroCustomerMapping,
  unimicroSyncLog,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Unimicro CustomerInvoice API model
 * Based on https://developer.unimicro.no/docs/CustomerInvoice
 */
export interface UnimicroInvoice {
  ID?: number;
  InvoiceNumber?: string;
  CustomerID: number;
  InvoiceDate: string; // ISO date format
  DueDate: string; // ISO date format
  Currency: string;
  Status?: 'Draft' | 'Invoiced' | 'Paid' | 'Cancelled';
  Lines: UnimicroInvoiceLine[];
  Notes?: string;
  TotalAmount?: number;
  TotalVAT?: number;
  TotalWithVAT?: number;
}

export interface UnimicroInvoiceLine {
  Description: string;
  Quantity: number;
  UnitPrice: number;
  VATRate: number; // Percentage (e.g., 25 for 25%)
  Amount?: number; // Calculated: Quantity * UnitPrice
  VATAmount?: number; // Calculated: Amount * (VATRate / 100)
  TotalAmount?: number; // Calculated: Amount + VATAmount
}

/**
 * Get order with all related data
 */
async function getOrderWithDetails(tenantId: string, orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get order
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
  
  // Get customer if exists
  let customer = null;
  if (order.customerId) {
    const [c] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);
    customer = c;
  }
  
  // Get payment info
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);
  
  // Enrich items with service/product names
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      let name = `Item ${item.itemId}`; // Default name
      
      if (item.itemType === 'service') {
        const [service] = await db
          .select()
          .from(services)
          .where(eq(services.id, item.itemId))
          .limit(1);
        if (service) name = service.name;
      } else if (item.itemType === 'product') {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, item.itemId))
          .limit(1);
        if (product) name = product.name;
      }
      
      return {
        ...item,
        name,
      };
    })
  );
  
  return {
    order,
    items: enrichedItems,
    customer,
    payment,
  };
}

/**
 * Map Stylora order to Unimicro Invoice format
 */
async function mapOrderToUnimicroInvoice(
  tenantId: string,
  orderId: number,
  unimicroCustomerId: number
): Promise<UnimicroInvoice> {
  const { order, items, payment } = await getOrderWithDetails(tenantId, orderId);
  
  // Calculate invoice dates
  const orderDate = order.createdAt || new Date();
  const invoiceDate = new Date(orderDate).toISOString().split('T')[0];
  const dueDate = new Date(orderDate);
  dueDate.setDate(dueDate.getDate() + 14); // 14 days payment term
  const dueDateStr = dueDate.toISOString().split('T')[0];
  
  // Map order items to invoice lines
  const lines: UnimicroInvoiceLine[] = items.map((item) => {
    const unitPrice = parseFloat(item.unitPrice);
    const quantity = item.quantity || 1;
    const vatRate = 25; // Norwegian standard VAT rate
    
    const amount = unitPrice * quantity;
    const vatAmount = amount * (vatRate / 100);
    const totalAmount = amount + vatAmount;
    
    return {
      Description: item.name,
      Quantity: quantity,
      UnitPrice: unitPrice,
      VATRate: vatRate,
      Amount: amount,
      VATAmount: vatAmount,
      TotalAmount: totalAmount,
    };
  });
  
  // Calculate totals
  const totalAmount = lines.reduce((sum, line) => sum + (line.Amount || 0), 0);
  const totalVAT = lines.reduce((sum, line) => sum + (line.VATAmount || 0), 0);
  const totalWithVAT = totalAmount + totalVAT;
  
  // Determine invoice status
  let status: 'Draft' | 'Invoiced' | 'Paid' = 'Invoiced';
  if (payment && payment.status === 'completed') {
    status = 'Paid';
  }
  
  // Build notes
  const notes = [];
  if (payment) {
    const paymentMethodDisplay = payment.paymentGateway || payment.paymentMethod;
    notes.push(`Betalt via ${paymentMethodDisplay} - ${invoiceDate}`);
  }
  
  return {
    CustomerID: unimicroCustomerId,
    InvoiceDate: invoiceDate,
    DueDate: dueDateStr,
    Currency: 'NOK',
    Status: status,
    Lines: lines,
    Notes: notes.join('\n') || undefined,
    TotalAmount: totalAmount,
    TotalVAT: totalVAT,
    TotalWithVAT: totalWithVAT,
  };
}

/**
 * Sync a single order to Unimicro as an invoice
 */
export async function syncOrderToUnimicro(
  tenantId: string,
  orderId: number
): Promise<{ 
  success: boolean; 
  unimicroInvoiceId?: number; 
  unimicroInvoiceNumber?: string;
  error?: string 
}> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    // Get order details
    const { order, customer } = await getOrderWithDetails(tenantId, orderId);
    
    // Check if order is already synced
    const [existingMapping] = await db
      .select()
      .from(unimicroInvoiceMapping)
      .where(and(
        eq(unimicroInvoiceMapping.tenantId, tenantId),
        eq(unimicroInvoiceMapping.orderId, orderId)
      ))
      .limit(1);
    
    if (existingMapping && existingMapping.status === 'synced') {
      return {
        success: true,
        unimicroInvoiceId: existingMapping.unimicroInvoiceId,
        unimicroInvoiceNumber: existingMapping.unimicroInvoiceNumber,
      };
    }
    
    // Ensure customer exists in Unimicro
    let unimicroCustomerId: number;
    
    if (customer) {
      // Check if customer is already synced
      const [customerMapping] = await db
        .select()
        .from(unimicroCustomerMapping)
        .where(and(
          eq(unimicroCustomerMapping.tenantId, tenantId),
          eq(unimicroCustomerMapping.customerId, customer.id)
        ))
        .limit(1);
      
      if (customerMapping) {
        unimicroCustomerId = customerMapping.unimicroCustomerId;
      } else {
        // Sync customer first
        const syncResult = await syncCustomerToUnimicro(tenantId, customer.id);
        if (!syncResult.success || !syncResult.unimicroCustomerId) {
          throw new Error(`Failed to sync customer: ${syncResult.error}`);
        }
        unimicroCustomerId = syncResult.unimicroCustomerId;
      }
    } else {
      // Walk-in customer - create a default "Walk-in" customer in Unimicro
      // For now, throw error - this should be handled separately
      throw new Error("Walk-in customers not yet supported for Unimicro sync");
    }
    
    // Get Unimicro client
    const client = await getUnimicroClient(tenantId);
    
    // Map order to invoice
    const invoice = await mapOrderToUnimicroInvoice(tenantId, orderId, unimicroCustomerId);
    
    // Create invoice in Unimicro
    const response = await client.post<UnimicroInvoice>('/api/CustomerInvoice', invoice);
    
    const unimicroInvoiceId = response.ID!;
    const unimicroInvoiceNumber = response.InvoiceNumber || `INV-${unimicroInvoiceId}`;
    
    // Create or update mapping
    if (existingMapping) {
      await db
        .update(unimicroInvoiceMapping)
        .set({
          unimicroInvoiceId,
          unimicroInvoiceNumber,
          status: 'synced',
          syncedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(unimicroInvoiceMapping.id, existingMapping.id));
    } else {
      await db.insert(unimicroInvoiceMapping).values({
        tenantId,
        orderId,
        unimicroInvoiceId,
        unimicroInvoiceNumber,
        status: 'synced',
        syncedAt: new Date(),
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Log success
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'invoice_sync',
      status: 'success',
      itemsProcessed: 1,
      itemsFailed: 0,
      details: { invoiceIds: [orderId] },
      duration,
      triggeredBy: 'manual',
    });
    
    return {
      success: true,
      unimicroInvoiceId,
      unimicroInvoiceNumber,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    
    // Update mapping with error if exists
    const [existingMapping] = await db
      .select()
      .from(unimicroInvoiceMapping)
      .where(and(
        eq(unimicroInvoiceMapping.tenantId, tenantId),
        eq(unimicroInvoiceMapping.orderId, orderId)
      ))
      .limit(1);
    
    if (existingMapping) {
      await db
        .update(unimicroInvoiceMapping)
        .set({
          status: 'failed',
          errorMessage,
        })
        .where(eq(unimicroInvoiceMapping.id, existingMapping.id));
    } else {
      // Create failed mapping entry
      await db.insert(unimicroInvoiceMapping).values({
        tenantId,
        orderId,
        unimicroInvoiceId: 0, // Placeholder
        unimicroInvoiceNumber: '',
        status: 'failed',
        errorMessage,
      });
    }
    
    // Log failure
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'invoice_sync',
      status: 'failed',
      itemsProcessed: 0,
      itemsFailed: 1,
      errorMessage,
      details: { 
        invoiceIds: [orderId],
        errors: [{ id: orderId, error: errorMessage }],
      },
      duration,
      triggeredBy: 'manual',
    });
    
    console.error(`[Unimicro] Invoice sync failed for order ${orderId}:`, error);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Sync multiple orders to Unimicro
 */
export async function syncOrdersToUnimicro(
  tenantId: string,
  orderIds: number[]
): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{ orderId: number; error: string }>;
}> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  let processed = 0;
  let failed = 0;
  const errors: Array<{ orderId: number; error: string }> = [];
  
  for (const orderId of orderIds) {
    const result = await syncOrderToUnimicro(tenantId, orderId);
    if (result.success) {
      processed++;
    } else {
      failed++;
      errors.push({ orderId, error: result.error || 'Unknown error' });
    }
  }
  
  const duration = Date.now() - startTime;
  const status = failed === 0 ? 'success' : (processed > 0 ? 'partial' : 'failed');
  
  // Log bulk sync
  await db.insert(unimicroSyncLog).values({
    tenantId,
    operation: 'invoice_sync',
    status,
    itemsProcessed: processed,
    itemsFailed: failed,
    errorMessage: failed > 0 ? `${failed} invoices failed to sync` : null,
    details: { 
      invoiceIds: orderIds,
      errors: errors.length > 0 ? errors.map(e => ({ id: e.orderId, error: e.error })) : undefined,
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
 * Get unsynced orders for a tenant
 */
export async function getUnsyncedOrders(tenantId: string): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get all completed/paid orders
  const allOrders = await db
    .select()
    .from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.status, 'completed')
    ));
  
  // Get synced mappings
  const syncedMappings = await db
    .select()
    .from(unimicroInvoiceMapping)
    .where(and(
      eq(unimicroInvoiceMapping.tenantId, tenantId),
      eq(unimicroInvoiceMapping.status, 'synced')
    ));
  
  const syncedOrderIds = new Set(syncedMappings.map(m => m.orderId));
  
  return allOrders.filter(o => !syncedOrderIds.has(o.id));
}
