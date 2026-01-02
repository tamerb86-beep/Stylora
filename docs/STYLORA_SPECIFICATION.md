# Stylora SaaS – Complete Technical Specification

## SECTION 1 – Vision & Core Purpose

### Why Stylora Exists in the Norwegian Market

Norwegian barbershops, hair salons, and beauty salons face significant operational challenges that stem from outdated manual systems and fragmented digital tools. Many small salon owners rely on paper appointment books, spreadsheets, and disconnected payment solutions, leading to missed appointments, revenue leakage, and administrative overhead that consumes time better spent with customers.

Existing booking platforms in the Norwegian market often fall into two problematic categories: **generic international solutions** that lack Norwegian payment integration (Vipps), proper VAT handling, and Norwegian language support; or **overly complex enterprise systems** designed for large chains that overwhelm single-location salons with unnecessary features and steep learning curves.

### Pain Points with Current Systems

**Manual appointment management** creates scheduling conflicts, double-bookings, and no-show losses that directly impact revenue. Without automated reminders, salons experience 15-20% no-show rates, representing substantial lost income.

**Fragmented payment handling** forces salon staff to juggle multiple systems: cash registers, card terminals, Vipps transfers, and manual reconciliation. This complexity increases errors in accounting, complicates VAT reporting, and creates audit risks.

**Lack of business intelligence** means salon owners make decisions based on gut feeling rather than data. They cannot easily answer fundamental questions: Which services generate the most profit? Which employees drive the most revenue? What are the busiest hours? When should they hire additional staff?

**Compliance burden** around GDPR, customer data retention, and Norwegian accounting standards (SAF-T) creates anxiety for non-technical salon owners who fear regulatory penalties but lack the expertise to ensure compliance.

### Core Value Proposition vs Generic Booking Apps

Stylora differentiates itself through **Norwegian-first design**. Every feature is built specifically for the Norwegian market: native Vipps integration, Norwegian VAT handling (25% standard rate with proper codes), SAF-T-compatible export formats, and Norwegian language throughout the interface.

**Vertical integration** means Stylora is not just a booking tool—it combines appointment management, customer relationship management, inventory tracking, point-of-sale functionality, accounting integration, and business intelligence into a single coherent system. This eliminates the need for salon owners to stitch together multiple subscriptions and manually transfer data between systems.

**Simplicity without sacrifice** is the design philosophy. Stylora provides enterprise-grade functionality (multi-location support, role-based access control, comprehensive reporting) while maintaining an interface so intuitive that a salon owner can onboard their team in under an hour without technical training.

**Fair pricing** aligns with the economics of small Norwegian salons. Unlike enterprise systems that charge per-location or per-feature, Stylora offers transparent tier-based pricing that scales with the salon's size, making professional tools accessible to single-chair barbershops and multi-location chains alike.

### Why "Enkelt og Ryddig" UX is Central

Norwegian salon owners are **craftspeople, not IT professionals**. They excel at cutting hair, applying treatments, and building customer relationships—not navigating complex software interfaces. The "enkelt og ryddig" (simple and tidy) design principle acknowledges this reality.

**Cognitive load reduction** means every screen presents only the information needed for the current task. The appointment calendar shows today's bookings prominently, with tomorrow and next week accessible through clear navigation—not buried in date pickers. The checkout process requires three taps: select service, select payment method, confirm.

**Predictable patterns** ensure that once a user learns one part of the system, they can intuitively navigate others. All list views (customers, products, services, employees) follow the same layout. All forms use consistent validation and error messaging. All actions (edit, delete, archive) appear in the same locations.

**Forgiveness** is built into the system. Accidental deletions can be undone. Draft appointments can be saved and completed later. The system auto-saves form inputs so that interruptions (a customer walking in, a phone call) don't result in lost work.

**Performance** is a UX feature. Stylora loads in under two seconds on Norwegian mobile networks. Actions provide immediate feedback—when a user books an appointment, the calendar updates instantly without waiting for server confirmation. Background synchronization ensures data consistency without blocking the user.

This focus on simplicity is not about dumbing down the software—it's about **respecting the user's time and expertise**. Salon owners should spend their cognitive energy on their craft, not on learning software.

---

## SECTION 2 – Functional Requirements (Ultra-Detailed)

### 2.1 Booking Engine

The booking engine is the core of Stylora, responsible for managing appointment scheduling, conflict detection, and customer notifications. It must handle the complexity of multiple employees with varying schedules, services with different durations, and customer preferences while presenting a simple interface.

**Time-slot generation** operates on a per-employee, per-service, per-day basis. Each employee has a weekly schedule template defining their working hours (e.g., Monday 09:00-17:00, Tuesday 10:00-18:00). The system generates available time slots by:

1. Loading the employee's schedule for the requested date
2. Retrieving all existing appointments for that employee on that date
3. Calculating the service duration (e.g., "Herreklipp" = 30 minutes, "Farge + klipp" = 90 minutes)
4. Generating slots at 15-minute intervals (configurable per salon)
5. Filtering out slots that would overlap with existing appointments or fall outside working hours
6. Applying buffer time between appointments (configurable, default 5 minutes for cleanup)

**Parallel booking handling** must prevent race conditions when multiple customers book simultaneously. The system uses optimistic locking with version timestamps:

1. When a customer selects a time slot, the frontend displays a "Hold this slot" countdown (default 5 minutes)
2. The backend creates a temporary reservation with status `PENDING` and expiration timestamp
3. If the customer completes booking before expiration, status changes to `CONFIRMED`
4. If expiration passes, a background job releases the slot and notifies the customer (if contact info was captured)
5. Concurrent booking attempts for the same slot receive immediate feedback: "This slot was just booked. Please select another time."

**24-hour Norwegian time format** is enforced throughout the system (09:00, 14:30, 17:00) with no AM/PM notation. All times are stored in UTC in the database but displayed in Norwegian timezone (CET/CEST with automatic daylight saving adjustment).

**Rescheduling rules** allow customers and staff to modify appointments with appropriate constraints:

- Customers can reschedule up to 24 hours before the appointment (configurable per salon)
- Staff can reschedule at any time
- Each reschedule operation creates an audit log entry recording: original time, new time, who made the change, timestamp, reason (optional text field)
- If rescheduling would create a conflict, the system suggests the next three available slots for that employee/service combination

**Cancellation policies** are configurable per salon with three tiers:

1. **Free cancellation period** (e.g., 24 hours before): No charge, slot released immediately
2. **Late cancellation period** (e.g., 12-24 hours before): Optional cancellation fee (e.g., 50% of service price)
3. **No-show** (customer doesn't appear and doesn't cancel): Full service price charged (if payment method on file) or flagged in customer record

**No-show handling** includes:

- Automatic status change to `NO_SHOW` if appointment time passes without check-in
- Notification to salon staff
- Customer record updated with no-show count
- Optional automatic SMS to customer: "Vi savnet deg i dag. Vennligst gi beskjed neste gang." (We missed you today. Please let us know next time.)
- Configurable policy: After X no-shows, require prepayment for future bookings

**SMS and email reminders** operate via cron jobs:

- **24 hours before**: "Påminnelse: Du har time hos [Salon] i morgen kl [Time]. Bekreft eller avbestill: [Link]"
- **2 hours before**: "Din time hos [Salon] starter om 2 timer (kl [Time]). Vi gleder oss til å se deg!"
- Reminders are queued in a `notifications` table with retry logic (exponential backoff, max 3 attempts)
- Failed notifications are logged with reason (invalid phone number, email bounce, provider error)

**Recurrent bookings** support customers who book the same service at regular intervals (e.g., "Herreklipp every 4 weeks on Thursdays at 15:00"):

- Customer or staff creates a recurrence rule: frequency (weekly, biweekly, monthly), preferred day/time, end condition (after N occurrences or by date)
- System generates appointments in advance (default: next 3 months)
- Each appointment is independent—canceling one doesn't affect others
- System sends notification when the recurrence is nearing its end: "Din faste time utløper snart. Vil du fornye?"

**Group bookings** allow multiple customers to book related appointments (e.g., bridal party, family):

- One customer creates a group booking request specifying: number of people, services needed, preferred date/time range
- System suggests time slots where multiple employees are available simultaneously or in sequence
- Each person in the group gets an individual appointment record linked to the group booking ID
- Canceling the group booking cancels all related appointments with a single action

### 2.2 Customer Management (CRM-lite)

The customer management module stores and organizes customer information, visit history, preferences, and notes, enabling personalized service while maintaining GDPR compliance.

**Customer entity design** includes:

- **Identity fields**: First name, last name, phone number (Norwegian format: +47 XXX XX XXX), email address
- **PII fields**: Date of birth (optional, for birthday promotions), address (optional, for marketing segmentation)
- **Preferences**: Preferred employee, preferred services, preferred time slots (e.g., "always Thursdays after 16:00")
- **Notes**: Free-text field for allergies, sensitivities, style preferences (e.g., "allergisk mot ammoniakk", "liker kort på sidene")
- **Marketing consent**: Boolean flags for SMS marketing, email marketing, with consent timestamp and IP address (GDPR requirement)
- **Metadata**: Customer since date, total visits, total revenue, last visit date, average visit frequency

**GDPR considerations**:

- **Lawful basis**: Customer data is processed under "contract" basis (necessary for providing the service) and "consent" basis (for marketing)
- **Data minimization**: Only collect data necessary for service delivery
- **Purpose limitation**: Data collected for bookings cannot be used for marketing without explicit consent
- **Storage limitation**: Implement configurable retention period (default: 3 years after last visit)
- **Right to access**: Customers can request a data export (JSON format) via self-service portal or by contacting salon
- **Right to erasure**: Customers can request deletion; system implements soft delete with anonymization (replace name with "Deleted User", clear PII fields, retain visit history for accounting purposes)
- **Data portability**: Export format includes all customer data in machine-readable JSON
- **Consent management**: Customers can withdraw marketing consent at any time; system must honor immediately

**Visit history structure** stores:

