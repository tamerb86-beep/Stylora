# Stylora Codebase Analysis Report
## Payments / Billing / Stripe / POS / Appointments / Multi-Tenant

**Date:** November 29, 2025  
**Analyst:** Manus AI  
**Purpose:** Analyze existing implementation before adding Stripe checkout and POS features

---

## Executive Summary

The Stylora codebase has **comprehensive database schemas** for payments, appointments, and multi-tenant isolation, but **NO payment processing logic** has been implemented yet. The database is ready, but all Stripe integration, POS functionality, and payment workflows need to be built from scratch.

**Key Findings:**
- ✅ Database schemas are complete and well-designed
- ✅ Appointments/booking system is fully functional
- ✅ Multi-tenant isolation is properly implemented
- ❌ Zero Stripe integration code exists
- ❌ No payment processing procedures in tRPC
- ❌ No POS (Point of Sale) functionality
- ❌ No Stripe webhook handling

---

## 1. Drizzle Schemas

### 1.1 Payments Table

**File:** `/home/ubuntu/stylora/drizzle/schema.ts` (lines 265-288)

**Schema:**
```typescript
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  orderId: int("orderId"), // For product sales
  appointmentId: int("appointmentId"), // For appointment bookings
  paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "vipps", "stripe"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NOK").notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending"),
  paymentGateway: mysqlEnum("paymentGateway", ["stripe", "vipps"]),
  gatewayPaymentId: varchar("gatewayPaymentId", { length: 255 }), // Stripe Payment Intent ID
  gatewaySessionId: varchar("gatewaySessionId", { length: 255 }), // Stripe Checkout Session ID
  gatewayMetadata: json("gatewayMetadata"),
  lastFour: varchar("lastFour", { length: 4 }),
  cardBrand: varchar("cardBrand", { length: 20 }),
  errorMessage: text("errorMessage"),
  processedBy: int("processedBy"),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
```

**Entities:**
- `payments` - Main payment records
- `refunds` - Refund tracking (lines 290-301)

**Payment Status Enum:**
- `pending` - Payment initiated but not completed
- `completed` - Payment successful
- `failed` - Payment failed
- `refunded` - Payment refunded

**Payment Method Enum:**
- `cash` - Cash payment
- `card` - Card payment (generic)
- `vipps` - Norwegian mobile payment
- `stripe` - Stripe payment

**Notes:**
- Schema is **Stripe-ready** with `gatewayPaymentId` and `gatewaySessionId` fields
- Supports both appointment payments (`appointmentId`) and product sales (`orderId`)
- Multi-tenant isolation via `tenantId`
- Includes refund tracking in separate table
- **NO CODE USES THIS TABLE YET** - completely unused

---

### 1.2 Orders Table

**File:** `/home/ubuntu/stylora/drizzle/schema.ts` (lines 229-259)

**Schema:**
```typescript
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  appointmentId: int("appointmentId"), // NULL if standalone product sale
  customerId: int("customerId"),
  employeeId: int("employeeId").notNull(),
  orderDate: date("orderDate").notNull(),
  orderTime: time("orderTime").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  vatAmount: decimal("vatAmount", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "completed", "refunded", "partially_refunded"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  itemType: mysqlEnum("itemType", ["service", "product"]).notNull(),
  itemId: int("itemId").notNull(), // References services.id or products.id
  quantity: int("quantity").default(1),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  lineTotal: decimal("lineTotal", { precision: 10, scale: 2 }).notNull(),
});
```

**Order Status Enum:**
- `pending` - Order created but not paid
- `completed` - Order paid and fulfilled
- `refunded` - Full refund issued
- `partially_refunded` - Partial refund issued

**Notes:**
- Supports both appointment-linked orders and standalone product sales
- VAT calculation built into schema (Norwegian 25% VAT)
- Line items can be services OR products
- **NO CODE USES THIS TABLE YET** - completely unused

---

### 1.3 Appointments Table

**File:** `/home/ubuntu/stylora/drizzle/schema.ts` (lines 137-186)

