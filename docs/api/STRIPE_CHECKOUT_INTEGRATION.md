# Stripe Checkout Integration - Implementation Guide

## Overview

This document describes the Stripe Checkout integration for appointment prepayment in the Stylora system. The implementation allows tenants to collect payment for appointments before the service is delivered.

---

## What Was Implemented

### 1. **Stripe SDK Installation**
- Package: `stripe@20.0.0`
- Installed via: `pnpm add stripe`

### 2. **Environment Configuration**
**File:** `server/_core/env.ts`

Added three Stripe environment variables:
```typescript
export const ENV = {
  // ... existing fields
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePublishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "",
};
```

These are automatically injected by the Stylora platform and don't need manual configuration.

### 3. **Stripe Client Helper**
**File:** `server/stripe.ts` (NEW)

```typescript
import Stripe from "stripe";
import { ENV } from "./_core/env";

if (!ENV.stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment");
}

export const stripe = new Stripe(ENV.stripeSecretKey, {
  apiVersion: "2025-11-17.clover",
});
```

This file exports a single Stripe instance that can be imported throughout the server code.

### 4. **Database Helpers**
**File:** `server/db.ts` (EXTENDED)

Added payment-related database functions:

| Function | Description |
|----------|-------------|
| `createPayment(data)` | Insert a new payment record |
| `getPaymentById(id)` | Fetch payment by ID |
| `getPaymentsByAppointment(appointmentId)` | Get all payments for an appointment |
| `getPaymentsByTenant(tenantId)` | Get all payments for a tenant |

### 5. **Payments Router**
**File:** `server/routers.ts` (EXTENDED)

Added new `payments` router with one procedure:

#### `payments.createCheckoutSession`

**Type:** Mutation  
**Auth:** `tenantProcedure` (requires authenticated user with tenantId)

**Input:**
```typescript
{
  appointmentId: number;    // ID of the appointment to pay for
  successUrl: string;       // URL to redirect after successful payment
  cancelUrl: string;        // URL to redirect if payment is canceled
}
```

**Output:**
```typescript
{
  url: string;              // Stripe Checkout URL to redirect user to
  paymentId: number;        // Database payment record ID
  sessionId: string;        // Stripe Checkout Session ID (cs_test_...)
}
```

**What it does:**

1. **Validates appointment** - Checks that appointment exists and belongs to the tenant
2. **Loads services** - Fetches all services linked to the appointment
3. **Calculates total** - Sums up service prices in NOK
4. **Creates Stripe session** - Generates a Checkout session with:
   - Mode: `payment` (one-time payment, not subscription)
   - Currency: `nok` (Norwegian Krone)
   - Amount: Total in øre (NOK * 100)
   - Product name: `Timebestilling #{appointmentId}`
   - Metadata: `tenantId`, `appointmentId`, `type: "appointment_payment"`
5. **Stores payment record** - Inserts into `payments` table with status `pending`
6. **Returns checkout URL** - Frontend redirects user to this URL

**Multi-tenant enforcement:**
- Appointment must belong to the user's tenant
- Payment record includes `tenantId`
- Cross-tenant access is blocked

---

## Database Schema

The `payments` table was extended with these columns:

| Column | Type | Description |
|--------|------|-------------|
| `appointmentId` | INT NULL | Links payment to appointment |
| `currency` | VARCHAR(3) | Payment currency (default: NOK) |
| `paymentGateway` | ENUM('stripe', 'vipps') | Which gateway was used |
| `gatewayPaymentId` | VARCHAR(255) | Stripe Payment Intent ID |
| `gatewaySessionId` | VARCHAR(255) | Stripe Checkout Session ID |
| `gatewayMetadata` | JSON | Additional gateway data |

**Note:** The `orderId` column was also made nullable to support appointment payments without orders.

---

## Frontend Usage

### React Component Example

```typescript
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function AppointmentPaymentButton({ appointmentId }: { appointmentId: number }) {
  const createCheckoutSession = trpc.payments.createCheckoutSession.useMutation();

  async function handlePay() {
    try {
      const origin = window.location.origin;
      const result = await createCheckoutSession.mutateAsync({
        appointmentId,
        successUrl: `${origin}/booking/success?appointmentId=${appointmentId}`,
        cancelUrl: `${origin}/booking/cancel?appointmentId=${appointmentId}`,
      });

      if (result?.url) {
        // Redirect to Stripe Checkout
        window.location.href = result.url;
      }
    } catch (error) {
      toast.error("Failed to create payment session");
      console.error(error);
    }
  }

  return (
    <Button
      onClick={handlePay}
      disabled={createCheckoutSession.isPending}
    >
      {createCheckoutSession.isPending ? "Processing..." : "Pay Now"}
    </Button>
  );
}
```

### Success/Cancel Pages

After payment, Stripe redirects to your success or cancel URL. You should create these pages:

