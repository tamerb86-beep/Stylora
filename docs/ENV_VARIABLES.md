# Environment Variables Reference

This document lists all environment variables needed for the Stylora application.

## Already Configured (via Stylora)

These are automatically provided by the Stylora platform:

- `BUILT_IN_FORGE_API_KEY` - Stylora Forge API key
- `BUILT_IN_FORGE_API_URL` - Stylora Forge API URL
- `JWT_SECRET` - JWT signing secret
- `OAUTH_SERVER_URL` - OAuth server URL
- `OWNER_NAME` - Owner name
- `OWNER_OPEN_ID` - Owner OpenID
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_KEY` - Supabase service role key
- `SUPABASE_URL` - Supabase project URL
- `VITE_ANALYTICS_ENDPOINT` - Analytics endpoint
- `VITE_ANALYTICS_WEBSITE_ID` - Analytics website ID
- `VITE_APP_ID` - Application ID
- `VITE_APP_LOGO` - Application logo path
- `VITE_APP_TITLE` - Application title
- `VITE_FRONTEND_FORGE_API_KEY` - Frontend Forge API key
- `VITE_FRONTEND_FORGE_API_URL` - Frontend Forge API URL
- `VITE_OAUTH_PORTAL_URL` - OAuth portal URL

## Required for Production

### Error Monitoring (Sentry)

```bash
# Backend
SENTRY_DSN=https://your-dsn@sentry.io/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1

# Frontend
VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Database Backups (S3/Backblaze B2)

```bash
BACKUP_S3_ENDPOINT=https://s3.us-west-000.backblazeb2.com
BACKUP_S3_REGION=us-west-000
BACKUP_S3_BUCKET=stylora-backups
BACKUP_S3_ACCESS_KEY=your-key-id
BACKUP_S3_SECRET_KEY=your-secret-key
BACKUP_RETENTION_DAYS=30
```

### Payment Processing (Optional)

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### SMS Notifications (Optional)

```bash
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

## Setup Instructions

See `DEVOPS_SETUP.md` for detailed setup instructions for each service.
