# دليل النشر على Railway - Railway Deployment Guide

## 🚂 لماذا Railway؟

Railway هو أسهل خيار لنشر Stylora لأنه يوفر:
- ✅ **قاعدة بيانات MySQL + استضافة** في مكان واحد
- ✅ **إعداد سريع جداً** - أقل من 10 دقائق
- ✅ **أسعار معقولة** - $5-25/شهر
- ✅ **دعم تلقائي** للـ environment variables
- ✅ **CI/CD تلقائي** من GitHub

---

## 📋 المتطلبات - Prerequisites

1. حساب GitHub (مجاني)
2. حساب Railway (مجاني للبداية - $5 credit شهرياً)
3. حساب Supabase (مجاني)
4. حساب Stripe (للمدفوعات)
5. حساب AWS (للتخزين - اختياري)

---

## 🚀 خطوات النشر - Deployment Steps

### الخطوة 1: إعداد Supabase

1. اذهب إلى [supabase.com](https://supabase.com)
2. أنشئ حساب جديد
3. أنشئ مشروع جديد:
   - اختر اسم المشروع: `stylora`
   - اختر المنطقة الأقرب لك
   - اختر كلمة سر قوية لقاعدة البيانات

4. احصل على المفاتيح:
   - اذهب إلى **Settings** → **API**
   - انسخ:
     - `Project URL` → `SUPABASE_URL`
     - `anon public` key → `SUPABASE_ANON_KEY`
     - `service_role` key → `SUPABASE_SERVICE_KEY` (⚠️ سري جداً!)

5. تفعيل Email Auth:
   - اذهب إلى **Authentication** → **Providers**
   - فعّل **Email**
   - اضبط Email templates إذا أردت

---

### الخطوة 2: رفع الكود على GitHub

```bash
# 1. إنشاء repository جديد على GitHub
# اذهب إلى github.com وأنشئ repository باسم "stylora"

# 2. رفع الكود
cd /path/to/stylora-website
git init
git add .
git commit -m "Initial commit - Ready for Railway deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/stylora.git
git push -u origin main
```

---

### الخطوة 3: إنشاء مشروع على Railway

1. اذهب إلى [railway.app](https://railway.app)
2. اضغط **Start a New Project**
3. اختر **Deploy from GitHub repo**
4. اختر repository `stylora`
5. Railway سيبدأ بالـ build تلقائياً

---

### الخطوة 4: إضافة قاعدة بيانات MySQL

1. في مشروع Railway، اضغط **+ New**
2. اختر **Database** → **Add MySQL**
3. Railway سينشئ قاعدة بيانات MySQL تلقائياً
4. انسخ `DATABASE_URL` من **Variables** tab

---

### الخطوة 5: إضافة متغيرات البيئة

في Railway project، اذهب إلى **Variables** tab وأضف:

#### متغيرات أساسية (مطلوبة):

```env
# Database (سيتم إضافتها تلقائياً من MySQL service)
DATABASE_URL=${{MySQL.DATABASE_URL}}

# JWT Secret (أنشئ مفتاح عشوائي قوي)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars

# App Configuration
VITE_APP_ID=stylora
VITE_APP_TITLE=Stylora
NODE_ENV=production
PORT=3000

# Owner Configuration
OWNER_OPEN_ID=your_admin_email@example.com

# Supabase (من الخطوة 1)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...
```

#### متغيرات Stripe (للمدفوعات):

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

#### متغيرات AWS (للتخزين - اختياري):

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=stylora-uploads
```

#### متغيرات Email (AWS SES):

```env
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
```

---

### الخطوة 6: تشغيل Database Migrations

بعد النشر الأول:

1. في Railway، اذهب إلى service الخاص بك
2. اضغط **Settings** → **Deploy Triggers**
3. أو استخدم Railway CLI:

```bash
# تثبيت Railway CLI
npm install -g @railway/cli

# تسجيل الدخول
railway login

# ربط المشروع
railway link

# تشغيل migrations
railway run pnpm db:push
```

---

### الخطوة 7: إعداد Custom Domain (اختياري)

1. في Railway project، اذهب إلى **Settings**
2. اضغط **Generate Domain** للحصول على domain مجاني
3. أو أضف custom domain:
   - اضغط **Add Custom Domain**
   - أدخل domain الخاص بك
   - أضف DNS records في domain registrar

---

## 🔧 إعداد Stripe Webhooks

بعد النشر:

1. اذهب إلى [Stripe Dashboard](https://dashboard.stripe.com)
2. **Developers** → **Webhooks** → **Add endpoint**
3. URL: `https://your-railway-domain.up.railway.app/api/stripe/webhook`
4. اختر الأحداث:
   - `payment_intent.succeeded`
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. احفظ webhook secret في Railway variables: `STRIPE_WEBHOOK_SECRET`

---

## 📊 مراقبة التطبيق - Monitoring

### Logs في Railway:

```bash
# عرض logs مباشرة
railway logs

# متابعة logs
railway logs --follow
```

### في Railway Dashboard:
- اذهب إلى **Deployments** لرؤية تاريخ النشر
- اذهب إلى **Metrics** لرؤية استخدام الموارد
- اذهب إلى **Logs** لرؤية application logs

---

## 💰 التكلفة المتوقعة - Expected Costs

### Railway:
- **Hobby Plan**: $5/شهر (500 ساعة تنفيذ)
- **Pro Plan**: $20/شهر (unlimited)
- **Database**: $5-10/شهر (حسب الاستخدام)

### الخدمات الأخرى:
- **Supabase**: $0 (Free tier) أو $25/شهر (Pro)
- **Stripe**: 2.9% + $0.30 لكل معاملة
- **AWS S3**: $1-5/شهر
- **AWS SES**: $0.10/1000 email

**المجموع التقديري**: $10-40/شهر

---

## 🔄 التحديثات التلقائية - Auto Deployments

Railway يدعم CI/CD تلقائياً:

1. كل push إلى `main` branch سيؤدي إلى deployment تلقائي
2. يمكنك تعطيل هذا من **Settings** → **Deploy Triggers**
3. يمكنك إعداد branches مختلفة لـ staging و production

---

## 🐛 استكشاف الأخطاء - Troubleshooting

### خطأ: "Build failed"

```bash
# تحقق من logs
railway logs

# تأكد من أن package.json يحتوي على:
{
  "scripts": {
    "build": "vite build && esbuild server/index.ts ...",
    "start": "NODE_ENV=production node dist/index.js"
  }
}
```

### خطأ: "Database connection failed"

```bash
# تأكد من أن DATABASE_URL صحيح
railway variables

# تأكد من أن MySQL service يعمل
railway status
```

### خطأ: "Application crashed"

```bash
# تحقق من logs
railway logs --follow

# تأكد من أن جميع environment variables موجودة
railway variables
```

---

## 🔒 الأمان - Security

### Best Practices:

1. **لا تشارك** `SUPABASE_SERVICE_KEY` أو `STRIPE_SECRET_KEY`
2. **استخدم** environment variables فقط - لا تضع secrets في الكود
3. **فعّل** 2FA على Railway و GitHub
4. **راجع** Railway access logs بانتظام
5. **حدّث** dependencies بانتظام

---

## 📝 Checklist النشر النهائي

قبل الإطلاق للعملاء:

- [ ] تم اختبار التسجيل وتسجيل الدخول
- [ ] تم اختبار email verification
- [ ] تم اختبار password reset
- [ ] تم إعداد Stripe webhooks
- [ ] تم اختبار المدفوعات (test mode)
- [ ] تم إعداد custom domain
- [ ] تم اختبار رفع الصور
- [ ] تم إعداد database backups
- [ ] تم إعداد monitoring/alerts
- [ ] تم مراجعة جميع environment variables

---

## 🎯 الخطوات التالية - Next Steps

بعد النشر الناجح:

1. **اختبار شامل** لجميع الميزات
2. **إعداد backups** تلقائية لقاعدة البيانات
3. **إضافة monitoring** (Sentry, LogRocket)
4. **تحسين الأداء** (caching, CDN)
5. **إضافة tests** (Vitest, Playwright)

---

## 📞 الدعم - Support

### Railway Support:
- [Railway Docs](https://docs.railway.app)
- [Railway Discord](https://discord.gg/railway)
- [Railway Status](https://status.railway.app)

### Supabase Support:
- [Supabase Docs](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.com)

---

**تم إنشاء هذا الدليل بواسطة Stylora Team** 🤖  
**آخر تحديث**: 14 ديسمبر 2024
