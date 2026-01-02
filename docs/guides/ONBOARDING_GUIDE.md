# Multi-Tenant Onboarding System Guide

## Overview

The Stylora onboarding system provides a comprehensive, step-by-step wizard for new salon owners to register and set up their accounts. The system includes automated tenant creation, welcome emails, and QR code generation for employees.

---

## Features Implemented

### ✅ Multi-Step Wizard UI
- **Step 1:** Salon Information (name, subdomain, address, city, phone, email)
- **Step 2:** Owner Account Setup (name, email, password)
- **Step 3:** Business Hours Configuration (weekly schedule)
- **Steps 4-7:** Placeholder for employees, services, payment settings, and review (can be completed later)

### ✅ Backend API (tRPC)
- **Subdomain Validation:** Check if subdomain is available before registration
- **Tenant Creation:** Automatically create tenant record with 14-day trial
- **Owner Account:** Create owner user with hashed password
- **Business Hours:** Store weekly schedule in settings
- **Default Services:** Create 3 default services (haircut, beard trim, combo)
- **Default Settings:** Currency (NOK), timezone (Europe/Oslo), language (Norwegian)

### ✅ Welcome Email System
- **Beautiful HTML Template:** Professional RTL (right-to-left) design for Arabic
- **Quick Start Guide:** Step-by-step instructions for new users
- **Feature Highlights:** Visual cards showcasing key features
- **Trial Badge:** Prominent 14-day trial indicator
- **Login Link:** Direct link to dashboard
- **Support Contact:** Email support link

### ✅ QR Code Generation
- **Employee QR Codes:** Unique QR code generated for each employee
- **Check-in Data:** QR code contains employee ID, tenant ID, and type
- **Automatic Generation:** QR codes created during onboarding
- **Stored in Database:** QR code URL saved to user record

---

## API Endpoints

### 1. Check Subdomain Availability

```typescript
trpc.onboarding.checkSubdomain.useQuery({ subdomain: "my-salon" })
```

**Response:**
```json
{
  "available": true
}
```

### 2. Complete Onboarding

```typescript
trpc.onboarding.complete.useMutation({
  salonInfo: {
    salonName: "Royal Salon",
    subdomain: "royal-salon",
    address: "123 Main St",
    city: "Oslo",
    phone: "+47 123 45 678",
    email: "info@royal-salon.no"
  },
  ownerAccount: {
    ownerName: "Ahmed Mohammed",
    ownerEmail: "ahmed@example.com",
    password: "securepassword123",
    confirmPassword: "securepassword123"
  },
  businessHours: {
    mondayOpen: "09:00",
    mondayClose: "18:00",
    // ... other days
    sundayClosed: true
  },
  employees: [
    {
      name: "John Doe",
      email: "john@example.com",
      phone: "+47 987 65 432"
    }
  ],
  services: [
    {
      name: "Haircut",
      duration: 30,
      price: 250
    }
  ]
})
```

**Response:**
```json
{
  "success": true,
  "tenantId": "abc123",
  "subdomain": "royal-salon",
  "email": "ahmed@example.com",
  "message": "تم إنشاء حسابك بنجاح! تحقق من بريدك الإلكتروني للحصول على تعليمات تسجيل الدخول."
}
```

### 3. Generate Employee QR Code

```typescript
trpc.onboarding.generateEmployeeQR.useMutation({
  employeeId: "emp123",
  tenantId: "tenant123"
})
```

