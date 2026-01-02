# DevOps Infrastructure Setup Guide

This document provides comprehensive instructions for setting up and managing the production DevOps infrastructure for Stylora.

## Table of Contents

1. [CI/CD Pipeline (GitHub Actions)](#cicd-pipeline)
2. [Error Monitoring (Sentry)](#error-monitoring)
3. [Database Backups](#database-backups)
4. [Environment Variables](#environment-variables)
5. [Deployment Process](#deployment-process)
6. [Monitoring & Alerts](#monitoring--alerts)
7. [Troubleshooting](#troubleshooting)

---

## CI/CD Pipeline

### Overview

The project uses GitHub Actions for automated testing and deployment to Railway.

### Workflows

#### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

**Jobs:**
- **Test**: Runs vitest test suite
- **Type Check**: TypeScript type checking (with increased memory)
- **Build**: Builds the application and uploads artifacts
- **Lint**: Code formatting check with Prettier

**Configuration:**
```yaml
Node.js Version: 22.x
Package Manager: pnpm 10
Memory Limit: 4GB for TypeScript
```

#### 2. Deploy Workflow (`.github/workflows/deploy.yml`)

**Triggers:**
- Push to `main` branch
- Manual workflow dispatch

**Jobs:**
- **Deploy**: Deploys to Railway production
- **Post-Deploy**: Health checks and smoke tests

**Required Secrets:**
- `RAILWAY_TOKEN`: Railway API token
- `RAILWAY_SERVICE_NAME`: Railway service name
- `CODECOV_TOKEN` (optional): For test coverage reports

### Setup Instructions

1. **Generate Railway Token:**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Login and generate token
   railway login
   railway tokens create
   ```

2. **Add GitHub Secrets:**
   - Go to GitHub repository → Settings → Secrets and variables → Actions
   - Add the following secrets:
     - `RAILWAY_TOKEN`: Your Railway API token
     - `RAILWAY_SERVICE_NAME`: Your service name (e.g., "stylora-production")
     - `CODECOV_TOKEN` (optional): For code coverage

3. **Test the Pipeline:**
   ```bash
   # Make a test commit
   git commit --allow-empty -m "Test CI/CD pipeline"
   git push origin main
   ```

4. **Monitor Workflow:**
   - Go to GitHub repository → Actions tab
   - View workflow runs and logs

---

## Error Monitoring

### Sentry Configuration

Sentry is configured for both frontend and backend error tracking with session replay and performance monitoring.

### Backend Setup

**File:** `server/config/sentry.ts`

**Features:**
- Error tracking
- Performance monitoring
- Request tracing
- Profiling
- Sensitive data filtering

**Environment Variables:**
```bash
SENTRY_DSN=https://your-dsn@sentry.io/project-id
NODE_ENV=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% profiling
SENTRY_RELEASE=stylora@1.0.0  # Optional
```

### Frontend Setup

**File:** `client/src/lib/sentry.ts`

**Features:**
- Error tracking
- Session replay (with privacy masks)
- Performance monitoring
- User context tracking

**Environment Variables:**
```bash
VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE=1.0  # 100% on errors
```

### Setup Instructions

1. **Create Sentry Project:**
   - Go to [sentry.io](https://sentry.io)
   - Create new project (Node.js + React)
   - Copy the DSN

2. **Configure Environment Variables:**
   - Add `SENTRY_DSN` to Railway backend environment
   - Add `VITE_SENTRY_DSN` to Railway frontend environment

3. **Set Up Alerts:**
   - Go to Sentry project → Alerts
   - Create alert rules:
     - **Critical Errors**: Email on any error with level "error" or "fatal"
     - **High Error Rate**: Alert when error rate > 1% in 5 minutes
     - **New Issues**: Notify on first occurrence of new errors

4. **Slack Integration (Optional):**
   - Go to Sentry → Settings → Integrations
   - Add Slack integration
   - Configure alert routing to specific channels

5. **Email Notifications:**
   - Go to Sentry → Settings → Notifications
   - Configure email alerts for:
     - New issues
     - Regressions
     - Deployment issues

### Usage Examples

**Backend:**
```typescript
import { captureException, setUserContext } from "@/config/sentry";

// Track user context
setUserContext({ id: user.id, email: user.email });

// Capture exception
try {
  await riskyOperation();
} catch (error) {
  captureException(error, { context: "payment-processing" });
  throw error;
}
```

**Frontend:**
```typescript
import { captureException, setUserContext } from "@/lib/sentry";

// Track user
setUserContext({ id: user.id, email: user.email });

// Capture error
try {
  await apiCall();
} catch (error) {
  captureException(error);
}
```

---

## Database Backups

### Overview

Automated daily backups to S3-compatible storage (Backblaze B2, AWS S3, etc.) with 30-day retention.

**File:** `server/services/backup.ts`

### Features

- **Daily automated backups** at 3:00 AM
- **Compression** with gzip
- **S3/Backblaze B2** storage
- **30-day retention policy**
- **Backup verification**
- **Error monitoring** with Sentry

### Setup Instructions

#### Option 1: Backblaze B2 (Recommended - Free 10GB)

1. **Create Backblaze Account:**
   - Go to [backblaze.com](https://www.backblaze.com/b2/sign-up.html)
   - Sign up for free account (10GB free)

2. **Create Bucket:**
   - Go to B2 Cloud Storage → Buckets
   - Click "Create a Bucket"
   - Name: `stylora-backups`
   - Files in Bucket: Private
   - Object Lock: Disabled

3. **Create Application Key:**
   - Go to App Keys → Add a New Application Key
   - Name: `stylora-backup-key`
   - Allow access to: `stylora-backups` bucket
   - Type: Read and Write
   - Copy the `keyID` and `applicationKey`

4. **Get Endpoint:**
   - Backblaze endpoint format: `https://s3.us-west-000.backblazeb2.com`
   - Replace `us-west-000` with your bucket's region

#### Option 2: AWS S3

1. **Create S3 Bucket:**
   ```bash
   aws s3 mb s3://stylora-backups --region us-east-1
   ```

2. **Create IAM User:**
   - Go to IAM → Users → Add User
   - Enable programmatic access
   - Attach policy: `AmazonS3FullAccess` (or custom policy)
   - Save Access Key ID and Secret Access Key

### Environment Variables

Add these to Railway:

```bash
# Database connection (already configured)
DATABASE_URL=mysql://user:password@host:port/database

# S3/Backblaze B2 Configuration
BACKUP_S3_ENDPOINT=https://s3.us-west-000.backblazeb2.com
BACKUP_S3_REGION=us-west-000
BACKUP_S3_BUCKET=stylora-backups
BACKUP_S3_ACCESS_KEY=your_key_id
BACKUP_S3_SECRET_KEY=your_secret_key
BACKUP_RETENTION_DAYS=30
```

### Manual Backup

To trigger a manual backup:

```typescript
import { triggerManualBackup } from "@/services/backup";

const result = await triggerManualBackup();
console.log(result);
```

### Restore Procedure

1. **Download Backup:**
   ```bash
   # Using AWS CLI (works with Backblaze B2 too)
   aws s3 cp s3://stylora-backups/backups/database-2024-01-15.sql.gz . \
     --endpoint-url https://s3.us-west-000.backblazeb2.com
   ```

2. **Decompress:**
   ```bash
   gunzip database-2024-01-15.sql.gz
   ```

3. **Restore to Database:**
   ```bash
   mysql -h host -u user -p database < database-2024-01-15.sql
   ```

### Monitoring

- Backups run daily at 3:00 AM server time
- Check logs for backup status:
  ```bash
  railway logs --service stylora-production | grep backup
  ```
- Failed backups are automatically reported to Sentry

---

## Environment Variables

### Required for Production

#### Backend (Railway)

```bash
# Database
DATABASE_URL=mysql://user:password@host:port/database

# Authentication
JWT_SECRET=your-secret-key
# OAUTH_SERVER_URL is no longer required (email/password auth is used)
OWNER_NAME=admin
OWNER_OPEN_ID=admin-open-id

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Sentry
SENTRY_DSN=https://your-dsn@sentry.io/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1

# Backups
BACKUP_S3_ENDPOINT=https://s3.us-west-000.backblazeb2.com
BACKUP_S3_REGION=us-west-000
BACKUP_S3_BUCKET=stylora-backups
BACKUP_S3_ACCESS_KEY=your-key-id
BACKUP_S3_SECRET_KEY=your-secret-key
BACKUP_RETENTION_DAYS=30

# Stripe (if enabled)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# SMS (Twilio)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

#### Frontend (Railway)

```bash
# Sentry
VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1

# App Configuration
VITE_APP_TITLE=Stylora
VITE_APP_LOGO=/logo.png
VITE_APP_ID=stylora
```

---

## Deployment Process

### Automatic Deployment (Recommended)

1. **Push to Main Branch:**
   ```bash
   git push origin main
   ```

2. **GitHub Actions:**
   - Runs tests
   - Builds application
   - Deploys to Railway
   - Runs migrations

3. **Monitor:**
   - GitHub Actions: Check workflow status
   - Railway: Monitor deployment logs
   - Sentry: Watch for errors

### Manual Deployment

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Deploy
railway up

# Run migrations
railway run pnpm db:push
```

---

## Monitoring & Alerts

### Health Checks

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "database": "connected"
}
```

### Key Metrics to Monitor

1. **Application:**
   - Response time (< 500ms)
   - Error rate (< 1%)
   - Uptime (> 99.9%)

2. **Database:**
   - Connection pool usage
   - Query performance
   - Backup success rate

3. **Infrastructure:**
   - CPU usage (< 80%)
   - Memory usage (< 80%)
   - Disk space (> 20% free)

### Alert Channels

1. **Sentry:**
   - Critical errors → Email + Slack
   - High error rate → Email
   - New issues → Slack

2. **Railway:**
   - Deployment failures → Email
   - Service downtime → Email

3. **Backups:**
   - Failed backups → Sentry → Email

---

## Troubleshooting

### CI/CD Issues

**Problem:** Tests failing in CI but passing locally

**Solution:**
```bash
# Run tests with same Node version as CI
nvm use 22
pnpm test

# Check environment variables
env | grep VITE_
```

**Problem:** Deployment fails

**Solution:**
```bash
# Check Railway logs
railway logs --service stylora-production

# Verify environment variables
railway variables

# Manual deployment
railway up
```

### Sentry Issues

**Problem:** Too many errors

**Solution:**
1. Adjust sample rates in environment variables
2. Add more errors to `ignoreErrors` list
3. Filter by environment (development vs production)

**Problem:** No errors appearing

**Solution:**
1. Verify `SENTRY_DSN` is set correctly
2. Check Sentry project settings
3. Test error capture:
   ```typescript
   import { captureMessage } from "@/lib/sentry";
   captureMessage("Test error", "error");
   ```

### Backup Issues

**Problem:** Backup fails with S3 error

**Solution:**
1. Verify S3 credentials:
   ```bash
   railway variables | grep BACKUP_
   ```
2. Test S3 connection:
   ```bash
   aws s3 ls s3://stylora-backups \
     --endpoint-url https://s3.us-west-000.backblazeb2.com
   ```
3. Check bucket permissions

**Problem:** Backup takes too long

**Solution:**
1. Database is too large
2. Consider incremental backups
3. Increase backup frequency but reduce retention

### TypeScript Memory Issues

**Problem:** `tsc` runs out of memory

**Solution:**
Already fixed with `NODE_OPTIONS='--max-old-space-size=4096'` in package.json.

If still failing:
```bash
# Increase memory further
NODE_OPTIONS='--max-old-space-size=8192' pnpm check
```

---

## Maintenance Tasks

### Weekly

- [ ] Review Sentry errors
- [ ] Check backup success rate
- [ ] Monitor application performance

### Monthly

- [ ] Review and update dependencies
- [ ] Test backup restore procedure
- [ ] Review and optimize database queries
- [ ] Check disk space usage

### Quarterly

- [ ] Security audit
- [ ] Performance optimization
- [ ] Update documentation
- [ ] Review and update alert thresholds

---

## Support

For issues or questions:

1. Check this documentation
2. Review Sentry error logs
3. Check Railway deployment logs
4. Contact: [Your Support Email]

---

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Railway Documentation](https://docs.railway.app/)
- [Sentry Documentation](https://docs.sentry.io/)
- [Backblaze B2 Documentation](https://www.backblaze.com/b2/docs/)
- [TypeScript Performance](https://github.com/microsoft/TypeScript/wiki/Performance)