**Schema:**
```typescript
export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  employeeId: int("employeeId").notNull(),
  appointmentDate: date("appointmentDate").notNull(),
  startTime: time("startTime").notNull(),
  endTime: time("endTime").notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "completed", "canceled", "no_show"]).default("pending"),
  cancellationReason: text("cancellationReason"),
  canceledBy: mysqlEnum("canceledBy", ["customer", "staff", "system"]),
  canceledAt: timestamp("canceledAt"),
  notes: text("notes"),
  recurrenceRuleId: int("recurrenceRuleId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const appointmentServices = mysqlTable("appointmentServices", {
  id: int("id").autoincrement().primaryKey(),
  appointmentId: int("appointmentId").notNull(),
  serviceId: int("serviceId").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
});

export const recurrenceRules = mysqlTable("recurrenceRules", {
  // Schema for recurring appointments (not yet implemented)
});
```

**Appointment Status Enum:**
- `pending` - Appointment booked but not confirmed
- `confirmed` - Appointment confirmed
- `completed` - Service delivered
- `canceled` - Appointment canceled
- `no_show` - Customer didn't show up

**Notes:**
- **FULLY IMPLEMENTED** - appointments system works end-to-end
- Multi-service appointments supported via `appointmentServices` junction table
- Recurrence rules schema exists but not implemented yet
- Proper indexing for performance (tenant + date + employee)

---

### 1.4 Subscription & Billing Tables

**File:** `/home/ubuntu/stylora/drizzle/schema.ts` (lines 378-404)

**Schema:**
```typescript
export const subscriptionPlans = mysqlTable("subscriptionPlans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  displayNameNo: varchar("displayNameNo", { length: 100 }).notNull(),
  priceMonthly: decimal("priceMonthly", { precision: 10, scale: 2 }).notNull(),
  maxEmployees: int("maxEmployees"),
  maxLocations: int("maxLocations"),
  smsQuota: int("smsQuota"),
  features: json("features"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const tenantSubscriptions = mysqlTable("tenantSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  planId: int("planId").notNull(),
  status: mysqlEnum("status", ["active", "past_due", "canceled", "paused"]).default("active"),
  currentPeriodStart: date("currentPeriodStart").notNull(),
  currentPeriodEnd: date("currentPeriodEnd").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
```

**Notes:**
- Schema includes `stripeSubscriptionId` for Stripe Billing integration
- Designed for SaaS subscription model (monthly plans)
- **NO CODE USES THIS YET** - subscription logic not implemented

---

### 1.5 Multi-Tenant Tables

**File:** `/home/ubuntu/stylora/drizzle/schema.ts` (lines 27-69)

**Schema:**
```typescript
export const tenants = mysqlTable("tenants", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  name: varchar("name", { length: 255 }).notNull(),
  subdomain: varchar("subdomain", { length: 63 }).notNull().unique(),
  orgNumber: varchar("orgNumber", { length: 9 }), // Norwegian org number
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  logoUrl: text("logoUrl"),
  primaryColor: varchar("primaryColor", { length: 7 }),
  timezone: varchar("timezone", { length: 50 }).default("Europe/Oslo"),
  currency: varchar("currency", { length: 3 }).default("NOK"),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("25.00"),
  status: mysqlEnum("status", ["trial", "active", "suspended", "canceled"]).default("trial"),
  trialEndsAt: timestamp("trialEndsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }),
  name: text("name"),
  phone: varchar("phone", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["owner", "admin", "employee"]).notNull(),
  // ... other fields
});
```

**Notes:**
- Every data table includes `tenantId` for row-level isolation
- Norwegian-specific: `orgNumber`, `vatRate` (25%), timezone (`Europe/Oslo`)
- Tenant status tracks trial/active/suspended/canceled states

---

## 2. tRPC Routers

### 2.1 Appointments Router

**File:** `/home/ubuntu/stylora/server/routers.ts` (lines 242-418)

**Procedures:**

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | tenant | Get appointments by date range for tenant |
| `getById` | query | tenant | Get single appointment details |
| `create` | mutation | tenant | Create new appointment with services |
| `reschedule` | mutation | tenant | Change appointment date/time |
| `updateStatus` | mutation | tenant | Update status (pending/confirmed/completed/canceled/no_show) |

