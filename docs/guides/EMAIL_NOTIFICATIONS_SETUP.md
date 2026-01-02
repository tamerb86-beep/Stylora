# Email Notifications Setup Guide

Complete guide for configuring and using email notifications in Stylora.

---

## Overview

Stylora automatically sends email notifications to customers for:

1. **Booking Confirmation** - When appointment status changes to "confirmed"
   - Triggered by Stripe payment completion (webhook)
   - Triggered by manual status update (staff confirmation)

2. **Booking Cancellation** - When appointment status changes to "canceled"
   - Triggered by staff cancellation
   - Includes cancellation reason if provided

**Email Templates:**
- Norwegian language (Norsk bokmål)
- Professional HTML design with gradient headers
- Responsive layout for mobile devices
- Includes salon name, customer name, date, time, and services

---

## SMTP Configuration

### Required Environment Variables

Add these to your `.env` file or environment configuration:

```bash
# SMTP Server Configuration
SMTP_HOST=smtp.example.com          # Your SMTP server hostname
SMTP_PORT=587                        # SMTP port (587 for TLS, 465 for SSL)
SMTP_USER=your-email@example.com    # SMTP username
SMTP_PASS=your-password              # SMTP password
SMTP_FROM_EMAIL=no-reply@stylora.app  # From email address
```

### Common SMTP Providers

#### Gmail

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password  # Use App Password, not regular password
SMTP_FROM_EMAIL=your-gmail@gmail.com
```

**Note:** Enable "2-Step Verification" and generate an "App Password" at https://myaccount.google.com/apppasswords

#### SendGrid

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey  # Literally "apikey"
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxxx  # Your SendGrid API key
SMTP_FROM_EMAIL=no-reply@yourdomain.com
```

#### Mailgun

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@yourdomain.com
SMTP_PASS=your-mailgun-password
SMTP_FROM_EMAIL=no-reply@yourdomain.com
```

#### Office 365 / Outlook

```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-email@yourdomain.com
SMTP_PASS=your-password
SMTP_FROM_EMAIL=your-email@yourdomain.com
```

---

## How It Works

### Automatic Triggers

**1. Stripe Payment Completion**

When a customer completes payment via Stripe Checkout:

```
Customer pays → Stripe webhook → Payment status = "completed" 
→ Appointment status = "confirmed" → Confirmation email sent
```

**2. Manual Status Update**

When staff manually confirms or cancels an appointment:

```
Staff updates status → appointments.updateStatus mutation 
→ Email sent (if status transitions to "confirmed" or "canceled")
```

### Email Sending Logic

- **Non-blocking:** Email sending runs asynchronously and never blocks main logic
- **Graceful degradation:** If SMTP is not configured, emails are skipped with a warning log
- **Customer email required:** If customer has no email, email is skipped (logged)
- **Transition-based:** Emails only sent when status *changes* to confirmed/canceled
  - Updating "confirmed" → "confirmed" does NOT send email
  - Updating "canceled" → "canceled" does NOT send email

---

## Email Templates

### Confirmation Email

**Subject:** `Bekreftelse på timebestilling hos {Salon Name}`

**Content:**
- ✂️ Header: "Timebestilling bekreftet"
- Customer name greeting
- Appointment details (date, time, services)
- Salon branding

**Example:**

```
Hei John Doe,

Vi bekrefter din timebestilling hos Test Salon.

📅 Dato: 25. mars 2026
🕐 Klokkeslett: 14:30
💇 Tjenester: Herreklipp, Skjeggstuss

Velkommen!

Hilsen
Test Salon
```

### Cancellation Email

**Subject:** `Timebestilling hos {Salon Name} er kansellert`

**Content:**
- ❌ Header: "Timebestilling kansellert"
- Customer name greeting
- Appointment details (date, time)
- Invitation to rebook

**Example:**

```
Hei John Doe,

Vi informerer om at din time hos Test Salon er kansellert.

📅 Dato: 25. mars 2026
🕐 Klokkeslett: 14:30

Ta gjerne kontakt dersom du ønsker å bestille ny time.