- Appointment date/time
- Service(s) provided
- Employee who performed service
- Products used (for inventory tracking)
- Payment amount and method
- Customer satisfaction rating (optional post-visit survey)
- Notes from that visit (e.g., "brukte 20 vol utvikler", "klippet 3 cm")

**Data retention policies**:

- **Active customers** (visited within retention period): Full data retained
- **Inactive customers** (no visit within retention period): Automated email notification 30 days before deletion: "Vi har ikke sett deg på lenge. Dine data vil bli slettet om 30 dager med mindre du bestiller en time."
- **Deleted customers**: PII anonymized, visit history retained with anonymized customer ID for accounting/reporting requirements (Norwegian accounting law requires 5-year retention of transaction records)

**Right-to-be-forgotten flow**:

1. Customer submits deletion request via self-service portal or email to salon
2. System validates identity (email verification or phone verification)
3. System checks for upcoming appointments—if any exist, customer must cancel them first
4. System performs soft delete: sets `deleted_at` timestamp, anonymizes PII fields, removes from marketing lists
5. System sends confirmation email: "Dine data er slettet. Vi beholder anonymiserte transaksjonsdata for regnskapsformål."
6. After 90-day grace period (in case of accidental deletion), hard delete removes all remaining PII

### 2.3 Employees Module

The employees module manages salon staff, their schedules, roles, permissions, and commission calculations. It must handle the full employee lifecycle from onboarding to offboarding while preserving historical data integrity.

**Roles and permissions**:

- **Owner**: Full access to all features, can manage billing, can add/remove admins
- **Admin**: Can manage employees, services, products, view all reports, cannot access billing
- **Employee**: Can view their own schedule, check in customers, process payments, view their own performance reports, cannot access other employees' data or salon-wide settings

**Soft delete with isActive flag**:

When an employee leaves the salon, hard deletion would break historical data (past appointments, sales records, commission calculations). Instead, the system implements soft delete:

- Set `isActive = false` and record `deactivatedAt` timestamp
- Employee immediately disappears from:
  - Online booking interface (customers cannot select them)
  - Staff selection dropdowns in appointment creation
  - Staff assignment lists
- Employee data remains visible in:
  - Historical appointment records
  - Sales reports (with "(inaktiv)" suffix on name)
  - Commission calculations for past periods
  - Audit logs

**Re-assignment of future bookings** on deactivation:

1. System identifies all future appointments assigned to the deactivated employee
2. Admin is prompted: "Denne ansatte har X fremtidige timer. Hva vil du gjøre?"
3. Options:
   - **Reassign to another employee**: System checks availability and reassigns, sends notification to customer: "Din time er flyttet til [New Employee] på grunn av endringer i vår bemanning."
   - **Cancel appointments**: System cancels all future appointments, sends notification to customers with rebooking link
   - **Leave unassigned**: Appointments remain in system with "Ansatt ikke lenger tilgjengelig" status, admin must manually handle each

**Weekly schedule templates**:

Each employee has a default weekly schedule:

```
Monday: 09:00-17:00 (lunch break 12:00-12:30)
Tuesday: 09:00-17:00
Wednesday: Off
Thursday: 10:00-18:00
Friday: 09:00-17:00
Saturday: 09:00-15:00
Sunday: Off
```

**Vacation and absence tracking**:

- Employee or admin creates absence record: start date, end date, type (vacation, sick leave, training)
- System automatically blocks booking slots during absence period
- Existing appointments during absence are flagged for reassignment
- Absence records are visible in employee's calendar with color coding

**Commission calculation logic**:

Many Norwegian salons pay employees a base salary plus commission on services and product sales. Stylora supports flexible commission structures:

- **Percentage of service revenue**: Employee receives X% of service price (e.g., 40% of "Herreklipp" price)
- **Percentage of product sales**: Employee receives Y% of product price when they sell retail products
- **Tiered commissions**: Commission percentage increases with monthly revenue (e.g., 30% for first 20,000 NOK, 35% above that)
- **Fixed per-service**: Employee receives fixed amount per service regardless of price (e.g., 100 NOK per haircut)

Commission calculation runs at month-end:

1. System aggregates all completed appointments and sales for each employee
2. Applies commission rules based on employee's contract settings
3. Generates commission report: total revenue, commission amount, breakdown by service/product
4. Report is available for employee to view and for owner to use in payroll processing

### 2.4 Payments

The payment module handles all financial transactions, integrating with payment providers while maintaining PCI compliance and providing robust error handling.

**Stripe integration for card payments**:

Stylora uses Stripe Checkout for card payments in NOK:

1. Customer selects services and products
2. System calculates total including VAT (25% standard rate for most services, 15% for certain treatments)
3. System creates Stripe Checkout session with:
   - Amount in NOK (øre, smallest currency unit: 1 NOK = 100 øre)
   - Line items (services and products)
   - Customer email (pre-filled if available)
   - Success URL (redirects to confirmation page)
   - Cancel URL (returns to booking page)
4. Customer completes payment on Stripe-hosted page
5. Stripe sends webhook to `/api/payments/stripe/webhook` with payment status
6. System verifies webhook signature, updates appointment status to `PAID`, sends confirmation email

**Webhook handling**:

- `checkout.session.completed`: Payment successful, mark appointment as paid
- `checkout.session.expired`: Payment abandoned, send reminder email to customer
- `charge.refunded`: Refund processed, update appointment payment status, adjust accounting records

**Payment abstraction layer**:

To support future payment providers (especially Vipps), Stylora implements an abstraction layer:

```typescript
interface PaymentProvider {
  createPayment(amount: number, currency: string, metadata: object): Promise<PaymentSession>;
  refundPayment(paymentId: string, amount?: number): Promise<RefundResult>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
}

class StripeProvider implements PaymentProvider { /* ... */ }
class VippsProvider implements PaymentProvider { /* placeholder for future */ }
```

This allows adding Vipps integration without changing application logic—just implement the interface and configure the provider.

**In-salon manual payments**:

For customers who pay in person with cash or card terminal:

1. Staff selects appointment in calendar
2. Clicks "Merk som betalt"
3. Selects payment method: Cash, Card (terminal), Vipps (manual)
4. Enters amount (pre-filled with service total, editable for tips)
5. System records payment with timestamp, method, amount, staff member who processed it

**Refunds and accounting impact**:

- **Full refund**: Reverses entire payment, updates appointment status to `REFUNDED`, creates accounting entry to offset original revenue
- **Partial refund**: Refunds portion of payment (e.g., customer unhappy with one service in a multi-service appointment), creates accounting entry for refund amount
- All refunds require reason (dropdown: "Kundens forespørsel", "Servicefeil", "Avbestilling", "Annet") and optional notes
- Refunds are reported separately in accounting exports to maintain audit trail

**Error handling**:

- **Failed payments**: Customer sees user-friendly error message, system logs technical details (Stripe error code, message), staff receives notification to follow up
- **Timeouts**: If payment provider doesn't respond within 30 seconds, system shows "Behandler betaling..." message and polls status every 5 seconds for up to 2 minutes
- **Webhook failures**: If webhook processing fails, system retries with exponential backoff (1 min, 5 min, 15 min, 1 hour), sends alert to owner after 3 failures

**PCI considerations**:

Stylora never handles raw card data—all card information flows directly to Stripe. The system only stores:

- Stripe payment intent ID
- Last 4 digits of card (provided by Stripe)
- Card brand (Visa, Mastercard, etc.)
- Payment status

This ensures PCI compliance without requiring expensive security audits.

### 2.5 Store Products & Direktsalg

The inventory and direct sales module manages product catalog, stock levels, and point-of-sale transactions for retail products sold in the salon.

**Product catalog structure**:

- **SKU**: Unique product identifier (e.g., "SHP-001")
- **Name**: Product name (e.g., "Redken Brews Shampoo 300ml")
- **Category**: Grouping (Shampoo, Conditioner, Styling, Color, Tools)
- **Cost price**: What the salon pays the supplier (for profit calculation)
- **Retail price**: What customers pay
- **VAT code**: Norwegian VAT rate (25% for most products, 15% for certain items)
- **Barcode**: EAN/UPC for barcode scanner integration
- **Supplier**: Supplier name and contact info
- **Stock level**: Current quantity on hand
- **Reorder point**: Threshold that triggers low-stock alert
- **Reorder quantity**: Suggested order quantity when restocking

**Inventory decrement rules**:

Stock levels decrease in two scenarios:

1. **Direct sales**: Customer purchases product at checkout, stock decrements by quantity sold
2. **Service consumption**: Certain services use products (e.g., hair coloring uses color tubes, developer, toner), stock decrements based on service-product associations

**Service-product associations**:

Services can have linked products with usage quantities:

```
Service: "Hårfarge - heldekkende"
Products used:
- Color tube (60ml): 1 unit
- Developer (120ml): 1 unit
- Toner (20ml): 0.5 unit
```

When this service is performed, stock automatically decrements by these amounts.

**Bundles**:

Salons can create bundles (service + product) at discounted prices:

```
Bundle: "Klipp + Styling Pakke"
- Service: Herreklipp (300 NOK)
- Product: Styling Wax (150 NOK)
Bundle price: 400 NOK (50 NOK discount)
```

Bundles are treated as single line items at checkout but broken down into components for inventory and accounting purposes.

**Stock alerts**:

When product stock falls below reorder point:

- System sends notification to owner/admin: "Lav beholdning: [Product Name] har kun [X] igjen. Bestill mer?"
- Product is highlighted in inventory list with warning icon
- System can optionally generate purchase order draft with supplier info and reorder quantity

**Stock adjustments**:

Manual stock adjustments (for receiving shipments, correcting errors, handling damaged goods):

1. Admin navigates to product in inventory
2. Clicks "Juster beholdning"
3. Enters new quantity and reason (dropdown: "Mottatt levering", "Telling", "Skadet vare", "Annet")
4. System creates audit log entry with old quantity, new quantity, adjustment amount, reason, timestamp, user

### 2.6 Regnskap & Reports

The accounting and reporting module provides financial visibility and generates exports compatible with Norwegian accounting standards.

