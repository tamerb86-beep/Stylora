# Vipps Payment Integration Guide for Stylora

**Author:** Stylora Team  
**Last Updated:** December 18, 2024  
**Version:** 1.0

---

## Introduction

This comprehensive guide walks you through the process of integrating Vipps payment into your Stylora salon management system. Vipps is Norway's most popular mobile payment solution, used by over 4 million Norwegians for instant and secure transactions.

By enabling Vipps payments on your online booking page, you provide customers with a familiar, trusted payment method that significantly improves conversion rates and reduces no-shows through upfront payment collection.

---

## Prerequisites

Before you begin, ensure you have the following:

| Requirement | Description |
|------------|-------------|
| **Norwegian Business** | Your salon must be registered as a business in Norway with a valid organization number |
| **Bank Account** | A Norwegian business bank account for receiving payments |
| **Vipps Business Account** | An active Vipps business account (we'll guide you through setup) |
| **Admin Access** | Administrator access to your Stylora system |
| **Time Required** | Approximately 30-45 minutes for complete setup |

---

## Step 1: Register for Vipps Business Account

### 1.1 Visit Vipps Portal

Navigate to the official Vipps business portal to begin your registration.

**URL:** [https://portal.vipps.no](https://portal.vipps.no)

### 1.2 Create Your Account

Click on **"Bli Vipps-kunde"** (Become a Vipps customer) or **"Logg inn"** (Log in) if you already have an account.

You will need to provide:

- **Organization number** (Organisasjonsnummer)
- **Business name** (Firmanavn)
- **Contact person** details (name, email, phone)
- **Bank account number** for settlements

### 1.3 Complete Verification

Vipps will verify your business information. This process typically takes **1-3 business days**. You will receive an email confirmation once your account is approved.

> **Note:** During verification, Vipps may contact you via phone or email to confirm your business details. Ensure the contact information you provide is accurate and monitored.

---

## Step 2: Access Vipps Developer Portal

Once your business account is approved, you need to access the developer portal to obtain API credentials.

### 2.1 Log In to Vipps Portal

Return to [https://portal.vipps.no](https://portal.vipps.no) and log in with your business account credentials.

### 2.2 Navigate to Developer Section

In the left sidebar menu, click on:

1. **"Utvikler"** (Developer)
2. **"API-nøkler"** (API Keys)

---

## Step 3: Create API Keys

### 3.1 Generate New API Keys

Click the button **"Opprett nye nøkler"** (Create new keys) or **"Legg til"** (Add).

You will be prompted to provide:

| Field | Description | Example |
|-------|-------------|---------|
| **Application Name** | A descriptive name for your integration | "Stylora Online Booking" |
| **Environment** | Choose **Production** for live payments | Production |
| **API Product** | Select **"eCommerce API"** | eCommerce API |

### 3.2 Retrieve Your Credentials

After creation, Vipps will display four critical pieces of information. **Copy and save these immediately** as some values are only shown once:

| Credential | Description | Format |
|-----------|-------------|--------|
| **Client ID** | Your application identifier | UUID format (e.g., `a1b2c3d4-...`) |
| **Client Secret** | Secret key for authentication | Long alphanumeric string |
| **Subscription Key** | API subscription identifier | Alphanumeric string (Ocp-Apim-Subscription-Key) |
| **Merchant Serial Number** | Your unique merchant ID | 6-digit number (e.g., `123456`) |

> **Security Warning:** Treat these credentials like passwords. Never share them publicly or commit them to version control systems. Store them securely in a password manager or encrypted vault.

---

## Step 4: Configure Stylora Payment Settings

Now that you have your Vipps API credentials, it's time to configure them in your Stylora system.

### 4.1 Access Settings Page

1. Log in to your Stylora admin dashboard
2. Navigate to **Settings** in the left sidebar
3. Click on the **"Betaling"** (Payment) tab

### 4.2 Enable Vipps Payment

Locate the **"Vipps-betaling"** section and toggle the switch to **ON** (enabled).

When enabled, a configuration form will appear below.

### 4.3 Enter API Credentials

Fill in the four fields with the credentials you obtained from Vipps Portal:

| Field in Stylora | Vipps Credential | Where to Find It |
|-------------------|-----------------|------------------|
| **Client ID** | Client ID | Vipps Portal → Developer → API Keys |
| **Client Secret** | Client Secret | Shown once during key creation |
| **Subscription Key** | Subscription Key (Ocp-Apim-Subscription-Key) | Vipps Portal → Developer → API Keys |
| **Merchant Serial Number** | Merchant Serial Number (MSN) | Vipps Portal → Developer → API Keys |

### 4.4 Save Configuration

Click the **"Lagre innstillinger"** (Save settings) button at the bottom of the page.

You should see a success message: **"Betalingsinnstillinger lagret!"** (Payment settings saved!)

---

## Step 5: Test Your Integration

Before going live, it's crucial to test that Vipps payments work correctly.

### 5.1 Access Your Booking Page

Open your public booking page in a new browser tab:

**URL Format:** `https://your-domain.com/book`

### 5.2 Complete a Test Booking

1. Select a service
2. Choose an employee
3. Pick a date and time
4. Enter customer information
5. On the payment step, select **"Vipps"**
6. Click **"Gå til betaling"** (Go to payment)

### 5.3 Verify Vipps Redirect

You should be redirected to the Vipps payment page. The page will display:

- Your salon name
- Service description
- Total amount
- Option to pay with Vipps app or Vipps login

### 5.4 Complete Test Payment

Use the Vipps test environment or complete a small real transaction (which you can refund later) to verify the full payment flow.

**Expected Flow:**

1. Customer approves payment in Vipps app
2. Customer is redirected back to your booking confirmation page
3. Appointment is created in Stylora with status **"confirmed"**
4. Customer receives booking confirmation

---

## Step 6: Go Live

Once testing is successful, your Vipps integration is ready for production use.

### 6.1 Enable on Booking Page

Vipps will automatically appear as a payment option on your public booking page for all customers.

### 6.2 Monitor Transactions

You can monitor Vipps transactions in two places:

| Platform | What You Can See |
|----------|-----------------|
| **Stylora Dashboard** | Appointments with payment status, booking details |
| **Vipps Portal** | Transaction history, settlement reports, refunds |

### 6.3 Settlement Schedule

Vipps typically settles funds to your bank account within **1-2 business days** after a successful transaction.

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: "Invalid Client Credentials" Error

**Cause:** Incorrect Client ID or Client Secret

**Solution:**
1. Double-check that you copied the credentials correctly (no extra spaces)
2. Verify you're using **Production** keys, not Test keys
3. Regenerate keys in Vipps Portal if necessary

#### Issue 2: "Subscription Key Not Found"

**Cause:** Missing or incorrect Subscription Key

**Solution:**
1. Ensure you copied the **Ocp-Apim-Subscription-Key** value
2. Check that the key is active in Vipps Portal
3. Verify the key hasn't expired

#### Issue 3: "Merchant Not Found"

**Cause:** Incorrect Merchant Serial Number

**Solution:**
1. Confirm the MSN is a 6-digit number
2. Verify it matches the MSN shown in Vipps Portal
3. Ensure your Vipps business account is fully activated

#### Issue 4: Payment Redirect Fails

**Cause:** Callback URL not whitelisted

**Solution:**
1. Log in to Vipps Portal
2. Navigate to **Developer → API Keys → Your Application**
3. Add your Stylora domain to the **Allowed Callback URLs** list:
   - `https://your-domain.com/book/success`
   - `https://your-domain.com/book`

#### Issue 5: Customers Can't See Vipps Option

**Cause:** Vipps not enabled in payment settings

**Solution:**
1. Go to Stylora Settings → Betaling
2. Ensure the **"Vipps-betaling"** toggle is **ON**
3. Click **"Lagre innstillinger"** to save

---

## Security Best Practices

Protecting your Vipps credentials and customer payment data is critical. Follow these security guidelines:

### Credential Management

| Best Practice | Description |
|--------------|-------------|
| **Never Share Credentials** | Do not share API keys via email, chat, or public channels |
| **Use Environment Variables** | Store credentials in secure environment variables, not in code |
| **Rotate Keys Regularly** | Change API keys every 6-12 months |
| **Limit Access** | Only grant Vipps Portal access to trusted team members |
| **Monitor Activity** | Regularly review transaction logs for suspicious activity |

### Compliance

Ensure your Vipps integration complies with:

- **PCI DSS** (Payment Card Industry Data Security Standard)
- **GDPR** (General Data Protection Regulation)
- **Norwegian Privacy Laws** (Personopplysningsloven)

> **Note:** Stylora handles all payment processing securely. You never store or process raw payment card data, reducing your PCI compliance burden.

---

## Additional Resources

For further assistance and detailed technical documentation, refer to these official Vipps resources:

| Resource | URL | Description |
|----------|-----|-------------|
| **Vipps Developer Portal** | [https://developer.vippsmobilepay.com](https://developer.vippsmobilepay.com) | Complete API documentation |
| **Vipps Support** | [https://vipps.no/hjelp](https://vipps.no/hjelp) | Customer support and FAQs |
| **Vipps Business Portal** | [https://portal.vipps.no](https://portal.vipps.no) | Manage your business account |
| **Vipps API GitHub** | [https://github.com/vippsas](https://github.com/vippsas) | Code examples and SDKs |

---

## Support

If you encounter issues not covered in this guide, contact support:

**Stylora Support:**
- Email: support@stylora.no
- Help Center: [https://help.stylora.no](https://help.stylora.no)

**Vipps Support:**
- Business Support: +47 22 48 28 00
- Email: bedrift@vipps.no
- Portal: [https://portal.vipps.no](https://portal.vipps.no)

---

## Conclusion

Congratulations! You have successfully integrated Vipps payments into your Stylora salon management system. Your customers can now book appointments and pay instantly using Norway's most trusted mobile payment solution.

By offering Vipps as a payment option, you can expect:

- **Higher conversion rates** (customers prefer familiar payment methods)
- **Reduced no-shows** (upfront payment increases commitment)
- **Faster checkout** (one-tap payment in Vipps app)
- **Improved cash flow** (instant payment confirmation)

We recommend monitoring your booking analytics over the next few weeks to measure the impact of Vipps integration on your business.

---

**Document Version:** 1.0  
**Last Reviewed:** December 18, 2024  
**Next Review:** March 18, 2025