**Response:**
```json
{
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

---

## Database Schema

### Tenants Table
```typescript
{
  id: string (nanoid)
  name: string
  subdomain: string (unique)
  address: string
  city: string
  phone: string
  email: string
  subscriptionStatus: "trial" | "active" | "cancelled"
  subscriptionPlan: "professional"
  trialEndsAt: Date (14 days from creation)
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
```

### Users Table (Owners & Employees)
```typescript
{
  id: string (nanoid)
  tenantId: string
  openId: string (unique)
  name: string
  email: string
  password: string (hashed with bcrypt)
  phone: string | null
  role: "owner" | "admin" | "employee"
  pin: string | null (4-digit PIN for employees)
  qrCode: string | null (QR code data URL)
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
```

### Settings Table
```typescript
{
  id: string (nanoid)
  tenantId: string
  key: string
  value: string (JSON for complex data)
  createdAt: Date
  updatedAt: Date
}
```

**Example Settings:**
- `business_hours`: `{"monday": {"open": "09:00", "close": "18:00"}, ...}`
- `booking_enabled`: `"true"`
- `booking_advance_days`: `"30"`
- `currency`: `"NOK"`
- `timezone`: `"Europe/Oslo"`

---

## Email Configuration

### Environment Variables

```bash
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@stylora.no
```

### Gmail Setup (Recommended)

1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Select "Mail" and "Other (Custom name)"
   - Copy the generated 16-character password
3. Use the App Password as `SMTP_PASSWORD`

### Testing Email Locally

```bash
# Test with Mailtrap (development)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username
SMTP_PASSWORD=your-mailtrap-password
```

---

## Frontend Implementation

### Onboarding Page Route

```typescript
// client/src/App.tsx
<Route path="/onboard" component={Onboarding} />
```

### Form Validation

Using `react-hook-form` with `zod` schemas:

```typescript
const salonInfoSchema = z.object({
  salonName: z.string().min(2, "اسم الصالون مطلوب"),
  subdomain: z.string().min(3).regex(/^[a-z0-9-]+$/),
  address: z.string().min(5),
  city: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email(),
});
```

### Progress Indicator

```typescript
const progress = (currentStep / steps.length) * 100;
<Progress value={progress} className="h-2" />
```

### Step Navigation

```typescript
const handleNext = () => {
  if (currentStep === 1) {
    salonInfoForm.handleSubmit((data) => {
      setOnboardingData((prev) => ({ ...prev, salonInfo: data }));
      setCurrentStep(2);
    })();
  }
  // ... handle other steps
};
```

---

## QR Code System

### QR Code Data Structure

```json
{
  "employeeId": "emp123",
  "tenantId": "tenant123",
  "type": "checkin"
}
```

### Generating QR Codes

```typescript
import QRCode from "qrcode";

const qrCodeData = JSON.stringify({
  employeeId: "emp123",
  tenantId: "tenant123",
  type: "checkin",
});

const qrCodeUrl = await QRCode.toDataURL(qrCodeData);
// Returns: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
```

### Scanning QR Codes (Future Enhancement)

```typescript
// Use html5-qrcode library
import { Html5Qrcode } from "html5-qrcode";

const scanner = new Html5Qrcode("reader");
scanner.start(
  { facingMode: "environment" },
  { fps: 10, qrbox: 250 },
  (decodedText) => {
    const data = JSON.parse(decodedText);
    // Handle check-in with data.employeeId and data.tenantId
  }
);
```

---

## Testing Checklist

### Manual Testing

- [ ] Navigate to `/onboard`
- [ ] Fill Step 1: Salon Information
  - [ ] Test subdomain validation (lowercase, no spaces)
  - [ ] Test email validation
  - [ ] Test phone validation
- [ ] Fill Step 2: Owner Account
  - [ ] Test password confirmation
  - [ ] Test password strength (min 8 characters)
- [ ] Fill Step 3: Business Hours
  - [ ] Test time picker
  - [ ] Test "Sunday Closed" checkbox
- [ ] Submit onboarding
  - [ ] Verify tenant created in database
  - [ ] Verify owner user created
  - [ ] Verify settings created
  - [ ] Verify default services created
- [ ] Check email inbox
  - [ ] Verify welcome email received
  - [ ] Verify email formatting (RTL, images, links)
  - [ ] Test login link
- [ ] Login with new account
  - [ ] Verify dashboard access
  - [ ] Verify business hours displayed correctly

### Automated Testing (Future)

```typescript
// server/__tests__/onboarding.test.ts
describe("Onboarding API", () => {
  it("should check subdomain availability", async () => {
    const result = await caller.onboarding.checkSubdomain({ subdomain: "test-salon" });
    expect(result.available).toBe(true);
  });

  it("should create tenant and owner", async () => {
    const result = await caller.onboarding.complete({
      salonInfo: { /* ... */ },
      ownerAccount: { /* ... */ },
      businessHours: { /* ... */ },
    });
    expect(result.success).toBe(true);
    expect(result.tenantId).toBeDefined();
  });
});
```

---

## Troubleshooting

### Email Not Sending

**Problem:** Welcome email not received

**Solutions:**
1. Check SMTP credentials in environment variables
2. Verify SMTP_HOST and SMTP_PORT are correct
3. Check spam/junk folder
4. Test with Mailtrap for development
5. Check server logs for email errors

### Subdomain Already Exists

**Problem:** "النطاق الفرعي غير متاح" error

**Solution:**
- Choose a different subdomain
- Check database for existing tenant with same subdomain
- Use `checkSubdomain` endpoint before submitting

### QR Code Not Generating

**Problem:** QR code field is null in database

**Solution:**
1. Verify `qrcode` package is installed: `pnpm list qrcode`
2. Check server logs for QR generation errors
3. Ensure employee data is valid before QR generation

---

## Future Enhancements

### Planned Features

1. **Complete Wizard Steps 4-7**
   - Step 4: Add multiple employees with roles
   - Step 5: Create custom services with categories
   - Step 6: Configure payment providers (Stripe/Vipps)
   - Step 7: Review and confirm all settings

2. **Save and Continue Later**
   - Store partial onboarding data in database
   - Send reminder emails for incomplete onboarding
   - Resume onboarding from last completed step

3. **Logo Upload**
   - Upload salon logo to S3
   - Display logo in dashboard and public booking page
   - Generate favicon from logo

4. **QR Code Check-in Page**
   - Dedicated `/checkin` page with QR scanner
   - Real-time clock in/out tracking
   - Display employee name and time on successful scan

5. **Onboarding Analytics**
   - Track onboarding completion rate
   - Measure time spent on each step
   - Identify drop-off points
   - A/B test different onboarding flows

6. **Demo Data Generator**
   - One-click populate with sample data
   - Pre-filled customers, appointments, services
   - Help new users explore features quickly

---

## Support

For questions or issues with the onboarding system:

- **Email:** support@stylora.no
- **Documentation:** https://docs.stylora.no
- **GitHub Issues:** https://github.com/stylora/stylora/issues

---

**Last Updated:** December 28, 2025