**Sales reports**:

- **Daily sales report**: Total revenue, breakdown by payment method (cash, card, Vipps), number of transactions, average transaction value
- **Weekly sales report**: Revenue trend over 7 days, comparison to previous week, top services, top employees
- **Monthly sales report**: Total revenue, expenses (if tracked), net profit, VAT collected, breakdown by service category, breakdown by employee

**Per-employee reporting**:

- Revenue generated by each employee
- Number of services performed
- Average service value
- Commission earned (if applicable)
- Customer satisfaction ratings

**Per-service reporting**:

- Number of times each service was performed
- Total revenue per service
- Average price per service (accounts for discounts)
- Profitability (revenue minus product costs for services that consume products)

**Per-product reporting**:

- Units sold
- Revenue generated
- Profit margin (retail price minus cost price)
- Inventory turnover rate

**Cash register close-of-day process (kasseoppgjør)**:

At end of business day, staff performs cash register reconciliation:

1. System calculates expected cash: opening balance + cash payments - cash refunds
2. Staff counts physical cash and enters amount
3. System compares expected vs actual:
   - Match: "Kassen stemmer!" (register balanced)
   - Discrepancy: "Avvik: [X] NOK. Forventet [Y], faktisk [Z]" (discrepancy detected)
4. Staff enters explanation for discrepancy (if any)
5. System generates close-of-day report: total sales, payment method breakdown, discrepancies, staff member who closed
6. Report is locked (cannot be edited) and stored for audit purposes

**Export formats**:

- **CSV export**: Customizable columns, UTF-8 with BOM encoding (for Excel compatibility), date range filter, entity filter (all employees, specific employee, all services, specific service)
- **SAF-T friendly format**: Norwegian Standard Audit File for Tax (SAF-T) is the required format for tax audits. Stylora exports include all required fields:
  - Transaction date (YYYY-MM-DD)
  - Transaction type (sale, refund, adjustment)
  - Amount excluding VAT
  - VAT code and amount
  - Payment method
  - Customer reference (if available)
  - Description

**Required fields for Norwegian accountants**:

Norwegian accountants need specific data points for VAT reporting and annual accounts:

- **Date**: Transaction date in ISO format
- **Type**: Income (inntekt), expense (utgift), adjustment (justering)
- **VAT code**: Norwegian VAT codes (3 = 25%, 33 = 15%, 5 = 0%, 6 = exempt)
- **Amount excluding VAT**: Net amount
- **VAT amount**: Calculated VAT
- **Total amount**: Gross amount (net + VAT)
- **Payment method**: Cash (kontant), card (kort), Vipps, invoice (faktura)
- **Account code**: Norwegian standard account codes (e.g., 3000-series for sales revenue)

### 2.7 Notifications

The notification module handles all customer and staff communications via SMS and email, with robust retry logic and rate limiting.

**SMS provider integration**:

Stylora uses a generic SMS gateway interface that can connect to Norwegian providers (Twilio, Link Mobility, Intelecom):

```typescript
interface SMSProvider {
  sendSMS(to: string, message: string, sender: string): Promise<SMSResult>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
}
```

Configuration per tenant:

- Provider selection (dropdown)
- API credentials (encrypted at rest)
- Sender name (max 11 characters, alphanumeric, e.g., "Stylora" or salon name)
- SMS quota per month (based on subscription plan)

**Email provider integration**:

Similar abstraction for email providers (Resend, SendGrid, Postmark):

```typescript
interface EmailProvider {
  sendEmail(to: string, subject: string, body: string, from: string): Promise<EmailResult>;
  sendTemplateEmail(to: string, templateId: string, variables: object): Promise<EmailResult>;
}
```

**Retry logic**:

Notifications can fail due to temporary issues (provider downtime, network errors). Stylora implements exponential backoff:

1. Initial send attempt
2. If failure, wait 1 minute, retry
3. If failure, wait 5 minutes, retry
4. If failure, wait 15 minutes, retry
5. If failure, wait 1 hour, retry
6. If still failing after 5 attempts, mark as failed and alert salon owner

**Failed-notification log**:

All notification attempts are logged:

- Notification ID
- Type (SMS, email)
- Recipient
- Content
- Status (pending, sent, delivered, failed)
- Attempt count
- Last attempt timestamp
- Error message (if failed)

Salon staff can view failed notifications and manually retry or contact customer through alternative channel.

**Rate limiting per tenant**:

To prevent abuse and control costs:

- Each subscription plan includes SMS quota (e.g., Start plan: 100 SMS/month, Pro plan: 500 SMS/month)
- System tracks SMS usage per tenant per month
- When approaching limit (90%), owner receives warning notification
- When limit is reached, system stops sending SMS and notifies owner: "SMS-kvoten din er brukt opp. Oppgrader abonnementet eller vent til neste måned."
- Email has higher/unlimited quota since it's cheaper

### 2.8 Multi-Tenant SaaS

Stylora is a multi-tenant SaaS platform where each salon is a separate tenant with isolated data and customizable settings.

**Tenant model**:

Each salon is represented by a tenant entity:

- **Tenant ID**: Unique identifier (UUID)
- **Salon name**: Display name (e.g., "Barber & Co Oslo")
- **Subdomain**: Custom subdomain for online booking (e.g., `barberco.stylora.no`)
- **Contact info**: Phone, email, address
- **Business registration**: Norwegian organization number (organisasjonsnummer)
- **Branding**: Logo URL, primary color, accent color
- **Status**: Active, suspended (non-payment), trial, canceled

**Tenant isolation patterns**:

Stylora uses **row-based isolation** with `tenantId` foreign key on all data tables:

```sql
CREATE TABLE appointments (
  id INT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  customer_id INT NOT NULL,
  employee_id INT NOT NULL,
  -- other columns
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_tenant_appointments (tenant_id, appointment_date)
);
```

All queries include `WHERE tenant_id = ?` filter to ensure data isolation. This is enforced at the database access layer—application code cannot accidentally query across tenants.

**Default settings per tenant**:

Each tenant has customizable settings:

- **Timezone**: Norway uses CET/CEST, but system supports other timezones for international expansion
- **VAT rate**: Default 25%, but configurable for special cases
- **Currency**: NOK by default
- **SMS sender name**: Salon name or custom sender
- **Booking rules**: Advance booking limit (e.g., customers can book up to 60 days in advance), cancellation policy (24h, 12h, no cancellation), buffer time between appointments
- **Business hours**: Default opening hours for time slot generation
- **Language**: Norwegian (bokmål) by default, with support for nynorsk and English

**Subscription plan enforcement**:

Each tenant is assigned a subscription plan (Start, Pro, Premium) that determines feature access and limits:

- **User limits**: Start (1 employee), Pro (up to 5 employees), Premium (unlimited)
- **Branch limits**: Start (1 location), Pro (1 location), Premium (multiple locations)
- **SMS quota**: Start (100/month), Pro (500/month), Premium (2000/month)
- **Feature flags**: Start (basic booking + payments), Pro (+ inventory + reports), Premium (+ API access + advanced analytics)

System enforces limits:

- When adding employee, check if tenant has reached user limit: "Du har nådd grensen for antall ansatte i din plan. Oppgrader for å legge til flere."
- When sending SMS, check if tenant has remaining quota
- When accessing premium features, check if tenant's plan includes that feature

---

## SECTION 3 – Non-Functional Requirements

### 3.1 Security & Privacy

**GDPR compliance**:

Stylora processes personal data of salon customers and must comply with EU GDPR (which Norway implements through national law):

- **Lawful basis**: Contract (for service delivery) and consent (for marketing)
- **Data processing agreements**: Salons are data controllers, Stylora is data processor. Standard DPA is provided to all customers
- **Data minimization**: Only collect necessary data
- **Purpose limitation**: Data collected for one purpose (booking) cannot be used for another (marketing) without consent
- **Storage limitation**: Configurable retention periods, automated deletion
- **Data subject rights**: Access, rectification, erasure, portability, restriction, objection
- **Privacy by design**: GDPR considerations built into every feature from the start

**Encryption**:

- **At rest**: Sensitive database columns (customer PII, payment info, API credentials) are encrypted using AES-256
- **In transit**: All connections use HTTPS/TLS 1.3, no unencrypted HTTP traffic allowed

**Role-based access control (RBAC)**:

- Owner: Full access
- Admin: Cannot access billing or delete tenant
- Employee: Can only view own schedule and process own appointments

Permissions are checked at API level—frontend restrictions are UX convenience, not security boundary.

**Audit logs**:

Critical operations are logged:

- Customer data deletion
- Employee deactivation
- Appointment cancellation
- Payment refund
- Settings changes

Logs include: timestamp, user who performed action, action type, affected entity, before/after values (for updates).

**Rate limiting and brute-force protection**:

- Login attempts: Max 5 failed attempts per IP per 15 minutes, then CAPTCHA required
- API endpoints: Max 100 requests per minute per tenant
- Password requirements: Min 8 characters, must include uppercase, lowercase, number

### 3.2 Reliability

**Transactions for critical operations**:

All operations that modify multiple tables use database transactions to ensure atomicity:

- Creating appointment (insert appointment, decrement inventory if service uses products, create notification records)
- Processing payment (update appointment status, create payment record, create accounting entry)
- Refunding payment (update payment record, create refund record, create accounting adjustment)

If any step fails, entire transaction rolls back—no partial state.

**Background jobs and queues**:

Long-running tasks are processed asynchronously:

- Sending notifications (SMS, email)
- Generating reports
- Processing exports
- Cleaning up expired reservations

Stylora uses a job queue (implemented with database table + worker process):

```sql
CREATE TABLE jobs (
  id INT PRIMARY KEY,
  type VARCHAR(50), -- 'send_sms', 'send_email', 'generate_report'
  payload JSON,
  status ENUM('pending', 'processing', 'completed', 'failed'),
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  created_at TIMESTAMP,
  scheduled_at TIMESTAMP,
  processed_at TIMESTAMP
);
```

Worker process polls for pending jobs, processes them, updates status.