**Key Implementation Details:**

```typescript
// Multi-tenant enforcement
const tenantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
  }
  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.user.tenantId,
    },
  });
});

// Example query with tenantId
appointments.list: tenantProcedure
  .input(z.object({ startDate: z.date(), endDate: z.date() }))
  .query(async ({ ctx, input }) => {
    return db.getAppointmentsByTenant(ctx.tenantId, input.startDate, input.endDate);
  })
```

**Notes:**
- **FULLY FUNCTIONAL** - all CRUD operations work
- Automatic loyalty points awarded when status changes to `completed`
- Multi-service appointments supported
- **NO PAYMENT INTEGRATION** - appointments are created without payment

---

### 2.2 Public Booking Router

**File:** `/home/ubuntu/stylora/server/routers.ts` (lines 1329-1610)

**Procedures:**

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getSalonInfo` | query | public | Get salon details by tenantId |
| `getAvailableServices` | query | public | List active services |
| `getAvailableEmployees` | query | public | List active employees |
| `getAvailableTimeSlots` | query | public | Generate available time slots for date/service |
| `createBooking` | mutation | public | Create appointment from public booking form |

**Booking Flow:**

1. Customer selects service → `getAvailableServices`
2. Customer selects employee (optional) → `getAvailableEmployees`
3. Customer selects date → `getAvailableTimeSlots`
4. Customer fills contact info → `createBooking`
5. **NO PAYMENT STEP** - appointment created with status `pending`

**Notes:**
- **FULLY FUNCTIONAL** - public booking works
- Time slot generation: 8:00-20:00, 30-minute intervals
- Conflict detection prevents double-booking
- Auto-creates customer if phone number doesn't exist
- **MISSING:** Payment collection, prepayment requirement, deposit handling

---

### 2.3 Payment Routers

**Status:** ❌ **DOES NOT EXIST**

**Search Results:**
- No `payments:` router found in `routers.ts`
- No `stripe:` router found
- No `checkout:` router found
- No payment-related procedures anywhere

**What's Missing:**
- Create order endpoint
- Process payment endpoint
- Stripe checkout session creation
- Stripe webhook handler
- POS cash/card payment recording
- Refund processing
- Payment status queries

---

### 2.4 Existing Routers Summary

**File:** `/home/ubuntu/stylora/server/routers.ts` (1983 lines)

**All Routers:**

| Router | Status | Lines | Description |
|--------|--------|-------|-------------|
| `auth` | ✅ Complete | 53-60 | Login/logout |
| `customers` | ✅ Complete | 65-170 | Customer CRUD |
| `services` | ✅ Complete | 171-241 | Service CRUD |
| `appointments` | ✅ Complete | 242-418 | Appointment management |
| `employees` | ✅ Complete | 423-581 | Employee management |
| `products` | ✅ Complete | 582-654 | Product inventory |
| `loyalty` | ✅ Complete | 655-846 | Loyalty points system |
| `employee` | ✅ Complete | 847-1195 | Employee dashboard |
| `notifications` | ✅ Complete | 1196-1232 | Notification log |
| `financial` | ✅ Complete | 1233-1328 | Financial reports |
| `publicBooking` | ✅ Complete | 1329-1610 | Public booking flow |
| `analytics` | ✅ Complete | 1615-1773 | Analytics charts |
| `attendance` | ✅ Complete | 1774-1942 | Time clock/timesheets |
| `dashboard` | ✅ Complete | 1943-1983 | Dashboard stats |
| **`payments`** | ❌ **MISSING** | - | **NOT IMPLEMENTED** |
| **`pos`** | ❌ **MISSING** | - | **NOT IMPLEMENTED** |
| **`checkout`** | ❌ **MISSING** | - | **NOT IMPLEMENTED** |

---

## 3. Stripe Integration

### 3.1 Existing Stripe Code

**Status:** ❌ **ZERO STRIPE CODE EXISTS**

**Search Results:**
- No `stripe.ts` file
- No `lib/stripe.ts` file
- No `utils/stripe.ts` file
- No Stripe imports in any server file
- No Stripe SDK in `package.json`

**Environment Variables:**

**File:** `/home/ubuntu/stylora/server/_core/env.ts`

```typescript
export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // NO STRIPE KEYS
};
```

**Notes:**
- According to webdev config, Stripe secrets exist: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`
- These are injected by the platform but **NOT USED IN CODE**
- Need to add Stripe keys to `env.ts`
- Need to install `stripe` npm package

