# دليل النشر - Stylora Deployment Guide

## 🎉 تم إزالة external dependencies بنجاح!

هذا الدليل يشرح كيفية نشر Stylora على استضافة خارجية.

---

## ✅ التعديلات المنجزة - Completed Modifications

### 1. إزالة Development Plugins
- ✅ حذف `vite-plugin-manus-runtime` من package.json
- ✅ تنظيف vite.config.ts من development hosts
- ✅ إزالة HMR configuration الخاصة بـ Stylora

### 2. استبدال نظام OAuth
- ✅ إنشاء نظام مصادقة بسيط مبني على JWT
- ✅ تحديث server/_core/context.ts
- ✅ تحديث server/_core/index.ts
- ✅ ملف جديد: `server/_core/auth-simple.ts`

### 3. تعطيل ميزات Stylora الاختيارية
- ✅ تعطيل AI integration (server/_core/llm.ts)
- ✅ تعطيل notification system (server/_core/notification.ts)

---

## 🚀 خيارات النشر - Deployment Options

### الخيار 1: Vercel + PlanetScale (موصى به للمبتدئين)

#### المميزات:
- نشر سريع وسهل
- قاعدة بيانات MySQL مُدارة
- CDN عالمي
- SSL مجاني
- **التكلفة**: $0-20/شهر

#### الخطوات:

**1. إعداد قاعدة البيانات على PlanetScale:**

```bash
# 1. إنشاء حساب على https://planetscale.com
# 2. إنشاء قاعدة بيانات جديدة
# 3. الحصول على connection string
```

**2. رفع الكود على GitHub:**

```bash
cd /path/to/stylora-website
git init
git add .
git commit -m "Initial commit - Stylora ready for deployment"
git remote add origin https://github.com/YOUR_USERNAME/stylora.git
git push -u origin main
```

**3. النشر على Vercel:**

```bash
# 1. إنشاء حساب على https://vercel.com
# 2. ربط GitHub repository
# 3. إضافة متغيرات البيئة (انظر القسم التالي)
# 4. النشر!
```

---

### الخيار 2: Railway (الأسهل - كل شيء في مكان واحد)

#### المميزات:
- قاعدة بيانات + استضافة معاً
- إعداد سريع جداً
- دعم Docker
- **التكلفة**: $5-25/شهر

#### الخطوات:

```bash
# 1. إنشاء حساب على https://railway.app
# 2. إنشاء مشروع جديد
# 3. إضافة MySQL database
# 4. ربط GitHub repository
# 5. إضافة متغيرات البيئة
# 6. النشر!
```

---

### الخيار 3: DigitalOcean App Platform

#### المميزات:
- تحكم كامل
- أسعار ثابتة
- سهل الاستخدام
- **التكلفة**: $12-25/شهر

---

## 🔐 متغيرات البيئة المطلوبة - Required Environment Variables

### متغيرات أساسية (مطلوبة):

```env
# Database
DATABASE_URL=mysql://user:password@host:3306/database_name

# JWT Secret (أنشئ مفتاح عشوائي قوي)
JWT_SECRET=your-super-secret-jwt-key-change-this

# App Configuration
VITE_APP_ID=stylora
VITE_APP_TITLE=Stylora
NODE_ENV=production
PORT=3000

# Owner Configuration (للوصول الإداري)
OWNER_OPEN_ID=your_admin_email@example.com
```

### متغيرات AWS (للتخزين):

```env
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

### متغيرات Stripe (للمدفوعات):

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### متغيرات Email (AWS SES):

```env
SES_FROM_EMAIL=noreply@yourdomain.com
```

### متغيرات اختيارية (للميزات الإضافية):

```env
# Twilio SMS (اختياري)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Fiken Integration (اختياري - للمحاسبة النرويجية)
FIKEN_CLIENT_ID=your_client_id
FIKEN_CLIENT_SECRET=your_client_secret

# Unimicro Integration (اختياري - للمحاسبة النرويجية)
UNIMICRO_CLIENT_ID=your_client_id
UNIMICRO_CLIENT_SECRET=your_client_secret
```

---

## 📝 خطوات ما بعد النشر - Post-Deployment Steps

### 1. إعداد قاعدة البيانات:

```bash
# تشغيل migrations
pnpm db:push
```

### 2. إنشاء حساب المدير الأول:

استخدم API endpoint للتسجيل:

```bash
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "temporary-password",
    "name": "Admin User"
  }'
