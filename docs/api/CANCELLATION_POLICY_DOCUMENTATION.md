# Cancellation & No-Show Policy System

Complete guide for configuring and using the cancellation and no-show policy system in Stylora.

---

## Overview

Stylora now includes a configurable cancellation and no-show policy system that helps salons:

1. **Track late cancellations** - Identify when customers cancel inside the cancellation window
2. **Monitor no-show patterns** - Count how many times a customer has failed to show up
3. **Enforce prepayment policies** - Know when a customer has reached the no-show threshold

**Key Features:**
- Per-tenant policy configuration (each salon sets their own rules)
- Automatic late cancellation detection based on cancellation window
- No-show count tracking per customer
- API endpoints to check customer no-show status
- Multi-tenant safe (all queries filtered by tenantId)

---

## Database Schema

### Tenants Table - Policy Fields

```typescript
cancellationWindowHours: int (default: 24)
// Number of hours before appointment after which cancellation is considered "late"
// Example: If set to 24, canceling less than 24 hours before appointment = late

noShowThresholdForPrepayment: int (default: 2)
// Maximum allowed no-shows before requiring prepayment
// Example: If set to 2, customer with 2+ no-shows should be flagged
```

### Appointments Table - Cancellation Tracking

```typescript
isLateCancellation: boolean (default: false)
// true = canceled inside cancellation window (policy violated)
// false = canceled outside cancellation window (policy respected)
```

---

## How It Works

### Late Cancellation Detection

When an appointment status is changed to `"canceled"`, the system:

1. **Loads tenant's `cancellationWindowHours`** (default: 24)
2. **Calculates appointment start time** (appointmentDate + startTime)
3. **Calculates cancellation deadline** (appointment start - cancellationWindowHours)
4. **Compares current time with deadline:**
   - If `now > deadline` → `isLateCancellation = true` (late)
   - If `now <= deadline` → `isLateCancellation = false` (on time)

**Example:**

```
Appointment: March 25, 2026 at 14:00
Cancellation window: 24 hours
Cancellation deadline: March 24, 2026 at 14:00

Scenario A: Customer cancels on March 24 at 10:00 → isLateCancellation = false ✅
Scenario B: Customer cancels on March 24 at 16:00 → isLateCancellation = true ❌
```

### No-Show Count Tracking

The system counts how many appointments a customer has with `status = "no_show"`.

**Helper function:**

```typescript
import { getNoShowCountForCustomer } from "./server/db";

const count = await getNoShowCountForCustomer(tenantId, customerId);
// Returns: number of no-shows for this customer
```

**API endpoint:**

```typescript
const noShowInfo = await trpc.customers.getNoShowInfo.useQuery({
  customerId: 123,
});

// Returns:
// {
//   customerId: 123,
//   noShowCount: 2,
//   noShowThresholdForPrepayment: 2,
//   hasReachedThreshold: true
// }
```

---

## Configuration

### Per-Tenant Settings

Each salon can configure their own policy via the `tenants` table:

**Default Settings:**

```sql
UPDATE tenants 
SET cancellationWindowHours = 24,
    noShowThresholdForPrepayment = 2
WHERE id = 'your-tenant-id';
```

**Custom Settings Examples:**

```sql
-- Strict policy: 48-hour cancellation window, 1 no-show threshold
UPDATE tenants 
SET cancellationWindowHours = 48,
    noShowThresholdForPrepayment = 1
WHERE id = 'strict-salon';

-- Lenient policy: 12-hour cancellation window, 3 no-show threshold
UPDATE tenants 
SET cancellationWindowHours = 12,
    noShowThresholdForPrepayment = 3
WHERE id = 'lenient-salon';
```

---

## API Reference

### 1. Update Appointment Status (with late cancellation detection)

**Endpoint:** `appointments.updateStatus`

**Input:**

```typescript
{
  id: number;                    // Appointment ID
  status: "pending" | "confirmed" | "completed" | "canceled" | "no_show";
  cancellationReason?: string;   // Optional reason for cancellation
}
```