---

### 3.2 What Needs to Be Built

**Backend (Server-side):**

1. **Stripe Client Setup**
   - Create `/server/stripe.ts` helper file
   - Initialize Stripe SDK with secret key
   - Export reusable Stripe instance

2. **Checkout Session Creation**
   - tRPC procedure: `payments.createCheckoutSession`
   - Input: appointmentId OR cart items
   - Output: Stripe Checkout Session URL
   - Store session ID in database

3. **Webhook Handler**
   - Express endpoint: `POST /api/stripe/webhook`
   - Verify webhook signature
   - Handle events:
     - `checkout.session.completed` → update payment status
     - `payment_intent.succeeded` → mark as completed
     - `payment_intent.payment_failed` → mark as failed
     - `charge.refunded` → create refund record

4. **Payment Status Queries**
   - tRPC procedure: `payments.getByAppointment`
   - tRPC procedure: `payments.getByOrder`
   - tRPC procedure: `payments.list` (for admin)

5. **POS Payment Recording**
   - tRPC procedure: `payments.recordCash`
   - tRPC procedure: `payments.recordCard`
   - Manual payment entry for in-person transactions

**Frontend (Client-side):**

1. **Stripe Checkout Redirect**
   - Call `createCheckoutSession` mutation
   - Redirect to Stripe Checkout URL
   - Handle success/cancel redirects

2. **POS Interface**
   - Cart UI for selecting services/products
   - Payment method selection (cash/card/Stripe)
   - Receipt generation

---

## 4. Multi-Tenant Approach

### 4.1 How tenantId is Enforced

**Middleware Pattern:**

**File:** `/home/ubuntu/stylora/server/routers.ts` (lines 17-27)

```typescript
// Middleware to ensure user has tenant access
const tenantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
  }
  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.user.tenantId,
    },
  });
});
```

**Usage in Queries:**

```typescript
// Example: Get customers for current tenant
customers.list: tenantProcedure.query(async ({ ctx }) => {
  return db.getCustomersByTenant(ctx.tenantId);
});
```

**Database Helper Pattern:**

**File:** `/home/ubuntu/stylora/server/db.ts`

```typescript
export async function getCustomersByTenant(tenantId: string) {
  const db = await getDb();
  if (!db) return [];
  
  const { customers } = await import("../drizzle/schema");
  const { eq, isNull } = await import("drizzle-orm");
  
  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt)
      )
    );
}
```

**Key Points:**

1. **Context Injection:** `tenantId` is extracted from authenticated user
2. **Middleware Enforcement:** `tenantProcedure` ensures tenantId exists
3. **Query Filtering:** All database queries filter by `tenantId`
4. **No Cross-Tenant Access:** Users can only access their own tenant's data

**Role-Based Access:**

```typescript
// Owner/Admin only
const adminProcedure = tenantProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// Employee access
const employeeProcedure = tenantProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin" && ctx.user.role !== "employee") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Employee access required" });
  }
  return next({ ctx });
});
```

---

### 4.2 Multi-Tenant Payment Considerations

**For Stripe Integration:**

1. **Stripe Connected Accounts (Future):**
   - Each tenant could have their own Stripe account
   - Platform takes commission via Stripe Connect
   - **NOT NEEDED FOR MVP** - can use single Stripe account

2. **Payment Isolation:**
   - All payment records include `tenantId`
   - Webhook handler must validate tenantId from metadata
   - Prevent cross-tenant payment access

3. **Metadata Pattern:**
   ```typescript
   const session = await stripe.checkout.sessions.create({
     metadata: {
       tenantId: ctx.tenantId,
       appointmentId: input.appointmentId,
       customerId: input.customerId,
     },
     // ... other config
   });
   ```

