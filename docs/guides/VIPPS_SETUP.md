# Vipps Payment Integration Setup Guide

This document explains how to set up and configure Vipps payment gateway for Stylora.

## Overview

Vipps is Norway's most popular mobile payment solution with over 4 million users. This integration allows customers to pay for salon appointments using their Vipps app, providing a seamless payment experience for Norwegian customers.

## Features Implemented

✅ **Payment Initiation**: Create Vipps payment requests for salon appointments
✅ **Callback Handling**: Automatic payment status updates via Vipps callbacks
✅ **Payment Verification**: Verify payment status and update appointment confirmations
✅ **Dual Gateway Support**: Works alongside existing Stripe integration
✅ **Mobile Optimized**: Automatic app-switch on mobile devices
✅ **Desktop Support**: QR code and phone number entry for desktop payments
✅ **Refund Support**: Full and partial refund capabilities
✅ **Error Handling**: Comprehensive error handling and logging

## Prerequisites

Before you can use Vipps payments, you need:

1. **Vipps Merchant Account**: Register at [https://vipps.no/](https://vipps.no/)
2. **Test Environment Access**: Get test credentials from Vipps Developer Portal
3. **Production Credentials**: Apply for production access after testing

## Step 1: Register for Vipps Merchant Account

1. Visit [https://vipps.no/produkter-og-tjenester/bedrift/ta-betalt-paa-nett/ta-betalt-paa-nett/](https://vipps.no/produkter-og-tjenester/bedrift/ta-betalt-paa-nett/ta-betalt-paa-nett/)
2. Click "Kom i gang" (Get started)
3. Fill in your business information:
   - Organization number (Organisasjonsnummer)
   - Business name
   - Contact information
   - Bank account details
4. Complete the application process
5. Wait for approval (usually 1-3 business days)

## Step 2: Get Test Credentials

Once your merchant account is approved:

1. Log in to [Vipps Developer Portal](https://developer.vippsmobilepay.com/)
2. Navigate to "Test" section
3. Get your test credentials:
   - **Client ID**: Your application identifier
   - **Client Secret**: Your application secret key
   - **Subscription Key (Ocp-Apim-Subscription-Key)**: API subscription key
   - **Merchant Serial Number (MSN)**: Your merchant identifier

## Step 3: Configure Environment Variables

Add the following environment variables to your `.env` file or system environment:

```bash
# Vipps Payment Gateway Configuration
VIPPS_CLIENT_ID=your_client_id_here
VIPPS_CLIENT_SECRET=your_client_secret_here
VIPPS_SUBSCRIPTION_KEY=your_subscription_key_here
VIPPS_MERCHANT_SERIAL_NUMBER=your_msn_here

# API URL (use test environment first)
VIPPS_API_URL=https://apitest.vipps.no

# For production, change to:
# VIPPS_API_URL=https://api.vipps.no
```

### Important Notes:

- **Never commit credentials to Git**: Add `.env` to `.gitignore`
- **Use test environment first**: Always test with `apitest.vipps.no` before going live
- **Secure your secrets**: Store production credentials securely (e.g., AWS Secrets Manager, Azure Key Vault)

## Step 4: Configure Callback URL

Vipps needs to know where to send payment status updates. Configure your callback URL in the Vipps portal:

1. Log in to Vipps Developer Portal
2. Go to your application settings
3. Add callback URL: `https://yourdomain.com/api/vipps/callback`
4. Add fallback URL: `https://yourdomain.com/booking/confirmation`

**For local testing:**
- Use a tunneling service like ngrok: `ngrok http 3000`
- Update callback URL to: `https://your-ngrok-url.ngrok.io/api/vipps/callback`

## Step 5: Test the Integration

### Test with Vipps Test App

1. Download "Vipps MT" (Merchant Test) app from App Store or Google Play
2. Log in with test user credentials (provided by Vipps)
3. Create a test booking on your website
4. Select Vipps as payment method
5. Complete payment in Vipps MT app
6. Verify appointment is confirmed

### Test Scenarios to Cover

- ✅ Successful payment (RESERVE status)
- ✅ User cancels payment (CANCEL status)
- ✅ Payment timeout
- ✅ Refund flow
- ✅ Callback handling
- ✅ Fallback URL redirect

## Step 6: Go Live (Production)

Once testing is complete:

1. **Apply for production access** in Vipps portal
2. **Get production credentials** (separate from test)
3. **Update environment variables**:
   ```bash
   VIPPS_API_URL=https://api.vipps.no
   VIPPS_CLIENT_ID=prod_client_id
   VIPPS_CLIENT_SECRET=prod_client_secret
   VIPPS_SUBSCRIPTION_KEY=prod_subscription_key
   VIPPS_MERCHANT_SERIAL_NUMBER=prod_msn
   ```
4. **Update callback URLs** to production domain
5. **Test thoroughly** in production environment
6. **Monitor logs** for any issues

## API Endpoints

### Create Vipps Payment

```typescript
// tRPC endpoint
trpc.payments.createVippsPayment.useMutation({
  appointmentId: 123,
  callbackUrl: "https://yourdomain.com/api/vipps/callback",
  fallbackUrl: "https://yourdomain.com/booking/confirmation",
  mobileNumber: "48059528" // Optional, 8 digits without country code
});
```

### Check Payment Status

```typescript
// tRPC endpoint
trpc.payments.getVippsPaymentStatus.useQuery({
  vippsOrderId: "apt-123-abc123"
});
```

### Check if Vipps is Available

```typescript
// tRPC endpoint
const { data } = trpc.payments.isVippsAvailable.useQuery();
if (data?.available) {
  // Show Vipps payment option
}
```

## Payment Flow

### Mobile Flow (Vipps App Installed)

1. Customer selects Vipps payment
2. System initiates payment via API
3. Customer is redirected to Vipps app (automatic app-switch)
4. Customer approves payment in Vipps
5. Vipps sends callback to `/api/vipps/callback`
6. System updates payment status
7. Customer is redirected to confirmation page

### Desktop Flow

1. Customer selects Vipps payment
2. System initiates payment via API
3. Customer enters phone number (or QR code scan)
4. Customer receives push notification on phone
5. Customer approves payment in Vipps app
6. Vipps sends callback to `/api/vipps/callback`
7. System updates payment status
8. Browser redirects to confirmation page

## Payment States

| Vipps Status | Description | System Action |
|--------------|-------------|---------------|
| `INITIATE` | Payment created | Keep as `pending` |
| `REGISTER` | User opened Vipps | Keep as `pending` |
| `RESERVE` | Payment approved | Mark as `completed`, confirm appointment |
| `SALE` | Payment captured | Mark as `completed`, confirm appointment |
| `CANCEL` | User cancelled | Mark as `failed` |
| `VOID` | Reserved payment voided | Mark as `failed` |
| `REFUND` | Payment refunded | Mark as `refunded` |

## Troubleshooting

### Issue: "Vipps credentials not configured"

**Solution**: Check that all environment variables are set correctly:
```bash
echo $VIPPS_CLIENT_ID
echo $VIPPS_CLIENT_SECRET
echo $VIPPS_SUBSCRIPTION_KEY
echo $VIPPS_MERCHANT_SERIAL_NUMBER
```

### Issue: "Failed to get Vipps access token"

**Possible causes**:
- Incorrect credentials
- Subscription key expired
- API URL wrong (test vs production)

**Solution**: Verify credentials in Vipps portal and check API URL

### Issue: Callbacks not received

**Possible causes**:
- Callback URL not accessible from internet
- Firewall blocking Vipps IPs
- Callback URL not configured in Vipps portal

**Solution**:
1. Test callback URL with curl: `curl -X POST https://yourdomain.com/api/vipps/callback`
2. Check server logs for incoming requests
3. Use ngrok for local testing
4. Verify callback URL in Vipps portal

### Issue: Payment stuck in "pending"

**Possible causes**:
- Callback failed or not received
- Database update failed
- Network timeout

**Solution**:
1. Check server logs for callback errors
2. Manually check payment status: `trpc.payments.getVippsPaymentStatus`
3. Use Vipps portal to check payment status
4. Implement polling as fallback (check status every 5 seconds)

## Security Best Practices

1. **Always use HTTPS**: Vipps requires HTTPS for callbacks
2. **Validate callbacks**: Verify callback authenticity (optional but recommended)
3. **Store credentials securely**: Never commit to Git, use environment variables
4. **Implement rate limiting**: Protect callback endpoint from abuse
5. **Log all transactions**: Keep audit trail for debugging and compliance
6. **Monitor for fraud**: Watch for suspicious patterns
7. **Use test environment**: Always test thoroughly before production

## Monitoring and Logging

All Vipps operations are logged with prefix `[Vipps Callback]` or `[Vipps API]`:

```bash
# View Vipps logs
grep "Vipps" /path/to/logs

# Monitor callbacks in real-time
tail -f /path/to/logs | grep "Vipps Callback"
```

## Support and Resources

- **Vipps Developer Docs**: [https://developer.vippsmobilepay.com/](https://developer.vippsmobilepay.com/)
- **Vipps Support**: [https://vipps.no/kontakt-oss/](https://vipps.no/kontakt-oss/)
- **Vipps Status Page**: [https://status.vipps.no/](https://status.vipps.no/)
- **Vipps GitHub**: [https://github.com/vippsas](https://github.com/vippsas)

## Cost and Fees

Vipps charges per transaction. Typical fees:
- **Transaction fee**: ~1-2% + fixed fee per transaction
- **Monthly fee**: May apply depending on agreement
- **Setup fee**: One-time fee for merchant account

Contact Vipps sales for exact pricing for your business.

## Compliance

Vipps integration complies with:
- **PSD2**: European payment services directive
- **GDPR**: Data protection regulation
- **PCI DSS**: Payment card industry standards (Vipps is PCI certified)

## Next Steps

After setting up Vipps:

1. ✅ Test thoroughly in test environment
2. ✅ Apply for production access
3. ✅ Configure production credentials
4. ✅ Update frontend to show Vipps option
5. ✅ Monitor first transactions closely
6. ✅ Gather customer feedback
7. ✅ Optimize payment flow based on analytics

## Questions?

For technical support with this integration, contact your development team.
For Vipps-specific questions, contact Vipps support.
