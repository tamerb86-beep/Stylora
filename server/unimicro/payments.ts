/**
 * Unimicro Payment Sync
 * Handles syncing payments and refunds between Stylora and Unimicro
 */

import { getDb } from "../db";
import { getUnimicroClient } from "./client";
import { 
  payments,
  refunds,
  orders,
  unimicroInvoiceMapping,
  unimicroSyncLog,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Unimicro Payment API model
 * Based on https://developer.unimicro.no/docs/Payment
 */
export interface UnimicroPayment {
  ID?: number;
  InvoiceID: number;
  PaymentDate: string; // ISO date format
  Amount: number;
  Currency: string;
  PaymentMethod?: string;
  Reference?: string; // Transaction ID or reference
  Notes?: string;
}

/**
 * Unimicro Credit Note API model
 * Used for refunds
 */
export interface UnimicroCreditNote {
  ID?: number;
  OriginalInvoiceID: number;
  CreditNoteDate: string; // ISO date format
  Amount: number;
  Currency: string;
  Reason: string;
  Lines: Array<{
    Description: string;
    Amount: number;
  }>;
}

/**
 * Sync a payment to Unimicro
 * Updates invoice status to Paid when payment is registered
 */
export async function syncPaymentToUnimicro(
  tenantId: string,
  paymentId: number
): Promise<{ success: boolean; unimicroPaymentId?: number; error?: string }> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    // Get payment details
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.id, paymentId),
        eq(payments.tenantId, tenantId)
      ))
      .limit(1);
    
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }
    
    if (!payment.orderId) {
      throw new Error("Payment must be linked to an order");
    }
    
    // Get invoice mapping for this order
    const [invoiceMapping] = await db
      .select()
      .from(unimicroInvoiceMapping)
      .where(and(
        eq(unimicroInvoiceMapping.tenantId, tenantId),
        eq(unimicroInvoiceMapping.orderId, payment.orderId)
      ))
      .limit(1);
    
    if (!invoiceMapping || invoiceMapping.status !== 'synced') {
      throw new Error("Order must be synced to Unimicro before syncing payment");
    }
    
    // Get Unimicro client
    const client = await getUnimicroClient(tenantId);
    
    // Prepare payment data
    const paymentDateValue = payment.processedAt || payment.createdAt || new Date();
    const paymentDate = new Date(paymentDateValue).toISOString().split('T')[0];
    
    const paymentMethodDisplay = payment.paymentGateway || payment.paymentMethod;
    const reference = payment.gatewayPaymentId || `PAY-${payment.id}`;
    
    const unimicroPayment: UnimicroPayment = {
      InvoiceID: invoiceMapping.unimicroInvoiceId,
      PaymentDate: paymentDate,
      Amount: parseFloat(payment.amount),
      Currency: payment.currency,
      PaymentMethod: paymentMethodDisplay,
      Reference: reference,
      Notes: payment.errorMessage || undefined,
    };
    
    // Register payment in Unimicro
    const response = await client.post<UnimicroPayment>('/api/Payment', unimicroPayment);
    const unimicroPaymentId = response.ID!;
    
    // Check if invoice is now fully paid
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .limit(1);
    
    if (order && payment.status === 'completed') {
      const orderTotal = parseFloat(order.total);
      const paymentAmount = parseFloat(payment.amount);
      
      // If payment covers full amount, update invoice status to Paid
      if (Math.abs(paymentAmount - orderTotal) < 0.01) {
        await db
          .update(unimicroInvoiceMapping)
          .set({ status: 'paid' })
          .where(eq(unimicroInvoiceMapping.id, invoiceMapping.id));
      }
    }
    
    const duration = Date.now() - startTime;
    
    // Log success
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'payment_sync',
      status: 'success',
      itemsProcessed: 1,
      itemsFailed: 0,
      duration,
      triggeredBy: 'manual',
    });
    
    return {
      success: true,
      unimicroPaymentId,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    
    // Log failure
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'payment_sync',
      status: 'failed',
      itemsProcessed: 0,
      itemsFailed: 1,
      errorMessage,
      duration,
      triggeredBy: 'manual',
    });
    
    console.error(`[Unimicro] Payment sync failed for payment ${paymentId}:`, error);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Sync a refund to Unimicro as a credit note
 */