4. **Webhook Validation:**
   ```typescript
   // In webhook handler
   const { tenantId, appointmentId } = event.data.object.metadata;
   
   // Verify appointment belongs to tenant
   const appointment = await db.getAppointmentById(appointmentId);
   if (appointment.tenantId !== tenantId) {
     throw new Error("Tenant mismatch");
   }
   ```

---

## 5. Database Helper Functions

**File:** `/home/ubuntu/stylora/server/db.ts`

**Existing Functions:**

| Function | Description |
|----------|-------------|
| `getDb()` | Get Drizzle instance |
| `upsertUser()` | Create/update user |
| `getUserByOpenId()` | Get user by OAuth ID |
| `getTenantBySubdomain()` | Get tenant by subdomain |
| `getTenantById()` | Get tenant by ID |
| `getCustomersByTenant()` | Get customers (filtered by tenant) |
| `getCustomerById()` | Get single customer |
| `getServicesByTenant()` | Get services (filtered by tenant) |
| `getServiceById()` | Get single service |
| `getAppointmentsByTenant()` | Get appointments (filtered by tenant + date range) |
| `getAppointmentById()` | Get single appointment |

**Missing Functions (Needed for Payments):**

```typescript
// Need to add these to db.ts
export async function createPayment(data: InsertPayment) { }
export async function getPaymentById(paymentId: number) { }
export async function getPaymentsByTenant(tenantId: string) { }
export async function getPaymentsByAppointment(appointmentId: number) { }
export async function updatePaymentStatus(paymentId: number, status: string) { }

export async function createOrder(data: InsertOrder) { }
export async function getOrderById(orderId: number) { }
export async function getOrdersByTenant(tenantId: string) { }
```

---

## 6. Recommendations

### 6.1 Best Place to Implement Payment Features

**Router Structure:**

```
server/
├── routers.ts (main file)
│   └── payments: router({
│         createCheckoutSession: tenantProcedure
│         recordCashPayment: tenantProcedure
│         recordCardPayment: tenantProcedure
│         getByAppointment: tenantProcedure
│         getByOrder: tenantProcedure
│         list: adminProcedure
│         refund: adminProcedure
│       })
│   └── pos: router({
│         createOrder: tenantProcedure
│         completeOrder: tenantProcedure
│         getOrderById: tenantProcedure
│       })
├── stripe.ts (NEW FILE)
│   └── export const stripe = new Stripe(...)
│   └── export function createCheckoutSession(...)
│   └── export function constructWebhookEvent(...)
├── db.ts (extend existing)
│   └── export async function createPayment(...)
│   └── export async function createOrder(...)
```

**Webhook Endpoint:**

```
server/_core/
├── index.ts (Express app)
│   └── app.post('/api/stripe/webhook', rawBodyParser, handleStripeWebhook)
├── webhooks.ts (NEW FILE)
│   └── export async function handleStripeWebhook(req, res)
```

---

### 6.2 Implementation Steps

**Phase 1: Stripe Checkout (Prepayment for Appointments)**

1. Install Stripe SDK: `pnpm add stripe`
2. Add Stripe keys to `server/_core/env.ts`
3. Create `server/stripe.ts` helper
4. Add `payments` router to `server/routers.ts`
5. Implement `createCheckoutSession` mutation
6. Create webhook handler in `server/_core/webhooks.ts`
7. Register webhook route in `server/_core/index.ts`
8. Add payment status display in frontend

**Phase 2: POS (In-Person Payments)**

1. Add `pos` router to `server/routers.ts`
2. Implement `createOrder` mutation (cart → order)
3. Implement `recordCashPayment` mutation
4. Implement `recordCardPayment` mutation
5. Build POS UI in frontend (cart + payment selection)
6. Add receipt generation

**Phase 3: Payment Management**

1. Add payment list/filter procedures
2. Add refund processing
3. Build payment history UI
4. Add financial reports integration

---

### 6.3 Reusable Types & Tables

**Existing Types to Reuse:**