**Dead-letter queue strategy**:

Jobs that fail after max attempts are moved to dead-letter queue for manual review:

- Admin receives notification: "X jobs failed permanently. Review required."
- Admin can view failed jobs, see error messages, and manually retry or cancel

**Backup and restore strategy**:

- **Automated daily backups**: Full database backup at 02:00 CET, retained for 30 days
- **Point-in-time recovery**: Transaction logs retained for 7 days, allowing restore to any point within that window
- **Backup testing**: Monthly automated restore test to verify backup integrity
- **Disaster recovery**: Backups stored in geographically separate region (if primary is Oslo, backup is Stockholm)

### 3.3 Performance

**Indexing strategy**:

Common queries are optimized with database indexes:

- Appointments by date and employee: `INDEX (tenant_id, employee_id, appointment_date)`
- Customers by phone: `INDEX (tenant_id, phone)`
- Customers by email: `INDEX (tenant_id, email)`
- Sales by date: `INDEX (tenant_id, payment_date)`

**Caching layer**:

Read-heavy endpoints use caching to reduce database load:

- Dashboard statistics (today's revenue, upcoming appointments): Cached for 5 minutes
- Employee schedules: Cached for 1 hour
- Service and product catalogs: Cached until modified

Cache invalidation is triggered by relevant mutations (e.g., creating appointment invalidates dashboard stats cache).

**Serverless cold-start mitigation**:

If deployed on Vercel (serverless functions), cold starts can add 1-2 second latency. Mitigations:

- Keep functions warm with periodic health check pings
- Optimize bundle size (tree-shaking, code splitting)
- Use edge functions for latency-sensitive endpoints (booking availability check)

### 3.4 Scalability

**Horizontal scaling architecture**:

Stylora is designed to scale horizontally:

- **Stateless API servers**: No session state stored in memory, all state in database or Redis
- **Load balancer**: Distributes traffic across multiple API server instances
- **Database connection pooling**: Each API server maintains connection pool, total connections managed to avoid overwhelming database

**Worker processes for queues**:

Background job processing can scale independently:

- Start with single worker process
- As job volume grows, add more worker processes
- Workers coordinate via database locks to avoid processing same job twice

**Database growth strategy**:

As tenant count grows, database size increases. Strategies:

- **Vertical scaling**: Upgrade to larger database instance (more CPU, RAM, storage)
- **Read replicas**: Route read-heavy queries (reports, dashboard) to read replicas, write queries to primary
- **Partitioning**: If single tenant grows very large (e.g., large salon chain), partition their data into separate table partition

---

## SECTION 4 – Database Schema (Deep)

### Entity Relationship Overview

The Stylora database consists of 15 core tables organized into logical domains:

**Identity & Access**: `tenants`, `users`, `sessions`

**Customer Management**: `customers`, `customer_notes`

**Service Catalog**: `services`, `service_categories`, `employees`, `employee_schedules`

**Appointments & Bookings**: `appointments`, `appointment_services`, `recurrence_rules`

**Inventory & Sales**: `products`, `product_categories`, `order_items`, `orders`

**Financial**: `payments`, `refunds`, `cash_register_shifts`

**System**: `notifications`, `audit_logs`, `settings`

### Core Tables with Detailed Schema

#### Tenants Table

```sql
CREATE TABLE tenants (
  id VARCHAR(36) PRIMARY KEY, -- UUID
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(63) UNIQUE NOT NULL,
  org_number VARCHAR(9), -- Norwegian organisasjonsnummer
  phone VARCHAR(20),
  email VARCHAR(320),
  address TEXT,
  logo_url TEXT,
  primary_color VARCHAR(7), -- Hex color
  timezone VARCHAR(50) DEFAULT 'Europe/Oslo',
  currency VARCHAR(3) DEFAULT 'NOK',
  vat_rate DECIMAL(5,2) DEFAULT 25.00,
  status ENUM('trial', 'active', 'suspended', 'canceled') DEFAULT 'trial',
  trial_ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subdomain (subdomain),
  INDEX idx_status (status)
);
```

#### Users Table (Employees)

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  open_id VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(320),
  name VARCHAR(255),
  phone VARCHAR(20),
  role ENUM('owner', 'admin', 'employee') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  deactivated_at TIMESTAMP NULL,
  commission_type ENUM('percentage', 'fixed', 'tiered') DEFAULT 'percentage',
  commission_rate DECIMAL(5,2), -- e.g., 40.00 for 40%
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_users (tenant_id, is_active),
  INDEX idx_open_id (open_id)
);
```

#### Customers Table

```sql
CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(320),
  date_of_birth DATE,
  address TEXT,
  notes TEXT, -- Allergies, preferences
  marketing_sms_consent BOOLEAN DEFAULT FALSE,
  marketing_email_consent BOOLEAN DEFAULT FALSE,
  consent_timestamp TIMESTAMP,
  consent_ip VARCHAR(45),
  preferred_employee_id INT,
  total_visits INT DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0.00,
  last_visit_date DATE,
  no_show_count INT DEFAULT 0,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (preferred_employee_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tenant_customers (tenant_id, deleted_at),
  INDEX idx_phone (tenant_id, phone),
  INDEX idx_email (tenant_id, email)
);
```

#### Services Table

```sql
CREATE TABLE services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  category_id INT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL, -- e.g., 30 for 30-minute service
  price DECIMAL(10,2) NOT NULL,
  vat_rate DECIMAL(5,2) DEFAULT 25.00,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL,
  INDEX idx_tenant_services (tenant_id, is_active)
);
```

#### Appointments Table

```sql
CREATE TABLE appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  customer_id INT NOT NULL,
  employee_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending', 'confirmed', 'completed', 'canceled', 'no_show') DEFAULT 'pending',
  cancellation_reason TEXT,
  canceled_by ENUM('customer', 'staff', 'system'),
  canceled_at TIMESTAMP NULL,
  notes TEXT,
  recurrence_rule_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (recurrence_rule_id) REFERENCES recurrence_rules(id) ON DELETE SET NULL,
  INDEX idx_tenant_appointments (tenant_id, appointment_date, employee_id),
  INDEX idx_customer_appointments (customer_id, appointment_date),
  INDEX idx_employee_schedule (employee_id, appointment_date, start_time)
);
```

#### Appointment Services (Many-to-Many)

```sql
CREATE TABLE appointment_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT NOT NULL,
  service_id INT NOT NULL,
  price DECIMAL(10,2) NOT NULL, -- Price at time of booking (may differ from current service price)
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  INDEX idx_appointment (appointment_id)
);
```

#### Products Table

```sql
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  category_id INT,
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  cost_price DECIMAL(10,2) NOT NULL,
  retail_price DECIMAL(10,2) NOT NULL,
  vat_rate DECIMAL(5,2) DEFAULT 25.00,
  barcode VARCHAR(50),
  supplier VARCHAR(255),
  stock_quantity INT DEFAULT 0,
  reorder_point INT DEFAULT 10,
  reorder_quantity INT DEFAULT 20,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL,
  INDEX idx_tenant_products (tenant_id, is_active),
  INDEX idx_sku (sku),
  INDEX idx_low_stock (tenant_id, stock_quantity)
);
```

#### Orders Table (Sales Transactions)

```sql
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  appointment_id INT, -- NULL if standalone product sale
  customer_id INT,
  employee_id INT NOT NULL,
  order_date DATE NOT NULL,
  order_time TIME NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  vat_amount DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'completed', 'refunded', 'partially_refunded') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_tenant_orders (tenant_id, order_date),
  INDEX idx_employee_sales (employee_id, order_date)
);
```

#### Order Items Table

```sql
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  item_type ENUM('service', 'product') NOT NULL,
  item_id INT NOT NULL, -- References services.id or products.id
  quantity INT DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  vat_rate DECIMAL(5,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order (order_id)
);
```

#### Payments Table

```sql
CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  order_id INT NOT NULL,
  payment_method ENUM('cash', 'card', 'vipps', 'stripe') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
  stripe_payment_intent_id VARCHAR(255),
  last_four VARCHAR(4), -- Last 4 digits of card
  card_brand VARCHAR(20), -- Visa, Mastercard, etc.
  error_message TEXT,
  processed_by INT, -- User who processed payment
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tenant_payments (tenant_id, processed_at),
  INDEX idx_stripe_intent (stripe_payment_intent_id)
);
```

#### Notifications Table

```sql
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  recipient_type ENUM('customer', 'employee', 'owner') NOT NULL,
  recipient_id INT NOT NULL,
  notification_type ENUM('sms', 'email') NOT NULL,
  template VARCHAR(100), -- e.g., 'appointment_reminder_24h'
  recipient_contact VARCHAR(320) NOT NULL, -- Phone or email
  subject VARCHAR(255),
  content TEXT NOT NULL,
  status ENUM('pending', 'sent', 'delivered', 'failed') DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  error_message TEXT,
  scheduled_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_notifications (tenant_id, status, scheduled_at),
  INDEX idx_pending (status, scheduled_at)
);
```

#### Audit Logs Table

```sql
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  user_id INT,
  action VARCHAR(100) NOT NULL, -- e.g., 'customer_deleted', 'appointment_canceled'
  entity_type VARCHAR(50) NOT NULL, -- e.g., 'customer', 'appointment'
  entity_id INT NOT NULL,
  before_value JSON,
  after_value JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tenant_logs (tenant_id, created_at),
  INDEX idx_entity (entity_type, entity_id)
);
```

#### Settings Table

```sql
CREATE TABLE settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY unique_tenant_setting (tenant_id, setting_key)
);
```

#### Employee Schedules Table

```sql
CREATE TABLE employee_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  day_of_week TINYINT NOT NULL, -- 0 = Sunday, 6 = Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_start TIME,
  break_end TIME,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_employee_schedule (employee_id, day_of_week)
);
```

#### Recurrence Rules Table

```sql
CREATE TABLE recurrence_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  customer_id INT NOT NULL,
  employee_id INT NOT NULL,
  service_id INT NOT NULL,
  frequency ENUM('weekly', 'biweekly', 'monthly') NOT NULL,
  preferred_day_of_week TINYINT, -- 0-6
  preferred_time TIME,
  start_date DATE NOT NULL,
  end_date DATE,
  max_occurrences INT,
  current_occurrences INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  INDEX idx_tenant_recurrences (tenant_id, is_active)
);
```

#### Subscription Plans Table

```sql
CREATE TABLE subscription_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL, -- 'Start', 'Pro', 'Premium'
  display_name_no VARCHAR(100) NOT NULL, -- 'Start / Lite'
  price_monthly DECIMAL(10,2) NOT NULL,
  max_employees INT,
  max_locations INT,
  sms_quota INT,
  features JSON, -- Array of feature flags
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Tenant Subscriptions Table