export async function syncRefundToUnimicro(
  tenantId: string,
  refundId: number
): Promise<{ success: boolean; unimicroCreditNoteId?: number; error?: string }> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    // Get refund details
    const [refund] = await db
      .select()
      .from(refunds)
      .where(and(
        eq(refunds.id, refundId),
        eq(refunds.tenantId, tenantId)
      ))
      .limit(1);
    
    if (!refund) {
      throw new Error(`Refund ${refundId} not found`);
    }
    
    // Get original payment
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, refund.paymentId))
      .limit(1);
    
    if (!payment || !payment.orderId) {
      throw new Error("Refund must be linked to a payment with an order");
    }
    
    // Get invoice mapping
    const [invoiceMapping] = await db
      .select()
      .from(unimicroInvoiceMapping)
      .where(and(
        eq(unimicroInvoiceMapping.tenantId, tenantId),
        eq(unimicroInvoiceMapping.orderId, payment.orderId)
      ))
      .limit(1);
    
    if (!invoiceMapping || invoiceMapping.status !== 'synced') {
      throw new Error("Order must be synced to Unimicro before syncing refund");
    }
    
    // Get Unimicro client
    const client = await getUnimicroClient(tenantId);
    
    // Prepare credit note data
    const creditNoteDate = refund.processedAt
      ? new Date(refund.processedAt).toISOString().split('T')[0]
      : new Date(refund.createdAt).toISOString().split('T')[0];
    
    const unimicroCreditNote: UnimicroCreditNote = {
      OriginalInvoiceID: invoiceMapping.unimicroInvoiceId,
      CreditNoteDate: creditNoteDate,
      Amount: parseFloat(refund.amount),
      Currency: 'NOK',
      Reason: refund.reason,
      Lines: [
        {
          Description: `Refusjon: ${refund.reason}`,
          Amount: parseFloat(refund.amount),
        },
      ],
    };
    
    // Create credit note in Unimicro
    const response = await client.post<UnimicroCreditNote>('/api/CreditNote', unimicroCreditNote);
    const unimicroCreditNoteId = response.ID!;
    
    const duration = Date.now() - startTime;
    
    // Log success
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'payment_sync',
      status: 'success',
      itemsProcessed: 1,
      itemsFailed: 0,
      details: { errors: [{ id: refundId, error: 'Refund synced as credit note' }] },
      duration,
      triggeredBy: 'manual',
    });
    
    return {
      success: true,
      unimicroCreditNoteId,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    
    // Log failure
    await db.insert(unimicroSyncLog).values({
      tenantId,
      operation: 'payment_sync',
      status: 'failed',
      itemsProcessed: 0,
      itemsFailed: 1,
      errorMessage,
      details: { errors: [{ id: refundId, error: errorMessage }] },
      duration,
      triggeredBy: 'manual',
    });
    
    console.error(`[Unimicro] Refund sync failed for refund ${refundId}:`, error);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Update invoice status in Unimicro
 * Used when payment status changes
 */
export async function updateInvoiceStatus(
  tenantId: string,
  orderId: number,
  status: 'Draft' | 'Invoiced' | 'Paid' | 'Cancelled'
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    // Get invoice mapping
    const [invoiceMapping] = await db
      .select()
      .from(unimicroInvoiceMapping)
      .where(and(
        eq(unimicroInvoiceMapping.tenantId, tenantId),
        eq(unimicroInvoiceMapping.orderId, orderId)
      ))
      .limit(1);
    
    if (!invoiceMapping || invoiceMapping.status !== 'synced') {
      throw new Error("Invoice not found or not synced");
    }
    
    // Get Unimicro client
    const client = await getUnimicroClient(tenantId);
    
    // Update invoice status
    await client.put(`/api/CustomerInvoice/${invoiceMapping.unimicroInvoiceId}`, {
      Status: status,
    });
    
    // Update local mapping status
    const mappingStatus = status === 'Paid' ? 'paid' : 'synced';
    await db
      .update(unimicroInvoiceMapping)
      .set({ status: mappingStatus })
      .where(eq(unimicroInvoiceMapping.id, invoiceMapping.id));
    
    return { success: true };
  } catch (error: any) {
    console.error(`[Unimicro] Invoice status update failed for order ${orderId}:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Get payments that need to be synced for an order
 */
export async function getUnsyncedPaymentsForOrder(
  tenantId: string,
  orderId: number
): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get all completed payments for this order
  const orderPayments = await db
    .select()
    .from(payments)
    .where(and(
      eq(payments.tenantId, tenantId),
      eq(payments.orderId, orderId),
      eq(payments.status, 'completed')
    ));
  
  return orderPayments;
}