```typescript
// From drizzle/schema.ts
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;
```

**Enums to Reuse:**

```typescript
// Payment status
type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

// Payment method
type PaymentMethod = "cash" | "card" | "vipps" | "stripe";

// Payment gateway
type PaymentGateway = "stripe" | "vipps";

// Order status
type OrderStatus = "pending" | "completed" | "refunded" | "partially_refunded";

// Appointment status
type AppointmentStatus = "pending" | "confirmed" | "completed" | "canceled" | "no_show";
```

---

### 6.4 Potential Problems / Inconsistencies

**1. No Payment Validation in Booking Flow**

**Problem:** Public booking creates appointments without payment, leading to:
- High no-show rates
- Revenue leakage
- Manual payment collection burden

**Solution:** Add optional prepayment requirement:
```typescript
// In publicBooking.createBooking
if (tenantSettings.requirePrepayment) {
  // Create pending appointment
  // Return checkout session URL
  // Only confirm appointment after payment
} else {
  // Current behavior: create pending appointment
}
```

**2. Appointment Status vs Payment Status Mismatch**

**Problem:** Appointment can be `completed` but payment is `pending`

**Solution:** Add validation:
```typescript
// In appointments.updateStatus
if (input.status === "completed") {
  const payment = await getPaymentByAppointment(input.id);
  if (!payment || payment.status !== "completed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Cannot complete appointment without payment"
    });
  }
}
```

**3. Missing Order Creation Flow**

**Problem:** `orders` table exists but no code creates orders

**Solution:** Implement POS flow:
1. Staff adds services/products to cart
2. System creates order with `status: "pending"`
3. Staff processes payment (cash/card/Stripe)
4. System updates order to `status: "completed"`
5. System creates payment record

**4. No Stripe Webhook Signature Verification**

**Problem:** Without signature verification, fake webhooks could manipulate payment status

**Solution:** Always verify webhook signature:
```typescript
const sig = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  req.body,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

**5. Multi-Tenant Stripe Account Strategy Unclear**

**Problem:** Should each tenant have their own Stripe account (Stripe Connect) or use single platform account?

**Current Recommendation:** 
- **MVP:** Single Stripe account, all payments go to platform
- **Future:** Migrate to Stripe Connect for tenant-specific accounts

**6. Currency Hardcoded to NOK**

**Problem:** Schema supports `currency` field but defaults to NOK everywhere

**Impact:** Not a problem for Norwegian market, but limits international expansion

**Solution:** Keep NOK default, add currency conversion logic later if needed

**7. VAT Calculation Not Automated**

**Problem:** Schema has `vatRate` fields but no code calculates VAT automatically

**Solution:** Add VAT calculation helper:
```typescript
export function calculateVAT(subtotal: number, vatRate: number) {
  const vatAmount = subtotal * (vatRate / 100);
  const totalAmount = subtotal + vatAmount;
  return { subtotal, vatAmount, totalAmount };
}
```

---

## 7. Summary

### What Exists ✅

- ✅ Complete database schemas for payments, orders, appointments
- ✅ Multi-tenant isolation properly implemented
- ✅ Appointments system fully functional
- ✅ Public booking flow works (without payment)
- ✅ Customer, service, product management complete
- ✅ Loyalty points system integrated with appointments

### What's Missing ❌

- ❌ Zero Stripe integration code
- ❌ No payment processing procedures
- ❌ No POS (Point of Sale) functionality
- ❌ No webhook handling
- ❌ No order creation flow
- ❌ No payment status tracking
- ❌ No refund processing

### Priority Implementation Order

1. **High Priority:** Stripe checkout for appointment prepayment
2. **High Priority:** Stripe webhook handler
3. **Medium Priority:** POS cash/card payment recording
4. **Medium Priority:** Order creation flow
5. **Low Priority:** Refund processing
6. **Low Priority:** Payment reports/analytics

### Estimated Effort

- **Stripe Checkout:** 1-2 days
- **Webhook Handler:** 1 day
- **POS System:** 2-3 days
- **Payment Management UI:** 2 days
- **Total:** 6-8 days for complete payment system

---

**End of Report**
