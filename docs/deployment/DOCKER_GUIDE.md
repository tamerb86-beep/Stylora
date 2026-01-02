# دليل Docker - Docker Guide

## 🐳 نظرة عامة - Overview

يوفر هذا المشروع دعم Docker الكامل للتطوير المحلي والنشر في الإنتاج.

---

## 📦 الملفات المتضمنة - Included Files

- `Dockerfile` - Multi-stage production build
- `docker-compose.yml` - Local development environment
- `.dockerignore` - Files to exclude from Docker build

---

## 🚀 البدء السريع - Quick Start

### التطوير المحلي باستخدام Docker Compose:

```bash
# 1. إنشاء ملف .env (انظر القسم التالي)
cp .env.example .env
# عدّل .env بالقيم الصحيحة

# 2. تشغيل التطبيق
docker-compose up -d

# 3. عرض logs
docker-compose logs -f app

# 4. إيقاف التطبيق
docker-compose down

# 5. إيقاف وحذف البيانات
docker-compose down -v
```

التطبيق سيعمل على: `http://localhost:3000`

---

## 🔐 متغيرات البيئة المطلوبة - Required Environment Variables

أنشئ ملف `.env` في المجلد الرئيسي:

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

# AWS (Optional)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=stylora-uploads
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
```

---

## 🏗️ بناء Docker Image - Building Docker Image

### للإنتاج:

```bash
# بناء image
docker build -t stylora:latest .

# تشغيل container
docker run -d \
  --name stylora \
  -p 3000:3000 \
  --env-file .env \
  stylora:latest

# عرض logs
docker logs -f stylora

# إيقاف container
docker stop stylora
docker rm stylora
```

---

## 🔧 أوامر مفيدة - Useful Commands

### Docker Compose:

```bash
# تشغيل في الخلفية
docker-compose up -d

# إعادة بناء images
docker-compose up -d --build

# عرض الحالة
docker-compose ps

# عرض logs لخدمة معينة
docker-compose logs -f app
docker-compose logs -f db

# الدخول إلى container
docker-compose exec app sh
docker-compose exec db mysql -u stylora_user -p stylora

# إيقاف الخدمات
docker-compose stop

# إيقاف وحذف containers
docker-compose down

# إيقاف وحذف volumes (⚠️ يحذف البيانات)
docker-compose down -v
```

### Docker:

```bash
# عرض images
docker images

# عرض containers
docker ps -a

# حذف image
docker rmi stylora:latest

# حذف container
docker rm stylora

# تنظيف النظام
docker system prune -a
```

---

## 🗄️ إدارة قاعدة البيانات - Database Management

### تشغيل migrations:

```bash
# باستخدام docker-compose
docker-compose exec app pnpm db:push

# باستخدام docker run
docker run --rm \
  --network host \
  --env-file .env \
  stylora:latest \
  pnpm db:push
```

### Backup قاعدة البيانات:

```bash
# Backup
docker-compose exec db mysqldump \
  -u stylora_user \
  -pstylora_password \
  stylora > backup.sql

# Restore
docker-compose exec -T db mysql \
  -u stylora_user \
  -pstylora_password \
  stylora < backup.sql
```

---

## 🌐 النشر على خوادم مختلفة - Deployment Options

### 1. Docker Hub:

```bash
# تسجيل الدخول
docker login

# Tag image
docker tag stylora:latest yourusername/stylora:latest

# Push to Docker Hub
docker push yourusername/stylora:latest

# Pull and run on server
docker pull yourusername/stylora:latest
docker run -d -p 3000:3000 --env-file .env yourusername/stylora:latest
```

### 2. DigitalOcean App Platform:

```bash
# 1. Push code to GitHub
# 2. في DigitalOcean Dashboard:
#    - Create App
#    - Choose GitHub repo
#    - Select Dockerfile
#    - Add environment variables
#    - Deploy
```

### 3. AWS ECS:

```bash
# 1. Push image to ECR
aws ecr create-repository --repository-name stylora
docker tag stylora:latest AWS_ACCOUNT.dkr.ecr.REGION.amazonaws.com/stylora:latest
docker push AWS_ACCOUNT.dkr.ecr.REGION.amazonaws.com/stylora:latest

# 2. Create ECS task definition
# 3. Create ECS service
```

### 4. Google Cloud Run:

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/PROJECT_ID/stylora

# Deploy to Cloud Run
gcloud run deploy stylora \
  --image gcr.io/PROJECT_ID/stylora \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

---

## 🔍 استكشاف الأخطاء - Troubleshooting

### Container لا يبدأ:

```bash
# عرض logs
docker-compose logs app

# الدخول إلى container
docker-compose exec app sh

# فحص environment variables
docker-compose exec app env
```

### قاعدة البيانات لا تتصل:

```bash
# فحص حالة database
docker-compose ps db

# فحص logs
docker-compose logs db

# الاتصال يدوياً
docker-compose exec db mysql -u stylora_user -p
```

### Build يفشل:

```bash
# تنظيف cache
docker-compose build --no-cache

# فحص Dockerfile
docker build --progress=plain -t stylora:latest .
```

---

## 📊 المراقبة - Monitoring

### Health Checks:

```bash
# فحص health endpoint
curl http://localhost:3000/api/health

# فحص Docker health status
docker inspect --format='{{.State.Health.Status}}' stylora
```

### Resource Usage:

```bash
# عرض استخدام الموارد
docker stats

# عرض استخدام موارد container معين
docker stats stylora
```

---

## 🔒 الأمان - Security

### Best Practices:

1. **لا تضع secrets في Dockerfile**
2. **استخدم .env files** للمتغيرات الحساسة
3. **استخدم non-root user** في production (موجود في Dockerfile)
4. **حدّث base images** بانتظام
5. **scan images** للثغرات الأمنية:

```bash
# Scan image
docker scan stylora:latest

# أو استخدم Trivy
trivy image stylora:latest
```

---

## 🎯 Production Checklist

قبل النشر في الإنتاج:

- [ ] تم اختبار Docker build محلياً
- [ ] تم إضافة جميع environment variables
- [ ] تم اختبار database migrations
- [ ] تم إعداد health checks
- [ ] تم إعداد logging
- [ ] تم إعداد monitoring
- [ ] تم إعداد backups تلقائية
- [ ] تم scan image للثغرات الأمنية
- [ ] تم اختبار restart policies
- [ ] تم توثيق عملية النشر

---

## 📚 موارد إضافية - Additional Resources

- [Docker Documentation](https://docs.docker.com)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

---

**تم إنشاء هذا الدليل بواسطة Stylora Team** 🤖  
**آخر تحديث**: 14 ديسمبر 2024
