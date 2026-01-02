# Unimicro Integration Research

## Overview
Unimicro is a popular Norwegian ERP/accounting system with a comprehensive REST API. This document outlines the integration possibilities for Stylora.

## Authentication
- **Method**: OAuth 2.0 + OpenID Connect (OIDC)
- **Flow Options**:
  1. **Server Application** (Recommended for Stylora)
     - Certificate-based authentication
     - Server acts on behalf of companies without human interaction
     - Can request necessary permissions when activated on a company
     - Best for automated sync operations
  
  2. **Traditional Web Apps**
     - Authorization Code Flow with client secret
     - Suitable for ASP.NET Core MVC, Next.js
  
  3. **SPA/Mobile Apps**
     - Authorization Code Flow with PKCE
     - For public clients that cannot store secrets

## API Documentation
- **Base URL**: https://developer.unimicro.no/
- **Architecture**: REST API with JSON request/response
- **Documentation**: Swagger/OpenAPI format
- **API Docs**: https://developer.unimicro.no/docs

## Key API Endpoints for Stylora Integration

### 1. CustomerInvoice (Kundefaktura)
**Endpoint**: `/CustomerInvoice`

**Key Fields**:
- `CustomerID` (integer) - Customer reference
- `InvoiceDate` (Date) - Invoice date
- `InvoiceNumber` (string) - Invoice number
- `StatusCode` (integer) - Invoice status:
  - 42001 = Draft (Utkast)
  - 42002 = Invoiced (Fakturert)
  - 42003 = PartlyPaid (Delvis betalt)
  - 42004 = Paid (Betalt)
  - 42005 = Sold (Solgt)
  - 42006 = Credited (Kreditert)
  - 42007 = PartlyCredited (Delvis kreditert)
- `TaxExclusiveAmount` (decimal) - Amount excluding VAT
- `TaxInclusiveAmount` (decimal) - Amount including VAT
- `VatTotalsAmount` (decimal) - Total VAT amount
- `PaymentDueDate` (Date) - Payment due date
- `RestAmount` (decimal) - Remaining unpaid amount
- `Items` (CustomerInvoiceItem[]) - Invoice line items
- `CustomerName` (string) - Customer name
- `CustomerOrgNumber` (string) - Organization number
- `EmailAddress` (string) - Customer email
- `Comment` (string) - Invoice comment
- `OurReference` (string) - Internal reference
- `YourReference` (string) - Customer reference

**Use Case for Stylora**:
- Automatically create invoices in Unimicro when POS sales are completed
- Sync invoice status back to Stylora (paid/unpaid)
- Track outstanding invoices

### 2. Customer (Kunde)
**Endpoint**: `/Customer` (likely available)

**Use Case**:
- Sync Stylora customers to Unimicro
- Keep customer data consistent between systems
- Avoid duplicate data entry

### 3. Account (Konto)
**Endpoint**: `/Account`

**Use Case**:
- Map Stylora revenue categories to Unimicro chart of accounts
- Ensure proper accounting classification

### 4. Payment (Betaling)
**Endpoint**: `/Payment` or `/InvoicePayment`

**Use Case**:
- Record payments from Stylora POS in Unimicro
- Match payments to invoices
- Track cash vs card payments

## Integration Architecture for Stylora

### Recommended Approach: Server-to-Server Integration

```
Stylora Backend (Node.js/Express)
    ↓
OAuth 2.0 Certificate Authentication
    ↓
Unimicro API (REST)
    ↓
Accounting System
```

### Data Flow

1. **Daily Sales Sync** (Automated)
   - Every night at 23:00, sync completed orders from Stylora to Unimicro
   - Create CustomerInvoice records for each POS sale
   - Include line items (services + products)
   - Mark as "Invoiced" (StatusCode: 42002)

2. **Customer Sync** (Bi-directional)
   - When new customer created in Stylora → create in Unimicro
   - When customer updated in Unimicro → update in Stylora (webhook)
   - Match by phone number or email

3. **Payment Recording**
   - When payment recorded in Stylora POS → record in Unimicro
   - Link payment to invoice
   - Update invoice status to "Paid" when fully paid

4. **Accounting Entries**
   - Map Stylora services to Unimicro accounts
   - Automatically create journal entries for:
     - Revenue (services + products)
     - VAT (25% Norwegian standard rate)
     - Payment methods (cash, card, Stripe, Vipps)
     - Refunds and cancellations

## Implementation Steps

### Phase 1: Setup & Authentication
1. Register Stylora as application in Unimicro Developer Portal
2. Create server authentication client with certificate
3. Implement OAuth 2.0 flow in backend
4. Store access tokens securely in database
5. Add Unimicro credentials to salonSettings table

### Phase 2: Customer Sync
1. Create mapping between Stylora customers and Unimicro customers
2. Implement customer creation endpoint
3. Implement customer update endpoint
4. Add "Sync to Unimicro" toggle in Settings

### Phase 3: Invoice Creation
1. Create invoice generation logic
2. Map Stylora orders to CustomerInvoice format
3. Include line items (services + products)
4. Handle VAT calculations (25%)
5. Add invoice reference to orders table

