import nodemailer from "nodemailer";
import * as Sentry from "@sentry/node";

interface WelcomeEmailData {
  salonName: string;
  ownerName: string;
  ownerEmail: string;
  subdomain: string;
  loginUrl: string;
  trialDays: number;
}

/**
 * Create email transporter
 */
function createTransporter() {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom = process.env.SMTP_FROM || "noreply@stylora.no";

  if (!smtpUser || !smtpPassword) {
    console.warn("⚠️ SMTP credentials not configured. Email sending disabled.");
    return null;
  }

  return nodemailer.createTransporter({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });
}

/**
 * Generate welcome email HTML template
 */
function generateWelcomeEmailHTML(data: WelcomeEmailData): string {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحباً في Stylora</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
      direction: rtl;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 20px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: bold;
    }
    .header p {
      margin: 10px 0 0 0;
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 20px;
      color: #333;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .info-box {
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 20px 0;
      border-radius: 8px;
    }
    .info-box h3 {
      margin: 0 0 15px 0;
      color: #333;
      font-size: 18px;
    }
    .info-item {
      margin: 10px 0;
      font-size: 14px;
      color: #555;
    }
    .info-item strong {
      color: #333;
      display: inline-block;
      min-width: 120px;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      margin: 20px 0;
      text-align: center;
    }
    .cta-button:hover {
      opacity: 0.9;
    }
    .quick-start {
      background-color: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
    }
    .quick-start h3 {
      margin: 0 0 15px 0;
      color: #856404;
      font-size: 18px;
    }
    .quick-start ol {
      margin: 0;
      padding-right: 20px;
      color: #856404;
    }
    .quick-start li {
      margin: 10px 0;
      line-height: 1.6;
    }
    .features {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 30px 0;
    }
    .feature {
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .feature-icon {
      font-size: 32px;
      margin-bottom: 10px;
    }
    .feature-title {
      font-size: 14px;
      font-weight: bold;
      color: #333;
      margin-bottom: 5px;
    }
    .feature-desc {
      font-size: 12px;
      color: #666;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 30px;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    .trial-badge {
      display: inline-block;
      background-color: #28a745;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: bold;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 مرحباً في Stylora</h1>
      <p>نظام إدارة الصالونات الأكثر تطوراً</p>
      <div class="trial-badge">✨ تجربة مجانية لمدة ${data.trialDays} يوم</div>
    </div>

    <div class="content">
      <div class="greeting">
        مرحباً ${data.ownerName}! 👋
      </div>

      <div class="message">
        نحن سعداء جداً بانضمامك إلى عائلة Stylora! تم إنشاء حساب <strong>${data.salonName}</strong> بنجاح وأنت الآن جاهز لبدء رحلتك في إدارة صالونك بشكل احترافي.
      </div>

      <div class="info-box">
        <h3>📋 معلومات حسابك</h3>
        <div class="info-item">
          <strong>اسم الصالون:</strong> ${data.salonName}
        </div>
        <div class="info-item">
          <strong>رابط لوحة التحكم:</strong> <a href="${data.loginUrl}">${data.loginUrl}</a>
        </div>
        <div class="info-item">
          <strong>البريد الإلكتروني:</strong> ${data.ownerEmail}
        </div>
        <div class="info-item">
          <strong>النطاق الفرعي:</strong> ${data.subdomain}.stylora.no
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${data.loginUrl}" class="cta-button">
          🚀 ابدأ الآن - تسجيل الدخول
        </a>
      </div>

      <div class="quick-start">
        <h3>🎯 دليل البدء السريع</h3>
        <ol>
          <li><strong>سجل الدخول</strong> إلى لوحة التحكم باستخدام بريدك الإلكتروني وكلمة المرور</li>
          <li><strong>أضف موظفيك</strong> من قسم "الموظفين" وحدد صلاحياتهم</li>
          <li><strong>أنشئ خدماتك</strong> مع الأسعار والمدة الزمنية لكل خدمة</li>
          <li><strong>فعّل الحجز الإلكتروني</strong> وشارك رابط الحجز مع عملائك</li>
          <li><strong>ابدأ باستقبال الحجوزات</strong> وإدارة مواعيدك بكل سهولة</li>
        </ol>
      </div>

      <div class="features">
        <div class="feature">
          <div class="feature-icon">📅</div>
          <div class="feature-title">إدارة المواعيد</div>
          <div class="feature-desc">تقويم تفاعلي مع إشعارات تلقائية</div>
        </div>
        <div class="feature">
          <div class="feature-icon">👥</div>
          <div class="feature-title">إدارة العملاء</div>
          <div class="feature-desc">قاعدة بيانات شاملة مع سجل الزيارات</div>
        </div>
        <div class="feature">
          <div class="feature-icon">💰</div>
          <div class="feature-title">التقارير المالية</div>
          <div class="feature-desc">تقارير مفصلة عن الإيرادات والأرباح</div>
        </div>
        <div class="feature">
          <div class="feature-icon">📱</div>
          <div class="feature-title">حجز إلكتروني</div>
          <div class="feature-desc">صفحة حجز مخصصة لصالونك</div>
        </div>
      </div>

      <div class="message">
        <strong>💡 نصيحة:</strong> استفد من فترة التجربة المجانية لاستكشاف جميع الميزات. إذا كنت بحاجة إلى مساعدة، فريق الدعم جاهز لمساعدتك في أي وقت!
      </div>
    </div>

    <div class="footer">
      <p>
        هل لديك أسئلة؟ تواصل معنا على 
        <a href="mailto:support@stylora.no">support@stylora.no</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} Stylora. جميع الحقوق محفوظة.
      </p>
      <p style="margin-top: 10px; font-size: 12px;">
        <a href="https://stylora.no/terms">الشروط والأحكام</a> | 
        <a href="https://stylora.no/privacy">سياسة الخصوصية</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send welcome email to new tenant
 */
export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<boolean> {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      console.warn("⚠️ Email transporter not configured. Skipping welcome email.");
      return false;
    }

    const htmlContent = generateWelcomeEmailHTML(data);

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Stylora <noreply@stylora.no>",
      to: data.ownerEmail,
      subject: `مرحباً في Stylora - ${data.salonName}`,
      html: htmlContent,
    });

    console.log(`✅ Welcome email sent to ${data.ownerEmail}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send welcome email:", error);
    
    // Send error to Sentry
    Sentry.captureException(error, {
      tags: {
        service: "welcome-email",
      },
      extra: {
        ownerEmail: data.ownerEmail,
        salonName: data.salonName,
      },
    });

    return false;
  }
}

/**
 * Send onboarding reminder email (for incomplete onboarding)
 */
export async function sendOnboardingReminderEmail(
  ownerEmail: string,
  ownerName: string,
  salonName: string,
  onboardingUrl: string
): Promise<boolean> {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      console.warn("⚠️ Email transporter not configured. Skipping reminder email.");
      return false;
    }

    const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; direction: rtl; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; background-color: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h2>مرحباً ${ownerName}!</h2>
    <p>لاحظنا أنك لم تكمل إعداد حساب <strong>${salonName}</strong> بعد.</p>
    <p>أكمل الإعداد الآن واستفد من جميع ميزات Stylora:</p>
    <ul>
      <li>إدارة المواعيد والحجوزات</li>
      <li>قاعدة بيانات العملاء</li>
      <li>التقارير المالية</li>
      <li>الحجز الإلكتروني</li>
    </ul>
    <a href="${onboardingUrl}" class="button">إكمال الإعداد</a>
    <p>إذا كنت بحاجة إلى مساعدة، لا تتردد في التواصل معنا.</p>
  </div>
</body>
</html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Stylora <noreply@stylora.no>",
      to: ownerEmail,
      subject: `أكمل إعداد ${salonName} - Stylora`,
      html: htmlContent,
    });

    console.log(`✅ Reminder email sent to ${ownerEmail}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send reminder email:", error);
    Sentry.captureException(error);
    return false;
  }
}