**Behavior:**

- When `status = "canceled"`:
  - Sets `canceledAt = now`
  - Sets `canceledBy = "staff"`
  - Sets `cancellationReason = input.cancellationReason`
  - **Calculates `isLateCancellation` based on tenant policy**

- When `status = "no_show"`:
  - Updates appointment status
  - No-show count increases (queryable via `getNoShowInfo`)

**Example:**

```typescript
const result = await trpc.appointments.updateStatus.mutate({
  id: 456,
  status: "canceled",
  cancellationReason: "Customer called to cancel",
});

// Check if it was a late cancellation
const appointment = await trpc.appointments.getById.query({ id: 456 });
console.log(appointment.isLateCancellation); // true or false
```

### 2. Get Customer No-Show Info

**Endpoint:** `customers.getNoShowInfo`

**Input:**

```typescript
{
  customerId: number;
}
```

**Output:**

```typescript
{
  customerId: number;
  noShowCount: number;                     // Total no-shows for this customer
  noShowThresholdForPrepayment: number;    // Tenant's threshold setting
  hasReachedThreshold: boolean;            // true if noShowCount >= threshold
}
```

**Example:**

```typescript
const info = await trpc.customers.getNoShowInfo.query({
  customerId: 123,
});

if (info.hasReachedThreshold) {
  console.log(`Customer has ${info.noShowCount} no-shows - prepayment recommended`);
}
```

---

## Frontend Integration

### Display Late Cancellation Warning

```tsx
import { trpc } from "@/lib/trpc";

function AppointmentDetails({ appointmentId }: { appointmentId: number }) {
  const { data: appointment } = trpc.appointments.getById.useQuery({ id: appointmentId });

  return (
    <div>
      <h2>Appointment Details</h2>
      <p>Status: {appointment?.status}</p>
      
      {appointment?.status === "canceled" && appointment?.isLateCancellation && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          ⚠️ Late Cancellation - Canceled inside cancellation window
        </div>
      )}
    </div>
  );
}
```

### Display No-Show Warning

```tsx
import { trpc } from "@/lib/trpc";

function CustomerCard({ customerId }: { customerId: number }) {
  const { data: customer } = trpc.customers.getById.useQuery({ id: customerId });
  const { data: noShowInfo } = trpc.customers.getNoShowInfo.useQuery({ customerId });

  return (
    <div>
      <h3>{customer?.firstName} {customer?.lastName}</h3>
      
      {noShowInfo?.hasReachedThreshold && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
          ⚠️ {noShowInfo.noShowCount} no-shows - Consider requiring prepayment
        </div>
      )}
    </div>
  );
}
```

### Booking Flow with Prepayment Check

```tsx
import { trpc } from "@/lib/trpc";

function BookingForm({ customerId }: { customerId: number }) {
  const { data: noShowInfo } = trpc.customers.getNoShowInfo.useQuery({ customerId });
  const [requirePrepayment, setRequirePrepayment] = useState(false);

  useEffect(() => {
    if (noShowInfo?.hasReachedThreshold) {
      setRequirePrepayment(true);
    }
  }, [noShowInfo]);

  return (
    <div>
      <h2>Book Appointment</h2>
      
      {requirePrepayment && (
        <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-4">
          ℹ️ Prepayment required due to previous no-shows
        </div>
      )}

      {/* Booking form fields */}
      
      {requirePrepayment ? (
        <button onClick={() => createBookingWithPayment()}>
          Book & Pay Now
        </button>
      ) : (
        <button onClick={() => createBooking()}>
          Book Appointment
        </button>
      )}
    </div>
  );
}
```

---

## Business Logic Examples

### Scenario 1: Late Cancellation Fee

```typescript
// When appointment is canceled late, optionally charge a fee
const appointment = await trpc.appointments.getById.query({ id: 456 });

if (appointment.isLateCancellation) {
  // Option A: Manual fee (staff notes it)
  console.log("Late cancellation - charge 50% fee");
  
  // Option B: Automatic fee (future enhancement)
  // await trpc.payments.chargeCancellationFee.mutate({
  //   appointmentId: 456,
  //   amount: "50.00",
  // });
}
```