### Phase 4: Payment Sync
1. Record payments in Unimicro when POS payment completed
2. Update invoice status based on payment
3. Handle partial payments
4. Sync refunds as credit notes

### Phase 5: Reporting & Monitoring
1. Create Unimicro sync status page in admin dashboard
2. Show last sync time, success/failure count
3. Display sync errors with retry button
4. Add manual sync trigger button

## Database Schema Changes

### New Table: `unimicroSettings`
```sql
CREATE TABLE unimicroSettings (
  id INTEGER PRIMARY KEY,
  tenantId INTEGER NOT NULL REFERENCES tenants(id),
  enabled BOOLEAN DEFAULT false,
  clientId TEXT,
  certificatePath TEXT,
  accessToken TEXT,
  refreshToken TEXT,
  tokenExpiresAt TIMESTAMP,
  companyId INTEGER,
  lastSyncAt TIMESTAMP,
  syncErrors TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### New Table: `unimicroInvoiceMapping`
```sql
CREATE TABLE unimicroInvoiceMapping (
  id INTEGER PRIMARY KEY,
  tenantId INTEGER NOT NULL REFERENCES tenants(id),
  orderId INTEGER NOT NULL REFERENCES orders(id),
  unimicroInvoiceId INTEGER NOT NULL,
  unimicroInvoiceNumber TEXT NOT NULL,
  syncedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT, -- 'synced', 'failed', 'paid'
  errorMessage TEXT
);
```

### New Table: `unimicroAccountMapping`
```sql
CREATE TABLE unimicroAccountMapping (
  id INTEGER PRIMARY KEY,
  tenantId INTEGER NOT NULL REFERENCES tenants(id),
  entityType TEXT NOT NULL, -- 'service', 'product', 'payment_method'
  entityId INTEGER NOT NULL,
  unimicroAccountId INTEGER NOT NULL,
  unimicroAccountNumber TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Benefits for Salon Owners

1. **Eliminates Double Entry**
   - Sales automatically flow from Stylora to accounting
   - No manual invoice creation needed
   - Reduces errors and saves time

2. **Real-Time Financial Overview**
   - Always up-to-date accounting records
   - Accurate VAT calculations
   - Proper revenue recognition

3. **Compliance**
   - Meets Norwegian accounting requirements
   - Proper audit trail
   - VAT reporting ready

4. **Professional Invoicing**
   - Unimicro handles invoice formatting
   - Automatic invoice numbering
   - Payment reminders (via Unimicro)

5. **Accountant-Friendly**
   - Accountants can access Unimicro directly
   - Standard accounting format
   - Easy year-end closing

## Pricing Considerations

- Unimicro API access is included with Unimicro subscription
- No additional API fees (typically)
- Salon must have active Unimicro account
- Stylora can offer this as premium feature (e.g., "Bedrift" plan)

## Competitive Advantage

- Most salon software in Norway lacks accounting integration
- Unimicro is widely used by Norwegian SMBs
- This feature would differentiate Stylora significantly
- Targets professional salons with accountants

## Next Steps

1. Contact Unimicro to register as integration partner
2. Get access to developer sandbox environment
3. Implement OAuth 2.0 authentication
4. Build MVP with basic invoice sync
5. Test with pilot salon
6. Expand to full feature set

## Documentation Links

- Main Developer Portal: https://developer.unimicro.no/
- Authentication Guide: https://developer.unimicro.no/guide/authentication/overview
- API Documentation: https://developer.unimicro.no/docs
- Community: https://developer.unimicro.no/ (Community link)

## Technical Notes

- API uses standard REST conventions
- JSON request/response format
- OAuth 2.0 for authentication
- Supports webhooks for real-time updates
- Custom fields available for extended data
- Ad-hoc queries for complex filtering
- Rate limiting likely in place (check documentation)

## Risk Assessment

**Low Risk**:
- Well-documented API
- Standard OAuth 2.0
- REST architecture (familiar)
- JSON format (easy to work with)

**Medium Risk**:
- Certificate-based auth (need to implement properly)
- Token refresh logic required
- Error handling for sync failures
- Data mapping complexity

**Mitigation**:
- Start with read-only operations (test connection)
- Implement comprehensive error logging
- Add manual retry mechanisms
- Provide clear error messages to users
- Test thoroughly in sandbox before production

## Estimated Development Time

- Phase 1 (Setup & Auth): 2-3 days
- Phase 2 (Customer Sync): 2-3 days
- Phase 3 (Invoice Creation): 3-4 days
- Phase 4 (Payment Sync): 2-3 days
- Phase 5 (Reporting): 2 days
- Testing & Bug Fixes: 3-4 days

**Total**: ~15-20 days of development

## Conclusion

Unimicro integration is highly feasible and would provide significant value to Stylora users. The API is well-documented, uses standard technologies, and covers all necessary accounting operations. This feature would position Stylora as a complete business solution for Norwegian salons, not just a booking system.
