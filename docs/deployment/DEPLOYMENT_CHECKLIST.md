# 🚀 Deployment Checklist - Production Release

**Project:** Stylora (Stylora) SaaS  
**Date:** December 29, 2025  
**Status:** Ready for Production

---

## ✅ Pre-Deployment Verification

### 1. Code Quality & Testing
- [x] All critical tests passing (48/48 tests)
- [x] TypeScript errors resolved
- [x] No console errors in browser
- [x] Code reviewed and approved
- [x] Git repository clean (no uncommitted changes)

### 2. Database Readiness
- [x] All migrations executed successfully
- [x] Unimicro tables created (unimicroSettings, unimicroInvoiceMapping, etc.)
- [x] Schema matches production requirements
- [x] Database indexes optimized
- [x] Foreign key constraints verified

### 3. Integration Status
- [x] **Unimicro:** 20/20 tests passing ✅
- [x] **Fiken:** 13/13 tests passing ✅
- [x] **POS Financial:** 10/10 tests passing ✅
- [x] **SMS Service:** 5/5 tests passing ✅
- [x] **Email Service:** AWS SES + SMTP fallback configured ✅
- [x] **Stripe Terminal:** Integrated via POS ✅
- [x] **Google Calendar:** OAuth2 ready ✅

---

## 🔐 Environment Variables Check

### Critical Variables (Required)
```bash
# Database
✅ DATABASE_URL=mysql://...

# JWT Authentication
✅ JWT_SECRET=<strong-secret-32-chars-minimum>

# Session Management
✅ REFRESH_TOKEN_SECRET=<different-strong-secret>
```

### Email Service (Required for notifications)
```bash
# AWS SES (Primary)
⚠️ AWS_SES_REGION=eu-north-1
⚠️ AWS_SES_ACCESS_KEY_ID=...
⚠️ AWS_SES_SECRET_ACCESS_KEY=...

# SMTP (Fallback)
⚠️ SMTP_HOST=smtp.example.com
⚠️ SMTP_PORT=587
⚠️ SMTP_USER=...
⚠️ SMTP_PASS=...
⚠️ SMTP_FROM_EMAIL=no-reply@stylora.app
```

### Payment Providers (Optional but recommended)
```bash
# Stripe
⚠️ STRIPE_SECRET_KEY=sk_live_...
⚠️ STRIPE_WEBHOOK_SECRET=whsec_...
⚠️ STRIPE_CONNECT_CLIENT_ID=ca_...

# Vipps (Norwegian market)
⚠️ VIPPS_CLIENT_ID=...
⚠️ VIPPS_CLIENT_SECRET=...
⚠️ VIPPS_SUBSCRIPTION_KEY=...
```

### Accounting Systems (Optional)
```bash
# Fiken
⚠️ FIKEN_API_KEY=...

# Unimicro
⚠️ UNIMICRO_CLIENT_ID=...
⚠️ UNIMICRO_CLIENT_SECRET=...
```

### SMS Providers (Choose one)
```bash
# PSWinCom (Norwegian)
⚠️ PSWINCOM_USERNAME=...
⚠️ PSWINCOM_PASSWORD=...

# OR LinkMobility
⚠️ LINKMOBILITY_API_KEY=...

# OR Twilio (International)
⚠️ TWILIO_ACCOUNT_SID=...
⚠️ TWILIO_AUTH_TOKEN=...
```

### Monitoring & Error Tracking (Recommended)
```bash
# Sentry
⚠️ SENTRY_DSN=https://...@sentry.io/...
⚠️ VITE_SENTRY_DSN=https://...@sentry.io/...

# Backup Storage (Backblaze B2 or AWS S3)
⚠️ BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
⚠️ BACKUP_S3_REGION=eu-central-003
⚠️ BACKUP_S3_BUCKET=stylora-backups
⚠️ BACKUP_S3_ACCESS_KEY=...
⚠️ BACKUP_S3_SECRET_KEY=...
⚠️ BACKUP_RETENTION_DAYS=30
```

---

## 📦 Deployment Steps

### Step 1: Prepare Railway Environment
```bash
# 1. Login to Railway
railway login

# 2. Link to project
railway link

# 3. Set environment variables
railway variables set DATABASE_URL="mysql://..."
railway variables set JWT_SECRET="your-secret-here"
# ... (add all required variables)

# 4. Verify variables
railway variables
```

### Step 2: Database Migration
```bash
# Run migrations on production database
pnpm db:push

# Verify tables created
# Check: unimicroSettings, unimicroInvoiceMapping, etc.
```