```sql
CREATE TABLE tenant_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  plan_id INT NOT NULL,
  status ENUM('active', 'past_due', 'canceled', 'paused') DEFAULT 'active',
  current_period_start DATE NOT NULL,
  current_period_end DATE NOT NULL,
  stripe_subscription_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  INDEX idx_tenant_subscription (tenant_id),
  INDEX idx_stripe_subscription (stripe_subscription_id)
);
```

### Design Decisions and Rationale

**Why row-based isolation instead of schema-per-tenant?**

Row-based isolation (single schema, `tenant_id` column) is simpler to maintain and scales better for thousands of tenants. Schema-per-tenant would require dynamic schema creation, complex migration management, and connection pooling challenges.

**Why soft delete for customers and employees?**

Hard deletion would break referential integrity in historical records (appointments, sales). Soft delete (using `deleted_at` timestamp) preserves data integrity while hiding deleted entities from active use.

**Why separate `orders` and `order_items` tables?**

This allows mixed orders (services + products in one transaction) and maintains proper normalization. Each order item can reference either a service or product, with quantity and pricing captured at transaction time.

**Why store price in `appointment_services` and `order_items`?**

Prices change over time. Storing the price at transaction time ensures historical accuracy—reports show what was actually charged, not current prices.

**Why JSON for `audit_logs.before_value` and `after_value`?**

Audit logs track changes to various entity types with different schemas. JSON provides flexibility without requiring separate audit tables for each entity type.

---

## SECTION 5 – API Design (tRPC)

Stylora uses **tRPC** for type-safe API communication between frontend and backend. All procedures are defined in `server/routers.ts` and automatically generate TypeScript types for the frontend.

### Authentication Endpoints

#### `auth.login`

**Type**: Public procedure (mutation)

**Purpose**: Initiate Manus OAuth login flow

**Request**: None (redirects to OAuth portal)

**Response**:
```typescript
{
  redirectUrl: string; // OAuth login URL
}
```

**Validation**: None

**Error codes**:
- `INTERNAL_SERVER_ERROR`: OAuth configuration error

---

#### `auth.me`

**Type**: Public procedure (query)

**Purpose**: Get current authenticated user

**Request**: None

**Response**:
```typescript
{
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'employee';
  tenantId: string;
} | null
```

**Validation**: None

**Error codes**: None (returns null if not authenticated)

---

#### `auth.logout`

**Type**: Public procedure (mutation)

**Purpose**: Clear session and log out user

**Request**: None

**Response**:
```typescript
{
  success: true;
}
```

**Validation**: None

**Error codes**: None

---

### Tenant Management Endpoints

#### `tenants.create`

**Type**: Public procedure (mutation)

**Purpose**: Create new salon tenant (onboarding)

**Request**:
```typescript
{
  name: string; // Salon name
  subdomain: string; // Desired subdomain (e.g., 'barberco')
  orgNumber?: string; // Norwegian org number
  phone: string;
  email: string;
  address?: string;
}
```

**Response**:
```typescript
{
  tenantId: string;
  subdomain: string;
  status: 'trial';
  trialEndsAt: Date;
}
```

**Validation**:
- `name`: Required, 2-255 characters
- `subdomain`: Required, 3-63 characters, lowercase alphanumeric and hyphens only, must be unique
- `orgNumber`: Optional, must match Norwegian format (9 digits)
- `phone`: Required, must match Norwegian format (+47 XXX XX XXX)
- `email`: Required, valid email format

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `CONFLICT`: Subdomain already taken
- `INTERNAL_SERVER_ERROR`: Database error

---

### Appointment Endpoints

#### `appointments.getAvailableSlots`

**Type**: Protected procedure (query)

**Purpose**: Get available time slots for booking

**Request**:
```typescript
{
  employeeId: number;
  serviceId: number;
  date: string; // YYYY-MM-DD format
}
```

**Response**:
```typescript
{
  date: string;
  slots: Array<{
    startTime: string; // HH:MM format
    endTime: string;
    available: boolean;
  }>;
}
```

**Validation**:
- `employeeId`: Required, must exist and be active
- `serviceId`: Required, must exist and be active
- `date`: Required, must be valid date in future (not past)

**Error codes**:
- `BAD_REQUEST`: Invalid input
- `NOT_FOUND`: Employee or service not found
- `UNAUTHORIZED`: Not authenticated

---

#### `appointments.create`

**Type**: Protected procedure (mutation)

**Purpose**: Create new appointment

**Request**:
```typescript
{
  customerId: number;
  employeeId: number;
  serviceIds: number[]; // Array of service IDs
  appointmentDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  notes?: string;
}
```

**Response**:
```typescript
{
  appointmentId: number;
  status: 'confirmed';
  totalDuration: number; // minutes
  totalPrice: number; // NOK
  confirmationSent: boolean;
}
```

**Validation**:
- `customerId`: Required, must exist in same tenant
- `employeeId`: Required, must exist and be active
- `serviceIds`: Required, non-empty array, all services must exist
- `appointmentDate`: Required, must be valid future date
- `startTime`: Required, must be valid time format, must be within employee working hours, must not conflict with existing appointments

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `CONFLICT`: Time slot not available
- `NOT_FOUND`: Customer, employee, or service not found
- `UNAUTHORIZED`: Not authenticated or wrong tenant

**Side effects**:
- Creates appointment record
- Creates appointment_services records
- Queues confirmation notification
- Queues reminder notifications (24h and 2h before)

---

#### `appointments.update`

**Type**: Protected procedure (mutation)

**Purpose**: Update existing appointment (reschedule, change services)

**Request**:
```typescript
{
  appointmentId: number;
  appointmentDate?: string;
  startTime?: string;
  serviceIds?: number[];
  notes?: string;
}
```

**Response**:
```typescript
{
  appointmentId: number;
  updated: boolean;
  notificationSent: boolean;
}
```

**Validation**:
- `appointmentId`: Required, must exist in same tenant
- If rescheduling: new time must be available
- If changing services: all services must exist

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `CONFLICT`: New time slot not available
- `NOT_FOUND`: Appointment not found
- `FORBIDDEN`: Cannot modify past or canceled appointments

**Side effects**:
- Updates appointment record
- Creates audit log entry
- Sends notification to customer about change
- Updates reminder notification schedule

---

#### `appointments.cancel`

**Type**: Protected procedure (mutation)

**Purpose**: Cancel appointment

**Request**:
```typescript
{
  appointmentId: number;
  reason: string;
  canceledBy: 'customer' | 'staff';
}
```

**Response**:
```typescript
{
  appointmentId: number;
  canceled: boolean;
  feeCharged: number; // 0 if within free cancellation period
}
```

**Validation**:
- `appointmentId`: Required, must exist
- `reason`: Required, 1-500 characters

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `NOT_FOUND`: Appointment not found
- `FORBIDDEN`: Already canceled or completed

**Side effects**:
- Updates appointment status to 'canceled'
- Records cancellation reason and timestamp
- Applies cancellation fee if applicable
- Releases time slot
- Cancels scheduled reminder notifications
- Creates audit log entry

---

### Customer Endpoints

#### `customers.list`

**Type**: Protected procedure (query)

**Purpose**: List all customers for tenant

**Request**:
```typescript
{
  search?: string; // Search by name, phone, or email
  limit?: number; // Default 50, max 200
  offset?: number; // For pagination
}
```

**Response**:
```typescript
{
  customers: Array<{
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    totalVisits: number;
    lastVisitDate: Date | null;
  }>;
  total: number;
  hasMore: boolean;
}
```

**Validation**:
- `search`: Optional, max 100 characters
- `limit`: Optional, 1-200
- `offset`: Optional, non-negative

**Error codes**:
- `BAD_REQUEST`: Invalid pagination parameters
- `UNAUTHORIZED`: Not authenticated

---

#### `customers.create`

**Type**: Protected procedure (mutation)

**Purpose**: Create new customer

**Request**:
```typescript
{
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  notes?: string;
  marketingSmsConsent?: boolean;
  marketingEmailConsent?: boolean;
}
```

**Response**:
```typescript
{
  customerId: number;
  created: boolean;
}
```

**Validation**:
- `firstName`: Required, 1-100 characters
- `lastName`: Optional, max 100 characters
- `phone`: Required, valid Norwegian phone format
- `email`: Optional, valid email format
- `dateOfBirth`: Optional, valid date, not in future

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `CONFLICT`: Customer with same phone already exists in tenant
- `UNAUTHORIZED`: Not authenticated

**Side effects**:
- Creates customer record
- Records consent timestamp and IP if consent given

---

### Employee Endpoints

#### `employees.list`

**Type**: Protected procedure (query)

**Purpose**: List all employees for tenant

**Request**:
```typescript
{
  includeInactive?: boolean; // Default false
}
```

**Response**:
```typescript
{
  employees: Array<{
    id: number;
    name: string;
    email: string;
    role: 'owner' | 'admin' | 'employee';
    isActive: boolean;
    commissionRate: number | null;
  }>;
}
```

**Validation**: None

**Error codes**:
- `UNAUTHORIZED`: Not authenticated

---

#### `employees.deactivate`

**Type**: Protected procedure (mutation)

**Purpose**: Soft delete employee

