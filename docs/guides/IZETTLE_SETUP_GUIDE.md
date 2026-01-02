# iZettle Payment Integration Guide for Stylora

**Author:** Stylora Team  
**Last Updated:** December 18, 2024  
**Version:** 1.0

---

## Introduction

This comprehensive guide walks you through the process of integrating iZettle payment terminals into your Stylora salon management system. iZettle (now part of PayPal Zettle) is a leading mobile point-of-sale solution used by thousands of businesses across Europe for fast, secure card and contactless payments.

By enabling iZettle integration in Stylora, you can process payments directly from your salon's point-of-sale interface, with automatic synchronization of all transactions, simplified refund management, and comprehensive payment reporting.

---

## Prerequisites

Before you begin, ensure you have the following:

| Requirement | Description |
|------------|-------------|
| **iZettle Business Account** | An active iZettle business account with payment processing enabled |
| **iZettle Terminal** | At least one iZettle card reader (Reader 2, Terminal, or Pro) |
| **Business Registration** | Your business must be registered in a supported country (Norway, Sweden, UK, etc.) |
| **Admin Access** | Administrator access to your Stylora system |
| **Internet Connection** | Stable internet connection for OAuth authentication |
| **Time Required** | Approximately 15-20 minutes for complete setup |

---

## Step 1: Register for iZettle Business Account

### 1.1 Visit iZettle Website

Navigate to the official iZettle website for your country.

