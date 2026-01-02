# Payment Pages Structure - Stylora

## Overview
Stylora has **4 different payment-related pages**, each serving a distinct purpose. There are **NO duplicate pages**.

## Page Breakdown

### 1. Payment Providers (`/payment-providers`)
**File**: `client/src/pages/PaymentProviders.tsx`

**Purpose**: Manage payment terminal providers and methods

**Features**:
- Add/edit/delete payment providers
- Configure different provider types:
  - Stripe Terminal
  - Vipps
  - Nets/BankAxept
  - Manual Card
  - Cash
  - Generic providers
- Set default payment method
- Test provider connections
- Configure provider-specific settings (API keys, merchant IDs, etc.)

**User Access**: Admin only

**Norwegian Title**: "Betalingsterminaler"

---

### 2. iZettle Settings (`/izettle-settings`)
**File**: `client/src/pages/IZettleSettings.tsx`

**Purpose**: Configure iZettle payment integration via OAuth

**Features**:
- Connect to iZettle account via OAuth
- View connection status
- Disconnect iZettle account
- Display last sync timestamp
- Show iZettle integration benefits
- Informational cards about features

**User Access**: Admin only (Advanced Mode)

**Norwegian Title**: "iZettle Innstillinger"

**Integration**: Uses OAuth 2.0 flow with iZettle API

---

### 3. Reader Management (`/reader-management`)
**File**: `client/src/pages/ReaderManagement.tsx`

**Purpose**: Manage Stripe Terminal card readers

**Features**:
- Initialize Stripe Terminal SDK
- Discover available card readers
- Connect to card readers
- View registered readers from Stripe account
- Handle reader disconnection
- Test reader connections
- Simulated mode for testing

**User Access**: Admin only

**Norwegian Title**: "قارئات البطاقات" (Arabic - Card Readers)

**Integration**: Uses Stripe Terminal JavaScript SDK

---

### 4. Payment History (`/payment-history`)
**File**: `client/src/pages/PaymentHistory.tsx`

**Purpose**: View historical payment transactions

**Features**:
- List all payment transactions
- Filter by date range
- Filter by payment method
- View transaction details
- Display payment status
- Show customer information
- Export payment reports

**User Access**: Admin only

**Norwegian Title**: "Betalingshistorikk"

---

### 5. POS Payment (`/pos-payment`)
**File**: `client/src/pages/POSPayment.tsx`

**Purpose**: Process point-of-sale payments in salon

**Features**:
- Quick payment processing interface
- Select payment method
- Enter payment amount
- Process card payments via terminal
- Record cash payments
- Generate receipts
- Link payments to appointments/orders

**User Access**: Admin and Employees

**Norwegian Title**: "Salgssted (POS)"

---

## Page Relationships

```
Payment System
├── Payment Providers (/payment-providers)
│   ├── Configure payment methods
│   └── Manage provider settings
│
├── iZettle Settings (/izettle-settings)
│   ├── OAuth connection to iZettle
│   └── iZettle-specific configuration
│
├── Reader Management (/reader-management)
│   ├── Stripe Terminal readers
│   └── Hardware device management
│
├── Payment History (/payment-history)
│   ├── View past transactions
│   └── Generate reports
│
└── POS Payment (/pos-payment)
    ├── Process new payments
    └── Real-time payment interface
```

## Navigation Structure

All payment pages are accessible from the sidebar menu:

```
Dashboard
├── ...
├── Betalinger (Payments Section)
│   ├── Betalingsterminaler (/payment-providers)
│   ├── iZettle (/izettle-settings)
│   ├── Salgssted (POS) (/pos-payment)
│   └── Betalingshistorikk (/payment-history)
│
└── Avansert modus (Advanced Mode)
    └── Reader Management (/reader-management)
```

## Database Tables Used

### Payment Providers Page
- `paymentProviders` - Stores provider configurations

### iZettle Settings Page
- `paymentProviders` - Stores iZettle OAuth tokens (encrypted)

### Reader Management Page
- Uses Stripe API (no local database storage)

### Payment History Page
- `payments` - Transaction records
- `appointments` - Linked appointments
- `orders` - Linked orders

### POS Payment Page
- `payments` - Creates new payment records
- `appointments` - Links to appointments
- `orders` - Links to orders

## API Endpoints

### Payment Providers
- `trpc.paymentTerminal.listProviders`
- `trpc.paymentTerminal.addProvider`
- `trpc.paymentTerminal.updateProvider`
- `trpc.paymentTerminal.deleteProvider`
- `trpc.paymentTerminal.testConnection`

### iZettle Settings
- `trpc.izettle.getStatus`
- `trpc.izettle.getAuthUrl`
- `trpc.izettle.disconnect`
- `/api/izettle/callback` (OAuth callback)

### Reader Management
- `trpc.stripeTerminal.createConnectionToken`
- `trpc.stripeTerminal.listReaders`
- Uses Stripe Terminal SDK client-side

### Payment History
- `trpc.payments.list`
- `trpc.payments.getById`
- `trpc.payments.export`

### POS Payment
- `trpc.payments.create`
- `trpc.payments.processCard`
- `trpc.payments.recordCash`

## Conclusion

All 5 payment pages serve **unique, non-overlapping purposes**:

1. **Payment Providers** = Configure payment methods
2. **iZettle Settings** = Connect iZettle account
3. **Reader Management** = Manage Stripe card readers
4. **Payment History** = View past transactions
5. **POS Payment** = Process new payments

**No duplicates exist.** Each page is essential for the complete payment workflow.

---

**Last Updated**: December 18, 2024  
**Status**: ✅ Structure Verified
