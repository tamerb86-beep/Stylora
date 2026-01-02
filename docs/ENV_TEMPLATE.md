# Environment Variables Template
# نموذج متغيرات البيئة

انسخ هذا الملف إلى `.env` واملأ القيم المناسبة.
Copy this file to `.env` and fill in the appropriate values.

---

## 🔧 Application Settings | إعدادات التطبيق

```env
# Application
NODE_ENV=production
PORT=3000

# App Identity
VITE_APP_ID=stylora
VITE_APP_TITLE=Stylora
VITE_APP_URL=https://your-domain.com
VITE_FRONTEND_URL=https://your-domain.com

# Owner (Platform Admin)
# البريد الإلكتروني لمدير المنصة - سيحصل على صلاحيات كاملة
OWNER_OPEN_ID=admin@yourdomain.com
```

---

## 🔐 Authentication | المصادقة

```env
# JWT Secret (minimum 32 characters)
# مفتاح سري للتشفير - يجب أن يكون 32 حرف على الأقل
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
```

---

## 🗄️ Database | قاعدة البيانات

```env
# MySQL Connection String
# رابط الاتصال بقاعدة البيانات MySQL
DATABASE_URL=mysql://username:password@host:3306/database_name

# Railway Example:
# DATABASE_URL=${{MySQL.DATABASE_URL}}
```

---

## 🔑 Supabase Auth | مصادقة Supabase

```env
# Get these from: https://supabase.com/dashboard → Settings → API
# احصل على هذه القيم من لوحة تحكم Supabase

SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 💳 Stripe Payments | مدفوعات Stripe

```env
# Get these from: https://dashboard.stripe.com/apikeys
# احصل على هذه القيم من لوحة تحكم Stripe

# API Keys
STRIPE_SECRET_KEY=sk_live_YOUR_STRIPE_SECRET_KEY
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_STRIPE_PUBLISHABLE_KEY

# Webhook Secret (from Stripe Dashboard → Webhooks)
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET

# Stripe Connect (Optional - for SaaS multi-tenant)
STRIPE_CONNECT_CLIENT_ID=ca_YOUR_CONNECT_CLIENT_ID
```

---

## 📱 Vipps Payments (Norway) | مدفوعات Vipps

```env
# Get these from: https://portal.vipps.no
# احصل على هذه القيم من بوابة Vipps

VIPPS_CLIENT_ID=your-vipps-client-id
VIPPS_CLIENT_SECRET=your-vipps-client-secret
VIPPS_SUBSCRIPTION_KEY=your-vipps-subscription-key
VIPPS_MERCHANT_SERIAL_NUMBER=your-merchant-serial-number

# API URL
# For testing: https://apitest.vipps.no
# For production: https://api.vipps.no
VIPPS_API_URL=https://api.vipps.no
```

---

## ☁️ AWS S3 Storage | تخزين AWS S3

```env
# Get these from: AWS Console → IAM → Users → Create User with S3 access
# احصل على هذه القيم من وحدة تحكم AWS

AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=eu-north-1
AWS_S3_BUCKET=your-bucket-name
```

---

## 📧 Email (SMTP) | البريد الإلكتروني

```env
# Option 1: Gmail SMTP
# الخيار 1: Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM_EMAIL=noreply@yourdomain.com

# Option 2: AWS SES
# الخيار 2: AWS SES
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
```

---

## 📲 SMS Notifications | إشعارات SMS

```env
# SMS Provider: mock | twilio | pswinccom | linkmobility
SMS_PROVIDER=twilio

# Twilio (https://www.twilio.com)
SMS_API_KEY=your-twilio-account-sid
SMS_API_SECRET=your-twilio-auth-token
SMS_SENDER_ID=Stylora

# Or PSWinCom (Norway) / LinkMobility
# SMS_API_KEY=your-api-key
# SMS_API_SECRET=your-api-secret
```

---

## 📅 Google Calendar Integration (Optional) | تكامل Google Calendar

```env
# Get these from: https://console.cloud.google.com
# احصل على هذه القيم من Google Cloud Console

GOOGLE_CLIENT_ID=xxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/google/callback
```

---

## 🔍 Monitoring (Optional) | المراقبة

```env
# Sentry Error Tracking (https://sentry.io)
SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
VITE_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
```

---

## 📋 Complete Example | مثال كامل

```env
# ============================================
# STYLORA - Production Environment Variables
# ============================================

# Application
NODE_ENV=production
PORT=3000
VITE_APP_ID=stylora
VITE_APP_TITLE=Stylora
VITE_APP_URL=https://www.stylora.no
VITE_FRONTEND_URL=https://www.stylora.no
OWNER_OPEN_ID=admin@stylora.no

# Authentication
JWT_SECRET=change-this-to-a-very-long-random-string-at-least-32-chars

# Database (Railway auto-injects this)
DATABASE_URL=mysql://user:pass@host:3306/dbname

# Supabase Auth
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Stripe
STRIPE_SECRET_KEY=sk_live_YOUR_KEY
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET

# AWS S3
AWS_ACCESS_KEY_ID=AKIAXXXXX
AWS_SECRET_ACCESS_KEY=xxxxx
AWS_REGION=eu-north-1
AWS_S3_BUCKET=stylora-uploads

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@stylora.no
SMTP_PASS=app-password-here
SMTP_FROM_EMAIL=noreply@stylora.no

# SMS (Optional)
SMS_PROVIDER=twilio
SMS_API_KEY=ACxxxxx
SMS_API_SECRET=xxxxx
SMS_SENDER_ID=Stylora
```

---

## ⚠️ Security Notes | ملاحظات أمنية

1. **لا تشارك** هذه القيم مع أي شخص
2. **لا ترفع** ملف `.env` إلى GitHub
3. **استخدم** قيم مختلفة للتطوير والإنتاج
4. **غيّر** `JWT_SECRET` فوراً بعد النسخ
5. **فعّل** 2FA على جميع الحسابات (Stripe, AWS, Supabase)

---

## 🚀 Railway Deployment | النشر على Railway

عند النشر على Railway، أضف هذه المتغيرات في:
**Settings → Variables**

Railway يوفر `DATABASE_URL` تلقائياً عند إضافة MySQL.

---

## 📞 Need Help? | تحتاج مساعدة؟

- **Stripe Docs**: https://stripe.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **AWS S3 Docs**: https://docs.aws.amazon.com/s3
- **Railway Docs**: https://docs.railway.app