**Success Page (`/booking/success`):**
```typescript
import { useSearchParams } from "wouter";
import { trpc } from "@/lib/trpc";

export function BookingSuccess() {
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get("appointmentId");

  // Optionally verify payment status
  const { data: appointment } = trpc.appointments.getById.useQuery({
    id: Number(appointmentId),
  });

  return (
    <div>
      <h1>Payment Successful!</h1>
      <p>Your appointment #{appointmentId} has been confirmed.</p>
      <p>You will receive a confirmation SMS shortly.</p>
    </div>
  );
}
```

**Cancel Page (`/booking/cancel`):**
```typescript
export function BookingCancel() {
  return (
    <div>
      <h1>Payment Canceled</h1>
      <p>Your appointment is still pending. You can complete payment later.</p>
    </div>
  );
}
```

---

## Testing

### Unit Tests

**File:** `server/payments.test.ts`

Three test cases are implemented:

1. **✅ Should create a Stripe Checkout session for an appointment**
   - Creates test tenant, employee, customer, service, appointment
   - Calls `createCheckoutSession` mutation
   - Verifies Stripe session URL is returned
   - Verifies payment record is created in database

2. **✅ Should throw NOT_FOUND error for non-existent appointment**
   - Attempts to create session for appointmentId 999999
   - Verifies proper error handling

3. **✅ Should enforce multi-tenant isolation**
   - Creates two separate tenants
   - Attempts to access appointment from different tenant
   - Verifies cross-tenant access is blocked

**Run tests:**
```bash
pnpm test server/payments.test.ts
```

---

## What's NOT Implemented (Future Work)

### ❌ Stripe Webhook Handler
**Why needed:** To update payment status when Stripe confirms payment

**What to implement:**
1. Express endpoint: `POST /api/stripe/webhook`
2. Verify webhook signature
3. Handle events:
   - `checkout.session.completed` → update payment status to `completed`
   - `payment_intent.succeeded` → confirm payment
   - `payment_intent.payment_failed` → mark as `failed`
4. Update appointment status to `confirmed` after successful payment

### ❌ POS (Point of Sale) System
**Why needed:** For in-person cash/card payments

**What to implement:**
1. `payments.recordCashPayment` mutation
2. `payments.recordCardPayment` mutation
3. POS UI for staff to record payments

### ❌ Refund Processing
**Why needed:** To handle cancellations and refunds

**What to implement:**
1. `payments.refund` mutation
2. Stripe refund API integration
3. Refund record in database

### ❌ Payment History UI
**Why needed:** For admins to view all payments

**What to implement:**
1. `payments.list` query with filters
2. Admin page showing payment history
3. Export to CSV/Excel

---

## Files Created

| File | Purpose |
|------|---------|
| `server/stripe.ts` | Stripe client initialization |
| `server/payments.test.ts` | Unit tests for payments router |
| `STRIPE_CHECKOUT_INTEGRATION.md` | This documentation |

## Files Modified

| File | Changes |
|------|---------|
| `server/_core/env.ts` | Added Stripe environment variables |
| `server/db.ts` | Added payment database helpers |
| `server/routers.ts` | Added payments router with createCheckoutSession |
| `package.json` | Added `stripe@20.0.0` dependency |

---

## How to Trigger the Mutation

### From tRPC Client (React)

```typescript
const createSession = trpc.payments.createCheckoutSession.useMutation();

const result = await createSession.mutateAsync({
  appointmentId: 123,
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
});

// Redirect to Stripe
window.location.href = result.url;
```

### From Server-Side (tRPC Caller)

```typescript
import { appRouter } from "./server/routers";

const caller = appRouter.createCaller({
  user: { id: 1, tenantId: "tenant-123", role: "owner", ... },
  req: {} as any,
  res: {} as any,
});

const result = await caller.payments.createCheckoutSession({
  appointmentId: 123,
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
});

console.log(result.url); // https://checkout.stripe.com/...
```

---

## Security Considerations

1. **Stripe Secret Key** - Never expose in frontend code
2. **Webhook Signature** - Always verify in webhook handler (not yet implemented)
3. **Multi-Tenant Isolation** - Enforced via `tenantProcedure` middleware
4. **Amount Validation** - Total must be > 0
5. **Appointment Ownership** - User can only pay for their tenant's appointments

---

## Next Steps

1. **Implement webhook handler** to complete the payment flow
2. **Add payment status check** to appointment details page
3. **Integrate into public booking flow** to require prepayment
4. **Add POS functionality** for in-person payments
5. **Build payment history UI** for admins

---

## Support

For questions or issues:
- Check Stripe Dashboard: https://dashboard.stripe.com
- Review Stripe API docs: https://stripe.com/docs/api
- Test mode uses `sk_test_...` keys and `cs_test_...` session IDs