### Step 3: Deploy Application
```bash
# Option A: Deploy via GitHub (Recommended)
git push origin main
# Railway auto-deploys from GitHub

# Option B: Deploy via Railway CLI
railway up
```

### Step 4: Verify Deployment
```bash
# Check deployment status
railway status

# View logs
railway logs

# Test application
curl https://your-app.railway.app/api/health
```

---

## 🧪 Post-Deployment Testing

### 1. Health Checks
- [ ] Application loads without errors
- [ ] Database connection successful
- [ ] API endpoints responding
- [ ] Static assets loading correctly

### 2. Integration Testing
- [ ] **Unimicro Sync:** Test manual sync from admin panel
- [ ] **Email Service:** Send test email from Settings → Notifications
- [ ] **SMS Service:** Send test SMS notification
- [ ] **Stripe Payment:** Create test payment in POS
- [ ] **Fiken Sync:** Verify invoice sync working

### 3. User Flow Testing
- [ ] **Admin Login:** Test with demo account
- [ ] **Create Appointment:** Book test appointment
- [ ] **Customer Management:** Add/edit customer
- [ ] **Service Management:** Add/edit service
- [ ] **Employee Management:** Add/edit employee
- [ ] **Reports:** Generate financial report
- [ ] **Public Booking:** Test booking flow (if enabled)

### 4. Performance Testing
- [ ] Page load times < 2 seconds
- [ ] API response times < 500ms
- [ ] Database queries optimized
- [ ] No memory leaks

---

## 📊 Monitoring Setup (24-Hour Watch)

### Unimicro Sync Monitoring
```sql
-- Check sync logs for errors
SELECT * FROM unimicroSyncLog 
WHERE status = 'failed' 
ORDER BY syncStartedAt DESC 
LIMIT 10;

-- Monitor sync frequency
SELECT 
  DATE(syncStartedAt) as date,
  COUNT(*) as sync_count,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM unimicroSyncLog
WHERE syncStartedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY DATE(syncStartedAt);
```

### Email/SMS Delivery Monitoring
```sql
-- Check notification delivery rates
SELECT 
  notificationType,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as success_rate
FROM notifications
WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY notificationType;
```

### Application Error Monitoring
```bash
# Monitor Railway logs for errors
railway logs --filter "ERROR"

# Check Sentry dashboard (if configured)
# https://sentry.io/organizations/your-org/issues/
```

---

## 🚨 Rollback Plan

### If Critical Issues Occur:

#### Option 1: Rollback to Previous Checkpoint
```bash
# Via Dashboard UI
# 1. Go to Management UI → Code
# 2. Find previous checkpoint (before integration fixes)
# 3. Click "Rollback"

# Via Railway
railway rollback
```

#### Option 2: Restore Database Backup
```bash
# 1. Download latest backup from Backblaze B2
# 2. Restore to database
mysql -h <host> -u <user> -p <database> < backup.sql

# 3. Verify data integrity
# 4. Restart application
railway restart
```

#### Option 3: Emergency Hotfix
```bash
# 1. Create hotfix branch
git checkout -b hotfix/critical-issue

# 2. Apply fix
# ... make changes ...

# 3. Test locally
pnpm test

# 4. Deploy immediately
git push origin hotfix/critical-issue
railway up
```

---

## 📝 Success Criteria

### Deployment Successful If:
- ✅ Application loads without errors
- ✅ All integrations responding correctly
- ✅ No critical errors in logs for 1 hour
- ✅ Unimicro sync completing successfully
- ✅ Email/SMS notifications sending
- ✅ Payment processing working
- ✅ User flows completing without issues

### Monitor for 24 Hours:
- ✅ Unimicro sync logs (check every 4 hours)
- ✅ Email delivery rates (>95% success rate)
- ✅ SMS delivery rates (>95% success rate)
- ✅ Application error rates (<0.1%)
- ✅ API response times (<500ms average)
- ✅ Database query performance
- ✅ User feedback and support tickets

---

## 📞 Emergency Contacts

**Technical Lead:** [Your Name]  
**Database Admin:** [DBA Name]  
**Railway Support:** https://railway.app/help  
**Sentry Support:** https://sentry.io/support/

---

## ✅ Deployment Sign-Off

- [ ] All pre-deployment checks completed
- [ ] Environment variables configured
- [ ] Database migrations successful
- [ ] Application deployed successfully
- [ ] Post-deployment testing passed
- [ ] Monitoring systems active
- [ ] Team notified of deployment

**Deployed By:** _________________  
**Date:** _________________  
**Time:** _________________  
**Deployment Version:** 5ff2b184

---

**Status:** 🟢 READY FOR PRODUCTION DEPLOYMENT