Hilsen
Test Salon
```

---

## Testing Email Notifications

### Local Testing with Mailtrap

For development, use [Mailtrap](https://mailtrap.io/) to catch emails:

```bash
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
SMTP_FROM_EMAIL=test@stylora.app
```

All emails will be captured in Mailtrap inbox (not sent to real customers).

### Running Tests

```bash
# Run email notification test suite
pnpm test server/email-notifications.test.ts
```

**Test Coverage:**
- ✅ Email template rendering (Norwegian text)
- ✅ Confirmation email on status transition to "confirmed"
- ✅ Cancellation email on status transition to "canceled"
- ✅ No duplicate emails when status unchanged
- ✅ Graceful handling when customer has no email
- ✅ Norwegian date formatting

### Manual Testing

1. **Create a test customer with your email:**

```sql
INSERT INTO customers (tenantId, firstName, lastName, phone, email)
VALUES ('your-tenant-id', 'Test', 'Customer', '+4712345678', 'your-email@example.com');
```

2. **Create an appointment:**

Use the admin dashboard or tRPC mutation:

```typescript
const result = await trpc.appointments.create.mutate({
  customerId: 123,
  employeeId: 456,
  appointmentDate: "2026-03-25",
  startTime: "14:30",
  endTime: "15:00",
  serviceIds: [789],
});
```

3. **Confirm the appointment:**

```typescript
await trpc.appointments.updateStatus.mutate({
  id: result.appointmentId,
  status: "confirmed",
});
```

4. **Check your email inbox** for the confirmation email.

---

## Monitoring & Logs

### Console Logs

Email sending produces detailed console logs:

**Success:**
```
[Email] Sent successfully to: customer@example.com
[Email] Confirmation email sent for appointment: 123
```

**Skipped (no SMTP config):**
```
[Email] SMTP not configured, skipping email to: customer@example.com
```

**Skipped (no customer email):**
```
[Email] Customer has no email, skipping confirmation email
```

**Error:**
```
[Email] Failed to send to: customer@example.com Error: Connection timeout
[Appointments] Failed to send confirmation email: Error: ...
```

### Production Monitoring

For production, consider:

1. **Email delivery monitoring** - Track delivery rates via your SMTP provider dashboard
2. **Error alerting** - Set up alerts for repeated email failures
3. **Bounce handling** - Monitor bounced emails and update customer records
4. **Unsubscribe handling** - Implement unsubscribe links (future enhancement)

---

## Troubleshooting

### Emails Not Sending

**1. Check SMTP configuration:**

```bash
# Verify environment variables are set
echo $SMTP_HOST
echo $SMTP_PORT
echo $SMTP_USER
echo $SMTP_PASS
```

**2. Check console logs:**

Look for `[Email]` prefixed messages to see why emails are skipped.

**3. Test SMTP connection:**

Use a tool like `telnet` or `openssl`:

```bash
# Test TLS connection
openssl s_client -connect smtp.example.com:587 -starttls smtp
```

**4. Verify customer has email:**

```sql
SELECT id, firstName, lastName, email 
FROM customers 
WHERE id = 123;
```

### Emails Going to Spam

**Solutions:**

1. **Use a verified domain** - Configure SPF, DKIM, and DMARC records
2. **Use a reputable SMTP provider** - SendGrid, Mailgun, etc.
3. **Avoid spam trigger words** - Review email content
4. **Include unsubscribe link** - (Future enhancement)

### Gmail App Password Not Working

**Steps:**

1. Enable 2-Step Verification: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character app password (no spaces) as `SMTP_PASS`

---

## Future Enhancements

Potential improvements for email notifications:

1. **Appointment reminders** - Send reminder emails 24h before appointment
2. **Payment receipts** - Email receipt after payment completion
3. **Unsubscribe links** - Allow customers to opt out of emails
4. **Email templates customization** - Let salon owners customize email content
5. **Multi-language support** - Support English, Swedish, Danish, etc.
6. **Email tracking** - Track open rates and click rates
7. **SMS fallback** - Send SMS if email fails

---

## Code Reference

### Key Files

- **`server/email.ts`** - Email sending helper and templates
- **`server/notifications-appointments.ts`** - Appointment notification triggers
- **`server/stripe-webhook.ts`** - Stripe webhook with email trigger
- **`server/routers.ts`** - appointments.updateStatus with email trigger
- **`server/email-notifications.test.ts`** - Test suite

### Email Helper Functions

```typescript
// Send any email
import { sendEmail } from "./server/email";

await sendEmail({
  to: "customer@example.com",
  subject: "Your subject",
  html: "<h1>Your HTML content</h1>",
});

// Render confirmation email
import { renderBookingConfirmationEmail } from "./server/email";

const { subject, html } = renderBookingConfirmationEmail({
  salonName: "Test Salon",
  customerName: "John Doe",
  date: "25. mars 2026",
  time: "14:30",
  services: ["Herreklipp", "Skjeggstuss"],
});

// Send appointment confirmation
import { sendAppointmentConfirmationIfPossible } from "./server/notifications-appointments";

await sendAppointmentConfirmationIfPossible(appointmentId, tenantId);

// Send appointment cancellation
import { sendAppointmentCancellationIfPossible } from "./server/notifications-appointments";

await sendAppointmentCancellationIfPossible(appointmentId, tenantId);
```

---

## Support

For issues or questions:

1. Check console logs for `[Email]` messages
2. Verify SMTP configuration
3. Test with Mailtrap first
4. Review test suite for examples
5. Contact support with error logs

**Email notifications are production-ready and tested!** 🎉