**Norway:** [https://www.izettle.com/no](https://www.izettle.com/no)  
**Sweden:** [https://www.izettle.com/se](https://www.izettle.com/se)  
**UK:** [https://www.zettle.com/gb](https://www.zettle.com/gb)

### 1.2 Create Your Account

Click on **"Kom i gang"** (Get Started) or **"Sign Up"** to begin registration.

You will need to provide:

- **Business name** and organization number
- **Contact person** details (name, email, phone)
- **Bank account** information for settlements
- **Business category** (select "Hair & Beauty" or "Personal Services")

### 1.3 Verify Your Account

iZettle will verify your business information. This process typically takes **1-2 business days**. You will receive an email confirmation once your account is approved and ready for use.

> **Note:** You may be required to upload documentation such as business registration certificates or ID verification. Ensure you have these documents ready to expedite the approval process.

### 1.4 Order iZettle Terminal (If Needed)

If you don't already have an iZettle card reader, you can order one from the iZettle website. Popular options include:

| Terminal | Features | Price Range |
|----------|----------|-------------|
| **iZettle Reader 2** | Compact card reader, connects via Bluetooth | ~500 NOK |
| **iZettle Terminal** | All-in-one terminal with built-in receipt printer | ~3,500 NOK |
| **iZettle Pro** | Advanced terminal with customer display | ~5,000 NOK |

---

## Step 2: Access iZettle Developer Portal

To integrate iZettle with Stylora, you need to create OAuth credentials through the iZettle Developer Portal.

### 2.1 Log In to iZettle Account

Visit [https://my.izettle.com](https://my.izettle.com) and log in with your iZettle business account credentials.

### 2.2 Navigate to Developer Settings

In the iZettle dashboard:

1. Click on your **profile icon** in the top-right corner
2. Select **"Settings"** or **"Innstillinger"**
3. Look for **"Integrations"** or **"API Access"** in the left sidebar

> **Important:** If you don't see developer or API options, you may need to contact iZettle support to enable developer access for your account. This is typically available for all business accounts but may require verification.

### 2.3 Request Developer Access (If Needed)

If developer access is not visible:

1. Contact iZettle support at **support@izettle.com**
2. Request **"API/Developer access"** for your account
3. Provide your business name and organization number
4. Wait for confirmation (usually within 1-2 business days)

---

## Step 3: Create OAuth Application

### 3.1 Register New Application

Once you have developer access:

1. Navigate to **"API Access"** or **"Developer"** section
2. Click **"Create New Application"** or **"Register Application"**
3. Fill in the application details:

| Field | Value | Description |
|-------|-------|-------------|
| **Application Name** | Stylora POS Integration | A descriptive name for your integration |
| **Application Type** | Web Application | Select web application type |
| **Redirect URI** | `https://your-domain.com/api/izettle/callback` | OAuth callback URL (replace with your actual domain) |
| **Description** | Point-of-sale integration for salon management | Brief description of the integration |

### 3.2 Retrieve OAuth Credentials

After creating the application, iZettle will display your OAuth credentials. **Copy and save these immediately** as some values may only be shown once:

| Credential | Description | Format |
|-----------|-------------|--------|
| **Client ID** | Your application identifier | UUID format (e.g., `a1b2c3d4-e5f6-...`) |
| **Client Secret** | Secret key for authentication | Long alphanumeric string |
| **API Key** | Additional API authentication key | Alphanumeric string |

> **Security Warning:** Treat these credentials like passwords. Never share them publicly, commit them to version control, or expose them in client-side code. Store them securely in environment variables or a secrets manager.

---

## Step 4: Configure Stylora iZettle Integration

Now that you have your OAuth credentials, it's time to configure Stylora.

### 4.1 Access iZettle Settings

1. Log in to your Stylora admin dashboard
2. Enable **"Advanced Mode"** if not already enabled (toggle in sidebar)
3. Navigate to **"iZettle"** in the left sidebar menu
4. You will see the iZettle integration page

### 4.2 Connect to iZettle

Click the **"Koble til iZettle"** (Connect to iZettle) button.

You will be redirected to the iZettle authorization page where you need to:

1. **Log in** to your iZettle account (if not already logged in)
2. **Review permissions** that Stylora is requesting:
   - Read payment information
   - Create payments
   - Process refunds
   - Access transaction history
3. **Click "Authorize"** or **"Godkjenn"** to grant access

### 4.3 Complete Authorization

After authorizing, you will be redirected back to Stylora. You should see:

- ✅ **Connection Status:** Connected
- 🟢 **Status Badge:** Active
- 📅 **Last Sync:** Current timestamp

If you see an error, refer to the Troubleshooting section below.

---

## Step 5: Test Your Integration

Before using iZettle in production, it's important to test the integration.

### 5.1 Process Test Payment

1. Navigate to **"Kasse (Betaling)"** (POS Payment) in Stylora
2. Create a test order with a small amount (e.g., 10 NOK)
3. Select **"iZettle"** as the payment method
4. Use your iZettle terminal to process the payment
5. Verify that the transaction appears in Stylora

### 5.2 Verify Transaction Sync

Check that the payment is recorded correctly:

1. Go to **"Betalingshistorikk"** (Payment History)
2. Look for your test transaction
3. Verify that all details are correct:
   - Amount
   - Payment method (iZettle)
   - Timestamp
   - Status (Completed)

### 5.3 Test Refund (Optional)

To test refund functionality:

1. Navigate to **"Refusjoner"** (Refunds)
2. Find your test transaction
3. Click **"Refunder"** (Refund)
4. Process the refund
5. Verify that the refund appears in both Stylora and iZettle

---

## Step 6: Go Live

Once testing is successful, your iZettle integration is ready for production use.

### 6.1 Train Your Staff

Ensure your staff knows how to:

- Select iZettle as a payment method in the POS
- Use the iZettle terminal to process payments
- Handle declined transactions
- Process refunds when needed

### 6.2 Monitor Transactions

Regularly monitor your iZettle transactions:

| Platform | What You Can See |
|----------|-----------------|
| **Stylora Dashboard** | Real-time payment status, booking details, customer information |
| **iZettle App** | Terminal management, transaction history, settlement reports |
| **iZettle Web Dashboard** | Detailed analytics, export reports, refund management |

### 6.3 Settlement Schedule

iZettle typically settles funds to your bank account:

- **Norway:** 1-2 business days
- **Sweden:** 1-2 business days
- **UK:** 1-2 business days

Settlement times may vary based on your bank and account type.

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: "Authorization Failed" Error

**Cause:** OAuth callback URL mismatch or invalid credentials

**Solution:**
1. Verify that the Redirect URI in iZettle Developer Portal matches your Stylora domain exactly
2. Ensure there are no trailing slashes or typos
3. Check that your OAuth credentials are correct
4. Try disconnecting and reconnecting

#### Issue 2: "Connection Timeout"

**Cause:** Network connectivity issues or firewall blocking OAuth requests

**Solution:**
1. Check your internet connection
2. Verify that your firewall allows outbound HTTPS connections to `*.izettle.com`
3. Try again from a different network
4. Contact your IT administrator if behind a corporate firewall

#### Issue 3: "Payment Not Syncing"

**Cause:** Synchronization delay or API rate limiting

**Solution:**
1. Wait 1-2 minutes and refresh the page
2. Check iZettle connection status in Stylora
3. Verify that the payment was successful in the iZettle app
4. If issue persists, disconnect and reconnect iZettle

#### Issue 4: "Terminal Not Found"

**Cause:** iZettle terminal not paired or offline

**Solution:**
1. Ensure your iZettle terminal is powered on
2. Check that the terminal is connected to Wi-Fi or mobile data
3. Verify terminal pairing in the iZettle app
4. Restart the terminal if necessary

#### Issue 5: "Refund Failed"

**Cause:** Original transaction not yet settled or insufficient funds

**Solution:**
1. Verify that the original transaction has been settled (1-2 days)
2. Check that your iZettle account has sufficient balance
3. Ensure the refund amount does not exceed the original payment
4. Contact iZettle support if the issue persists

---

## Security Best Practices

Protecting your iZettle credentials and customer payment data is critical. Follow these security guidelines:

### Credential Management

| Best Practice | Description |
|--------------|-------------|
| **Never Share Credentials** | Do not share OAuth credentials via email, chat, or public channels |
| **Use Strong Passwords** | Use a unique, strong password for your iZettle account |
| **Enable Two-Factor Authentication** | Activate 2FA in your iZettle account settings |
| **Rotate Credentials Regularly** | Change OAuth credentials every 6-12 months |
| **Limit Access** | Only grant iZettle access to trusted administrators |
| **Monitor Activity** | Regularly review transaction logs for suspicious activity |

### Compliance

Ensure your iZettle integration complies with:

- **PCI DSS** (Payment Card Industry Data Security Standard)
- **GDPR** (General Data Protection Regulation)
- **Norwegian Privacy Laws** (Personopplysningsloven)
- **PSD2** (Payment Services Directive 2)

> **Note:** Stylora and iZettle handle all payment processing securely. You never store or process raw payment card data, significantly reducing your PCI compliance burden.

---

## Additional Resources

For further assistance and detailed technical documentation, refer to these official iZettle resources:

| Resource | URL | Description |
|----------|-----|-------------|
| **iZettle Developer Portal** | [https://developer.izettle.com](https://developer.izettle.com) | Complete API documentation |
| **iZettle Support** | [https://www.izettle.com/help](https://www.izettle.com/help) | Customer support and FAQs |
| **iZettle Business Dashboard** | [https://my.izettle.com](https://my.izettle.com) | Manage your business account |
| **iZettle App** | iOS App Store / Google Play | Mobile app for terminal management |

---

## Support

If you encounter issues not covered in this guide, contact support:

**Stylora Support:**
- Email: support@stylora.no
- Help Center: [https://help.stylora.no](https://help.stylora.no)

**iZettle Support:**
- Phone: +47 21 93 05 00 (Norway)
- Email: support@izettle.com
- Live Chat: Available in iZettle app

---

## Conclusion

Congratulations! You have successfully integrated iZettle payments into your Stylora salon management system. Your staff can now process card and contactless payments seamlessly from the point-of-sale interface, with automatic synchronization and comprehensive reporting.

By offering iZettle as a payment option, you can expect:

- **Faster checkout** (reduced transaction time)
- **Improved cash flow** (faster settlements)
- **Better record-keeping** (automatic transaction logging)
- **Enhanced customer experience** (modern payment options)

We recommend monitoring your payment analytics over the next few weeks to measure the impact of iZettle integration on your business operations.

---

**Document Version:** 1.0  
**Last Reviewed:** December 18, 2024  
**Next Review:** March 18, 2025