**Request**:
```typescript
{
  employeeId: number;
  reassignTo?: number; // Employee ID to reassign future appointments to
  cancelFutureAppointments?: boolean; // If true, cancel instead of reassign
}
```

**Response**:
```typescript
{
  employeeId: number;
  deactivated: boolean;
  futureAppointmentsCount: number;
  reassignedCount: number;
  canceledCount: number;
}
```

**Validation**:
- `employeeId`: Required, must exist and be active
- `reassignTo`: Optional, must be active employee if provided
- Cannot deactivate last active owner

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `NOT_FOUND`: Employee not found
- `FORBIDDEN`: Insufficient permissions or trying to deactivate last owner

**Side effects**:
- Sets `isActive = false` and `deactivatedAt` timestamp
- Reassigns or cancels future appointments
- Sends notifications to affected customers
- Creates audit log entry

---

### Payment Endpoints

#### `payments.createCheckoutSession`

**Type**: Protected procedure (mutation)

**Purpose**: Create Stripe Checkout session for appointment payment

**Request**:
```typescript
{
  appointmentId: number;
}
```

**Response**:
```typescript
{
  sessionId: string;
  checkoutUrl: string;
}
```

**Validation**:
- `appointmentId`: Required, must exist, must not already be paid

**Error codes**:
- `BAD_REQUEST`: Appointment already paid
- `NOT_FOUND`: Appointment not found
- `INTERNAL_SERVER_ERROR`: Stripe API error

**Side effects**:
- Creates Stripe Checkout session
- Records session ID in database for webhook verification

---

#### `payments.webhook`

**Type**: Public procedure (mutation) - called by Stripe

**Purpose**: Handle Stripe webhook events

**Request**: Raw Stripe webhook payload with signature header

**Response**:
```typescript
{
  received: true;
}
```

**Validation**:
- Verifies Stripe webhook signature
- Validates event type

**Error codes**:
- `BAD_REQUEST`: Invalid signature or payload
- `INTERNAL_SERVER_ERROR`: Processing error

**Side effects** (depends on event type):
- `checkout.session.completed`: Marks appointment as paid, sends confirmation
- `charge.refunded`: Updates payment status, creates refund record

---

### Reporting Endpoints

#### `reports.dailySales`

**Type**: Protected procedure (query)

**Purpose**: Get daily sales report

**Request**:
```typescript
{
  date: string; // YYYY-MM-DD
}
```

**Response**:
```typescript
{
  date: string;
  totalRevenue: number;
  totalTransactions: number;
  averageTransaction: number;
  paymentMethods: {
    cash: number;
    card: number;
    vipps: number;
  };
  topServices: Array<{
    serviceName: string;
    count: number;
    revenue: number;
  }>;
  topEmployees: Array<{
    employeeName: string;
    revenue: number;
    transactionCount: number;
  }>;
}
```

**Validation**:
- `date`: Required, valid date format

**Error codes**:
- `BAD_REQUEST`: Invalid date
- `UNAUTHORIZED`: Not authenticated
- `FORBIDDEN`: Employee role cannot access (owner/admin only)

---

#### `reports.export`

**Type**: Protected procedure (mutation)

**Purpose**: Generate and download CSV export

**Request**:
```typescript
{
  reportType: 'sales' | 'appointments' | 'customers';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  employeeId?: number; // Filter by employee
}
```

**Response**:
```typescript
{
  downloadUrl: string; // Pre-signed URL to download CSV
  expiresAt: Date;
}
```

**Validation**:
- `reportType`: Required, must be valid type
- `startDate`: Required, valid date
- `endDate`: Required, valid date, must be after startDate
- Date range max 1 year

**Error codes**:
- `BAD_REQUEST`: Validation failure
- `UNAUTHORIZED`: Not authenticated
- `FORBIDDEN`: Insufficient permissions

**Side effects**:
- Generates CSV file with UTF-8 BOM encoding
- Uploads to S3 with 1-hour expiration
- Creates audit log entry

---

## SECTION 6 – UI/UX & Application Structure

### Page Map

Stylora consists of two main applications: **Public Booking Site** (for customers) and **Admin Dashboard** (for salon staff).

#### Public Booking Site

1. **Landing Page** (`/`)
   - Hero section with value proposition
   - Feature overview
   - Pricing
   - FAQ
   - Call-to-action to start trial

2. **Booking Page** (`/book/:subdomain`)
   - Service selection
   - Employee selection (optional: "Ingen preferanse")
   - Date and time selection
   - Customer information form
   - Confirmation

3. **Booking Confirmation** (`/booking/:id/confirm`)
   - Appointment details
   - Add to calendar button
   - Cancellation/reschedule link

#### Admin Dashboard

1. **Login** (`/login`)
   - Manus OAuth login button
   - "Ny salon? Kom i gang" link to onboarding

2. **Dashboard** (`/dashboard`)
   - Today's appointments (list view)
   - Quick stats: today's revenue, upcoming appointments, pending payments
   - Quick actions: New appointment, New customer, Check in customer

3. **Timebok (Calendar)** (`/timebok`)
   - Week view (default)
   - Day view toggle
   - Employee filter (show all or specific employee)
   - Appointment cards with customer name, service, time
   - Drag-and-drop to reschedule
   - Click appointment to view details/edit/cancel

4. **Customers** (`/customers`)
   - List view with search
   - Customer cards: name, phone, last visit, total visits
   - Click to view customer detail page

5. **Customer Detail** (`/customers/:id`)
   - Customer info (editable)
   - Visit history (chronological list)
   - Notes section
   - Quick action: Book new appointment

6. **Employees** (`/employees`)
   - List of staff members
   - Add new employee button
   - Edit employee (name, role, commission settings, schedule)
   - Deactivate employee

7. **Services** (`/services`)
   - List of services grouped by category
   - Add/edit service: name, duration, price, description
   - Activate/deactivate service

8. **Products & Inventory** (`/inventory`)
   - Product list with stock levels
   - Low stock warnings (highlighted)
   - Add/edit product
   - Stock adjustment modal

9. **Reports** (`/reports`)
   - Date range selector
   - Report type tabs: Sales, Services, Employees, Products
   - Charts: Revenue trend, top services, employee performance
   - Export button (CSV download)

10. **Settings** (`/settings`)
    - Salon info (name, address, contact)
    - Booking settings (cancellation policy, buffer time, advance booking limit)
    - Notification settings (SMS provider, email provider)
    - Subscription and billing

### Navigation Structure

#### Public Site

- **Top bar**: Logo, "Prøv gratis" button
- **Footer**: Links to pricing, FAQ, contact, privacy policy

#### Admin Dashboard

- **Sidebar** (persistent, collapsible on mobile):
  - Dashboard
  - Timebok
  - Customers
  - Employees
  - Services
  - Inventory
  - Reports
  - Settings

- **Top bar**:
  - Salon name (with tenant switcher if user has multiple tenants)
  - Search (global: customers, appointments)
  - Notifications bell icon
  - User profile menu (logout)

### Layout Guidelines (Next.js + React + TailwindCSS)

Stylora uses a modern, clean design with Norwegian sensibilities:

**Color Palette**:
- Primary: Deep blue (#1E3A8A) - trust, professionalism
- Accent: Warm orange (#F97316) - energy, action
- Success: Green (#10B981)
- Warning: Amber (#F59E0B)
- Error: Red (#EF4444)
- Neutral: Gray scale (#F9FAFB to #111827)

**Typography**:
- Headings: Inter (sans-serif), bold, large sizes
- Body: Inter, regular, 16px base size
- UI elements: Inter, medium, 14px

**Spacing**:
- Consistent 8px grid system
- Component padding: 16px (mobile), 24px (desktop)
- Section spacing: 48px (mobile), 96px (desktop)

**Components**:
- Rounded corners: 8px (buttons, cards), 12px (modals)
- Shadows: Subtle, layered (0 1px 3px rgba(0,0,0,0.1))
- Buttons: Large touch targets (min 44px height), clear hover states
- Forms: Clear labels above inputs, inline validation, helpful error messages

### Accessibility Considerations

**Contrast**: All text meets WCAG AA standards (4.5:1 for body text, 3:1 for large text)

**Font sizes**: Minimum 14px for UI text, 16px for body content, scalable with browser zoom

**Keyboard usage**:
- All interactive elements are keyboard accessible
- Clear focus indicators (blue outline)
- Logical tab order
- Escape key closes modals
- Enter key submits forms

**Screen readers**:
- Semantic HTML (nav, main, section, article)
- ARIA labels for icon-only buttons
- ARIA live regions for dynamic content (notifications, loading states)

**Color independence**: Information is not conveyed by color alone (icons, text labels accompany color coding)

### Consistent Design System

Stylora uses a **design token system** to ensure consistency:

**Colors**: Defined as CSS variables in `index.css`, referenced throughout components

**Spacing**: Tailwind spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96)

**Typography**: Defined text styles (heading-1, heading-2, body, caption) as Tailwind classes

**Components**: Reusable components in `client/src/components/ui/` (Button, Card, Input, Modal, etc.) built with shadcn/ui

**Icons**: Lucide React icon library for consistency

This design system is documented in `DESIGN_SYSTEM.md` for future developers.

---

## SECTION 7 – Workflow Descriptions

### New Salon Onboarding

**Goal**: Take a new salon from signup to first booking in under 10 minutes.

**Steps**:

1. **Create Tenant**
   - User visits landing page, clicks "Prøv gratis i 14 dager"
   - Fills out form: salon name, subdomain, contact info
   - System creates tenant with status `trial`, sets `trial_ends_at` to 14 days from now
   - User is redirected to Manus OAuth login

2. **Invite Owner**
   - After OAuth, user is created with role `owner` and linked to tenant
   - User lands on dashboard with onboarding checklist overlay

3. **Set Opening Hours**
   - Checklist prompts: "Sett opp åpningstider"
   - User clicks, opens modal with weekly schedule form
   - User sets hours for each day (e.g., Mon-Fri 09:00-17:00, Sat 09:00-15:00, Sun closed)
   - System saves default schedule (used for all employees initially)

4. **Set Employees**
   - Checklist prompts: "Legg til ansatte"
   - User clicks, opens employee form
   - User adds employees: name, email, role, schedule (defaults to salon hours, editable)
   - System creates employee records, sends invitation emails (optional)

5. **Add Services**
   - Checklist prompts: "Legg til tjenester"
   - User clicks, opens service form
   - User adds services: name, duration, price (e.g., "Herreklipp", 30 min, 350 NOK)
   - System creates service records

6. **Go Live**
   - Checklist shows: "Alt klart! Åpne for online booking"
   - User clicks "Aktiver online booking"
   - System generates public booking URL: `https://barberco.stylora.no/book`
   - User receives confirmation: "Din online booking er nå aktiv! Del denne lenken med kundene dine."

**Success Criteria**: Salon can receive online bookings within 10 minutes of signup.

### Customer Books Online

**Goal**: Customer books appointment in under 2 minutes without creating account.

**Steps**:

1. **Customer Flow**
   - Customer visits `https://barberco.stylora.no/book` (from salon's website, social media, or Google)
   - Sees salon name, address, phone number at top

2. **Select Service**
   - Customer sees list of available services with names, durations, and prices
   - Clicks desired service (e.g., "Herreklipp - 30 min - 350 NOK")

3. **Select Employee (Optional)**
   - Customer sees list of available employees with photos (if uploaded)
   - Can select specific employee or choose "Ingen preferanse" (system assigns based on availability)

4. **Select Date and Time**
   - Calendar view shows next 60 days (configurable)
   - Customer selects date
   - Available time slots are displayed (e.g., 09:00, 09:30, 10:00, ...)
   - Unavailable slots are grayed out
   - Customer clicks desired time slot

5. **Timeslot Validation**
   - System checks availability in real-time
   - If slot is still available, creates temporary reservation (5-minute hold)
   - Shows countdown: "Denne tiden er reservert for deg i 4:32"

6. **Enter Information**
   - Customer fills out form: first name, last name, phone number, email (optional)
   - Optional: "Har du noen spesielle ønsker eller allergier?" (notes field)
   - Checkbox: "Jeg vil motta påminnelser på SMS" (pre-checked)
   - Checkbox: "Jeg vil motta tilbud og nyheter på SMS" (opt-in for marketing)

7. **Confirmation**
   - Customer clicks "Bekreft bestilling"
   - System creates appointment with status `confirmed`
   - System creates or updates customer record
   - System queues confirmation SMS and email
   - Customer sees confirmation page: "Din time er bekreftet! Vi gleder oss til å se deg."
   - Confirmation shows: date, time, service, employee, salon address
   - "Legg til i kalender" button (generates .ics file)
   - "Avbestill eller endre" link

8. **Reminders**
   - 24 hours before: SMS reminder sent
   - 2 hours before: SMS reminder sent
   - Each reminder includes link to cancel/reschedule

9. **Completion**
   - Customer arrives at salon
   - Staff checks in customer (marks appointment as in progress)
   - After service, staff marks appointment as completed
   - System updates customer visit history (total visits +1, last visit date)

**Success Criteria**: Customer completes booking in under 2 minutes, receives confirmation within 30 seconds.

### Employee Soft Delete

**Goal**: Remove employee from active use while preserving historical data.

**Steps**:

1. **Business Rules**
   - Only owner or admin can deactivate employees
   - Cannot deactivate last active owner (must transfer ownership first)
   - Cannot deactivate employee with unpaid commissions (must settle first)

2. **Initiate Deactivation**
   - Admin navigates to Employees page
   - Clicks "Deaktiver" button on employee card
   - System checks for future appointments assigned to this employee

3. **Handle Future Bookings**
   - If employee has future appointments, system shows modal:
     - "Denne ansatte har X fremtidige timer. Hva vil du gjøre?"
     - Option 1: "Overfør til annen ansatt" (dropdown to select employee)
     - Option 2: "Avbestill alle timer"
     - Option 3: "La meg håndtere manuelt" (deactivates employee but leaves appointments)
   - Admin selects option and confirms

4. **Reassigning Future Bookings**
   - If admin selects "Overfør til annen ansatt":
     - System checks availability of target employee for each appointment
     - If target employee is available, reassigns appointment
     - If target employee is not available, adds appointment to "Requires manual handling" list
     - System sends SMS to each affected customer: "Din time hos [Old Employee] er flyttet til [New Employee] på grunn av endringer i vår bemanning. Samme tid: [Date] kl [Time]. Spørsmål? Ring oss på [Phone]."

5. **Canceling Appointments**
   - If admin selects "Avbestill alle timer":
     - System cancels all future appointments with reason "Employee no longer available"
     - System sends SMS to each customer: "Din time hos [Salon] må dessverre avbestilles på grunn av endringer i vår bemanning. Bestill ny time her: [Booking Link]"

6. **Deactivation**
   - System sets `isActive = false` and `deactivatedAt = NOW()`
   - Employee disappears from:
     - Online booking employee selection
     - Appointment creation employee dropdown
     - Active employee lists
   - Employee remains visible in:
     - Historical appointment records (with "(inaktiv)" suffix)
     - Sales reports for past periods
     - Audit logs

7. **Logging the Change**
   - System creates audit log entry:
     - Action: `employee_deactivated`
     - Entity: `employee`
     - Entity ID: employee ID
     - Before value: `{ isActive: true }`
     - After value: `{ isActive: false, deactivatedAt: '2025-01-15T10:30:00Z' }`
     - User: admin who performed action
     - Timestamp: now

**Success Criteria**: Employee is removed from active use, future bookings are handled appropriately, historical data remains intact.

### Day Closing (Kasseoppgjør)

**Goal**: Reconcile cash register at end of business day, generate close-of-day report.

**Steps**:

1. **Aggregate Sales**
   - At end of day, staff navigates to Dashboard
   - Clicks "Avslutt dag" button
   - System aggregates all sales for current date:
     - Total revenue
     - Breakdown by payment method (cash, card, Vipps)
     - Number of transactions
     - List of all transactions (appointment-based and direct sales)

2. **Compare with Payments**
   - System calculates expected cash: opening balance + cash payments - cash refunds
   - System displays expected amounts:
     - Expected cash: X NOK
     - Expected card: Y NOK (verified via Stripe/terminal)
     - Expected Vipps: Z NOK (verified via Vipps)

3. **Physical Count**
   - Staff counts physical cash in register
   - Enters actual cash amount in form
   - System compares expected vs actual

4. **Handle Discrepancy**
   - If amounts match: "Kassen stemmer! Ingen avvik." (green checkmark)
   - If discrepancy exists: "Avvik: [Difference] NOK. Forventet [Expected], faktisk [Actual]" (yellow warning)
   - Staff enters explanation in text field (required if discrepancy > 50 NOK)

5. **Generate Report**
   - System generates close-of-day report (PDF):
     - Salon name and date
     - Total sales: X NOK
     - Payment method breakdown
     - Number of transactions
     - Cash discrepancy (if any) with explanation
     - Staff member who closed: [Name]
     - Timestamp: [Date Time]
   - Report is saved to database and emailed to owner

6. **Lock the Day**
   - System creates `cash_register_shifts` record with status `closed`
   - Day is locked—past transactions cannot be edited (prevents fraud)
   - Staff sees confirmation: "Dagen er avsluttet. Rapporten er sendt til [Owner Email]."

**Success Criteria**: Cash register is reconciled, discrepancies are documented, day is locked to prevent tampering.

### CSV Export

**Goal**: Generate accounting-friendly CSV export for external use.

**Steps**:

1. **Filter Selection**
   - User navigates to Reports page
   - Clicks "Eksporter" button
   - Modal opens with export options:
     - Report type: Sales, Appointments, Customers, Inventory
     - Date range: Start date, end date (max 1 year)
     - Employee filter: All employees, or select specific employee
     - Format: CSV (default), Excel (future)

2. **Generation**
   - User clicks "Generer eksport"
   - System queues background job (to avoid blocking UI for large exports)
   - User sees: "Eksporten genereres. Du får en e-post når den er klar."

3. **Processing**
   - Background worker picks up job
   - Queries database based on filters
   - Generates CSV with columns appropriate for report type

   **Sales CSV columns**:
   - Date (YYYY-MM-DD)
   - Time (HH:MM)
   - Customer name
   - Employee name
   - Service/Product name
   - Quantity
   - Unit price (excl. VAT)
   - VAT rate (%)
   - VAT amount
   - Total (incl. VAT)
   - Payment method
   - Account code (Norwegian standard)

4. **Encoding**
   - CSV is encoded as UTF-8 with BOM (Byte Order Mark)
   - This ensures Excel on Windows correctly displays Norwegian characters (æ, ø, å)

5. **Upload and Notify**
   - CSV file is uploaded to S3 with 24-hour expiration
   - System generates pre-signed download URL
   - System sends email to user: "Din eksport er klar. Last ned her: [Link] (lenken utløper om 24 timer)"

6. **Download**
   - User clicks link in email
   - CSV file downloads
   - User opens in Excel or imports to accounting software (Tripletex, PowerOffice, etc.)

**Success Criteria**: Export completes within 5 minutes for typical data volumes, file opens correctly in Excel with Norwegian characters intact.

---

## SECTION 8 – Infrastructure & Deployment

### Recommended Stack

**Frontend**: Next.js 14+ (App Router) deployed on Vercel

**Backend**: Next.js API routes (same deployment as frontend)

**Database**: Supabase PostgreSQL (managed, with automatic backups) or TiDB Cloud (MySQL-compatible, serverless)

**Authentication**: Manus OAuth (already integrated in template)

**File Storage**: Supabase Storage (S3-compatible) or AWS S3 directly

**Queue System**: Supabase Edge Functions with cron triggers, or QStash (Upstash) for background jobs

**Email Provider**: Resend (Norwegian-friendly, good deliverability)

**SMS Provider**: Link Mobility (Norwegian provider) or Twilio (international)

**Payment Processing**: Stripe (supports NOK, excellent documentation)

### CI/CD

**GitHub Actions Workflow**:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: pnpm install
      - run: pnpm test
      - run: pnpm check # TypeScript type checking

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: vercel/actions@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

**Deployment Flow**:
1. Developer pushes to `main` branch
2. GitHub Actions runs tests and type checking
3. If tests pass, deploys to Vercel production
4. Vercel automatically runs database migrations (via `pnpm db:push` in build step)
5. Deployment completes, new version is live

**Environment Variables** (stored in Vercel):
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Session signing secret
- `STRIPE_SECRET_KEY`: Stripe API key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret
- `SMS_PROVIDER_API_KEY`: SMS provider credentials
- `EMAIL_PROVIDER_API_KEY`: Email provider credentials
- `NEXT_PUBLIC_APP_URL`: Base URL for the application

### Monitoring & Logging

**Error Tracking**: Sentry

- Captures unhandled exceptions in both frontend and backend
- Groups similar errors for easier triage
- Sends alerts to Slack when error rate spikes

**Request Logging**:

- All API requests are logged with: timestamp, method, path, user ID, tenant ID, duration, status code
- Logs are stored in Vercel logs (searchable for 7 days on Pro plan)
- For longer retention, stream logs to external service (Logtail, Datadog)

**Performance Monitoring**:

- Vercel Analytics tracks page load times, Core Web Vitals
- Custom metrics: time to first appointment, booking conversion rate

**Uptime Monitoring**:

- UptimeRobot pings health check endpoint (`/api/health`) every 5 minutes
- Alerts via email/SMS if endpoint is down for > 2 minutes

---

## SECTION 9 – Subscription & Billing

### Plan Definitions

Stylora offers three subscription tiers:

#### Start / Lite

**Price**: 299 NOK/month

**Features**:
- 1 employee (owner)
- 1 location
- 100 SMS/month
- Online booking
- Customer management
- Basic reports (daily, weekly)
- Email support

**Target**: Single-chair barbershops, solo hairstylists

---

#### Pro

**Price**: 799 NOK/month

**Features**:
- Up to 5 employees
- 1 location
- 500 SMS/month
- All Start features, plus:
- Inventory management
- Commission tracking
- Advanced reports (monthly, per-employee, per-service)
- Priority email support

**Target**: Small to medium salons (2-5 employees)

---

#### Premium

**Price**: 1499 NOK/month

**Features**:
- Unlimited employees
- Multiple locations
- 2000 SMS/month
- All Pro features, plus:
- Multi-location management
- API access (for integrations)
- Custom reports
- Dedicated account manager
- Phone support

**Target**: Salon chains, large salons

---

### Stripe Integration for Recurring Subscriptions

**Setup**:

1. Create Stripe products and prices for each plan (Start, Pro, Premium)
2. Configure webhook endpoint: `/api/payments/stripe/webhook`
3. Subscribe to events: `customer.subscription.created`, `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`

**Subscription Flow**:

1. **Customer Selects Plan**
   - During onboarding or in Settings > Subscription
   - User clicks "Velg [Plan Name]"
   - System creates Stripe Checkout session with:
     - Price ID for selected plan
     - Customer email (pre-filled)
     - Success URL: `/dashboard?subscription=success`
     - Cancel URL: `/settings/subscription`

2. **Customer Completes Payment**
   - Redirected to Stripe-hosted checkout page
   - Enters card details
   - Stripe processes payment

3. **Webhook: `customer.subscription.created`**
   - Stripe sends webhook to Stylora
   - System verifies webhook signature
   - Extracts subscription data: customer ID, subscription ID, plan, status, current period
   - Creates or updates `tenant_subscriptions` record:
     - `stripe_subscription_id`: subscription ID from Stripe
     - `plan_id`: corresponding plan in Stylora database
     - `status`: 'active'
     - `current_period_start`: start date
     - `current_period_end`: end date
   - Updates tenant status from 'trial' to 'active'

4. **Webhook: `invoice.paid`**
   - Stripe sends webhook on successful payment (initial and recurring)
   - System updates `current_period_end` to next billing date
   - System sends receipt email to customer

5. **Webhook: `invoice.payment_failed`**
   - Stripe sends webhook if payment fails (expired card, insufficient funds)
   - System updates subscription status to 'past_due'
   - System sends email to customer: "Betalingen din feilet. Vennligst oppdater betalingsmetoden din for å fortsette å bruke Stylora."
   - System displays banner in dashboard: "Abonnementet ditt er forfalt. Oppdater betalingsmetode."

6. **Webhook: `customer.subscription.updated`**
   - Stripe sends webhook when subscription changes (upgrade, downgrade, cancellation)
   - System updates `tenant_subscriptions` record with new plan and dates
   - If upgrade: features unlock immediately
   - If downgrade: features remain until current period ends, then downgrade takes effect

### Locking Features on Non-Paying Tenants

**Grace Period**:

- When payment fails, tenant enters 'past_due' status
- Grace period: 7 days
- During grace period: all features remain active, but banner is displayed

**After Grace Period**:

- If payment still not received, tenant status changes to 'suspended'
- Features are locked:
  - Online booking: disabled (customers see "Denne salongen tar ikke imot online bestillinger for øyeblikket")
  - Admin dashboard: read-only mode (can view data, cannot create/edit)
  - Notifications: disabled (no SMS/email sent)
- Existing appointments remain visible (cannot cancel/reschedule)
- Data is retained (not deleted)

**Reactivation**:

- Customer updates payment method in Stripe billing portal
- Stripe processes payment
- Webhook `invoice.paid` is received
- System updates status to 'active'
- All features unlock immediately
- Customer receives email: "Velkommen tilbake! Abonnementet ditt er nå aktivt igjen."

### Grace Period Handling

**Timeline**:

- Day 0: Payment fails, status = 'past_due', grace period starts
- Day 1-7: Daily reminder emails sent to customer
- Day 7: Final warning email: "Siste sjanse: Abonnementet ditt vil bli suspendert i morgen"
- Day 8: Status changes to 'suspended', features locked

**Customer Communication**:

- All emails include direct link to Stripe billing portal for easy payment method update
- Emails are friendly but urgent: "Vi vil ikke at du skal miste tilgangen din. Oppdater betalingsmetoden din i dag."

---

## SECTION 10 – Future Roadmap

### Phase 1: Core Stability (Months 1-3)

- Launch MVP with Start and Pro plans
- Onboard first 50 salons (beta customers)
- Gather feedback, fix critical bugs
- Optimize performance and reliability

### Phase 2: Enhanced Features (Months 4-6)

**POS (Point-of-Sale) Enhancements**:
- Barcode scanner integration for product sales
- Receipt printing (thermal printer support)
- Tip handling (staff can add tips at checkout)

**AI-Driven Insights**:
- Predictive analytics: "Customers who book [Service A] often return for [Service B] within 6 weeks. Consider sending targeted promotions."
- Optimal pricing suggestions: "Your [Service] is priced 15% below market average. Consider raising to X NOK."
- Staffing recommendations: "Thursdays 14:00-16:00 have high demand. Consider adding staff during this time."

### Phase 3: Marketing Tools (Months 7-9)

**SMS Campaigns**:
- Bulk SMS to customer segments (e.g., "Customers who haven't visited in 3+ months")
- Automated campaigns: birthday discounts, seasonal promotions
- A/B testing for message content

**Email Campaigns**:
- Newsletter builder with drag-and-drop editor
- Automated email sequences (welcome series, re-engagement)
- Campaign analytics (open rate, click rate, conversion)

### Phase 4: Multi-Branch Management (Months 10-12)

**Chain Support**:
- Parent account with multiple child locations
- Centralized reporting across all locations
- Customer data shared across locations (customer can book at any branch)
- Inventory transfer between locations

**Franchise Features**:
- Franchise owner can set policies for all franchisees
- Franchisees have limited autonomy (cannot change certain settings)
- Consolidated reporting for franchise owner

### Phase 5: Advanced Integrations (Year 2)

**Gift Cards & Memberships**:
- Sell gift cards (physical and digital)
- Track gift card balances and redemptions
- Membership plans (e.g., "Unlimited haircuts for 2000 NOK/month")
- Membership auto-renewal via Stripe

**Accounting System Integration**:
- Direct integration with Tripletex (most popular in Norway)
- Automatic sync of sales data to accounting system
- Reduced manual data entry for accountants
- Integration with PowerOffice, Visma, and other Norwegian accounting platforms

**Vipps Integration**:
- Native Vipps payment in booking flow
- Vipps recurring payments for subscriptions
- Vipps QR code for in-salon payments

### Phase 6: Platform & API (Year 2+)

**Public API**:
- RESTful API for third-party integrations
- Webhooks for real-time event notifications (new booking, cancellation, payment)
- API documentation with interactive examples

**Marketplace**:
- Third-party developers can build integrations and plugins
- Salon owners can browse and install integrations (e.g., "Instagram Auto-Posting", "Google Ads Integration")

**White Label**:
- Large salon chains can white-label Stylora
- Custom branding (logo, colors, domain)
- Premium pricing tier for white-label customers

---

## Conclusion

This specification provides a complete blueprint for building Stylora, a production-grade SaaS platform tailored for Norwegian salons. Every section is designed with real-world implementation in mind, balancing technical depth with practical business considerations.

The focus on **simplicity** (enkelt og ryddig UX), **Norwegian-first design** (Vipps, VAT, SAF-T), and **vertical integration** (all features in one system) positions Stylora to solve the specific pain points of Norwegian salon owners better than generic international competitors.

The architecture is **scalable** (multi-tenant, horizontal scaling), **secure** (GDPR-compliant, encrypted), and **reliable** (transactions, backups, monitoring), ensuring that Stylora can grow from a startup serving 50 salons to a market leader serving thousands.

The **roadmap** provides a clear path from MVP to advanced features, allowing the team to ship value quickly while building toward a comprehensive platform that salon owners will rely on daily.

This is not a generic SaaS template—it is a deeply considered, Norwegian-market-specific solution ready to be built by a senior engineering team.