```

**⚠️ مهم**: هذا نظام مصادقة مؤقت! يجب استبداله بنظام أكثر أماناً قبل الإنتاج.

### 3. إعداد Stripe Webhooks:

```
1. اذهب إلى Stripe Dashboard
2. Developers → Webhooks
3. أضف endpoint: https://your-domain.com/api/stripe/webhook
4. اختر الأحداث: payment_intent.succeeded, checkout.session.completed
5. احفظ webhook secret في متغيرات البيئة
```

### 4. إعداد AWS S3:

```bash
# إنشاء bucket جديد
aws s3 mb s3://your-stylora-bucket

# إعداد CORS
aws s3api put-bucket-cors --bucket your-stylora-bucket --cors-configuration file://cors.json
```

cors.json:
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-domain.com"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

---

## ⚠️ تحذيرات أمنية مهمة - Security Warnings

### 🔴 نظام المصادقة الحالي مؤقت!

الكود الحالي يستخدم نظام مصادقة بسيط **للتطوير فقط**. قبل الإنتاج، يجب:

1. **إضافة تشفير كلمات المرور** (bcrypt موجود بالفعل)
2. **إضافة email verification**
3. **إضافة password reset**
4. **أو استخدام OAuth provider** (Google, GitHub, Auth0, Supabase)

### خيارات للإنتاج:

#### الخيار 1: Supabase Auth (موصى به)
```bash
npm install @supabase/supabase-js
```

#### الخيار 2: Auth0
```bash
npm install @auth0/auth0-react
```

#### الخيار 3: NextAuth.js
```bash
npm install next-auth
```

---

## 🔧 استكشاف الأخطاء - Troubleshooting

### المشكلة: "Missing STRIPE_SECRET_KEY in environment"

**الحل**: أضف متغيرات Stripe في لوحة التحكم:
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### المشكلة: Database connection failed

**الحل**: تأكد من صحة DATABASE_URL:
```env
DATABASE_URL=mysql://user:password@host:3306/database?ssl={"rejectUnauthorized":true}
```

### المشكلة: AI features not working

**الجواب**: تم تعطيل AI features عمداً. لتفعيلها:
1. افتح `server/_core/llm.ts`
2. استبدل OpenAI API بـ OpenAI أو Anthropic
3. أضف API key في متغيرات البيئة

---

## 💰 تقدير التكاليف الشهرية - Monthly Cost Estimate

| الخدمة | التكلفة |
|--------|---------|
| Vercel (Hosting) | $0-20 |
| PlanetScale (Database) | $0-29 |
| AWS S3 (Storage) | $1-5 |
| AWS SES (Email) | $0.10/1000 emails |
| Stripe (Payments) | 2.9% + $0.30/transaction |
| Twilio SMS (Optional) | $0.0075/message |
| **المجموع** | **$10-60/شهر** |

---

## 📚 موارد إضافية - Additional Resources

### التوثيق:
- [Vercel Docs](https://vercel.com/docs)
- [PlanetScale Docs](https://planetscale.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Stripe Docs](https://stripe.com/docs)
- [AWS S3 Docs](https://docs.aws.amazon.com/s3/)

### الدعم:
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [tRPC Docs](https://trpc.io)
- [React Docs](https://react.dev)

---

## ✅ قائمة التحقق النهائية - Final Checklist

قبل النشر، تأكد من:

- [ ] تم رفع الكود على GitHub
- [ ] تم إنشاء قاعدة بيانات
- [ ] تم إضافة جميع متغيرات البيئة
- [ ] تم تشغيل database migrations
- [ ] تم اختبار تسجيل الدخول
- [ ] تم إعداد Stripe webhooks
- [ ] تم إعداد AWS S3 bucket
- [ ] تم اختبار رفع الصور
- [ ] تم تغيير JWT_SECRET
- [ ] تم إعداد custom domain (اختياري)

---

## 🎯 الخطوات التالية - Next Steps

1. **اختبار شامل** للتطبيق على الاستضافة الجديدة
2. **استبدال نظام المصادقة** بنظام إنتاجي آمن
3. **إضافة monitoring** (Sentry, LogRocket)
4. **إعداد backups** لقاعدة البيانات
5. **تحسين الأداء** (caching, CDN)
6. **إضافة tests** (Vitest, Playwright)

---

## 📞 الدعم - Support

إذا واجهت أي مشاكل:
1. راجع قسم استكشاف الأخطاء أعلاه
2. تحقق من logs في لوحة التحكم
3. راجع التوثيق الرسمي للخدمات المستخدمة

---

**تم إنشاء هذا الدليل بواسطة Stylora Team**  
**تاريخ**: 14 ديسمبر 2024