### Scenario 2: Prepayment Enforcement

```typescript
// Before creating booking, check no-show status
const noShowInfo = await trpc.customers.getNoShowInfo.query({
  customerId: 123,
});

if (noShowInfo.hasReachedThreshold) {
  // Require prepayment
  const checkoutSession = await trpc.payments.createCheckoutSession.mutate({
    appointmentId: 789,
    amount: "100.00", // Full amount or deposit
  });
  
  // Redirect to Stripe Checkout
  window.location.href = checkoutSession.url;
} else {
  // Allow booking without payment
  await trpc.publicBooking.createBooking.mutate({
    customerId: 123,
    // ... other fields
  });
}
```

### Scenario 3: Customer Communication

```typescript
// When marking appointment as no-show
await trpc.appointments.updateStatus.mutate({
  id: 456,
  status: "no_show",
});

// Check if customer has reached threshold
const noShowInfo = await trpc.customers.getNoShowInfo.query({
  customerId: 123,
});

if (noShowInfo.hasReachedThreshold) {
  // Send notification
  console.log(`Customer ${customerId} has reached no-show threshold`);
  // Future: Send SMS/email notification about prepayment policy
}
```

---

## Testing

### Run Tests

```bash
pnpm test server/cancellation-policy.test.ts
```

**Test Coverage:**

- ✅ Late cancellation detection (inside window)
- ✅ Normal cancellation detection (outside window)
- ✅ No-show count tracking
- ✅ Threshold detection (hasReachedThreshold)
- ✅ Custom tenant policy configuration (48-hour window)

### Manual Testing

**Test Late Cancellation:**

1. Create appointment for tomorrow
2. Cancel it today
3. Check `isLateCancellation` should be `true`

**Test Normal Cancellation:**

1. Create appointment for next week
2. Cancel it today
3. Check `isLateCancellation` should be `false`

**Test No-Show Tracking:**

1. Create 2 appointments
2. Mark both as `no_show`
3. Call `getNoShowInfo` → should return `noShowCount: 2, hasReachedThreshold: true`

---

## Future Enhancements

Potential improvements for the policy system:

1. **Automatic cancellation fees** - Charge Stripe automatically for late cancellations
2. **Refund policies** - Partial refunds based on cancellation timing
3. **Customer notifications** - Auto-send SMS/email when no-show threshold reached
4. **Admin dashboard** - View all late cancellations and no-shows in reports
5. **Prepayment enforcement** - Block booking without payment if threshold reached
6. **Whitelist/blacklist** - Override policy for VIP customers or ban repeat offenders
7. **Grace periods** - Allow 1 free no-show before enforcing policy

---

## Code Reference

### Key Files

- **`drizzle/schema.ts`** - Database schema with policy fields
- **`server/db.ts`** - `getNoShowCountForCustomer` helper
- **`server/routers.ts`** - `appointments.updateStatus` with late cancellation logic
- **`server/routers.ts`** - `customers.getNoShowInfo` endpoint
- **`server/cancellation-policy.test.ts`** - Test suite

### Database Helpers

```typescript
// Get no-show count for customer
import { getNoShowCountForCustomer } from "./server/db";

const count = await getNoShowCountForCustomer(tenantId, customerId);
```

### tRPC Endpoints

```typescript
// Update appointment status (handles late cancellation)
await trpc.appointments.updateStatus.mutate({
  id: 456,
  status: "canceled",
  cancellationReason: "Customer request",
});

// Get customer no-show info
const info = await trpc.customers.getNoShowInfo.query({
  customerId: 123,
});
```

---

## Support

For issues or questions:

1. Check tenant policy settings in database
2. Review test suite for examples
3. Verify appointment date/time calculations
4. Check console logs for late cancellation detection
5. Contact support with specific appointment IDs

**Cancellation policy system is production-ready and tested!** 🎉
