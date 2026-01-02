import nodemailer from "nodemailer";
import { ENV } from "./_core/env";
import { sendEmailViaSES, isAWSSESConfigured } from "./_core/aws-ses";

/**
 * Email sending helper using nodemailer with SMTP
 * 
 * Configured via environment variables:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM_EMAIL: From email address (default: no-reply@stylora.app)
 */

// Create transporter (reused across all emails)
const transporter = nodemailer.createTransport({
  host: ENV.smtpHost,
  port: ENV.smtpPort,
  secure: ENV.smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: ENV.smtpUser,
    pass: ENV.smtpPass,
  },
});

/**
 * Send an email
 * 
 * @param options Email options (to, subject, html)
 * @returns Promise that resolves when email is sent
 * 
 * Note: Errors are logged but not thrown to prevent breaking main logic
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  // Skip if no recipient
  if (!options.to) {
    console.warn("[Email] No recipient provided, skipping email");
    return;
  }

  // Try AWS SES first if configured
  if (isAWSSESConfigured()) {
    try {
      await sendEmailViaSES({
        to: [options.to],
        subject: options.subject,
        htmlBody: options.html,
      });
      console.log("[Email] Sent successfully via AWS SES to:", options.to);
      return;
    } catch (error) {
      console.error("[Email] AWS SES failed, falling back to SMTP:", error);
      // Fall through to SMTP if AWS SES fails
    }
  }

  // Fallback to SMTP if AWS SES not configured or failed
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPass) {
    console.warn("[Email] Neither AWS SES nor SMTP configured, skipping email to:", options.to);
    return;
  }

  try {
    await transporter.sendMail({
      from: ENV.smtpFromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    console.log("[Email] Sent successfully via SMTP to:", options.to);
  } catch (error) {
    console.error("[Email] Failed to send to:", options.to, error);
    // Don't throw - email failure should not break main logic
  }
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

/**
 * Render booking confirmation email
 * 
 * Sent when an appointment is confirmed (either manually or via payment)
 */
export function renderBookingConfirmationEmail(params: {
  salonName: string;
  customerName: string;
  date: string; // formatted, e.g. "25. mars 2026"
  time: string; // "14:30"
  services: string[];
}) {
  const servicesList = params.services.join(", ");

  return {
    subject: `Bekreftelse på timebestilling hos ${params.salonName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px 20px;
            border-radius: 8px 8px 0 0;
            text-align: center;
          }
          .content {
            background: #f9fafb;
            padding: 30px 20px;
            border-radius: 0 0 8px 8px;
          }
          .details {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .detail-row {
            margin: 10px 0;
          }
          .detail-label {
            font-weight: 600;
            color: #667eea;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #6b7280;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0;">✂️ Timebestilling bekreftet</h1>
        </div>
        <div class="content">
          <p>Hei ${params.customerName},</p>
          <p>Vi bekrefter din timebestilling hos <strong>${params.salonName}</strong>.</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">📅 Dato:</span> ${params.date}
            </div>
            <div class="detail-row">
              <span class="detail-label">🕐 Klokkeslett:</span> ${params.time}
            </div>
            <div class="detail-row">
              <span class="detail-label">💇 Tjenester:</span> ${servicesList}
            </div>
          </div>
          
          <p>Velkommen!</p>
          <p style="margin-top: 30px;">Hilsen<br/><strong>${params.salonName}</strong></p>
        </div>
        <div class="footer">
          <p>Denne e-posten ble sendt automatisk fra Stylora</p>
        </div>
      </body>
      </html>
    `,
  };
}

/**
 * Render booking cancellation email
 * 
 * Sent when an appointment is canceled (by staff or system)
 */
export function renderBookingRescheduleEmail(params: {
  salonName: string;
  customerName: string;
  oldDate: string;
  oldTime: string;
  newDate: string;
  newTime: string;
  services: string[];
}) {
  const servicesList = params.services.join(", ");

  const subject = `Tidspunkt endret - ${params.salonName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #4F46E5; }
        .header h1 { color: #4F46E5; margin: 0; font-size: 28px; }
        .content { margin-bottom: 30px; }
        .info-box { background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .old-time { text-decoration: line-through; color: #999; }
        .new-time { color: #059669; font-weight: bold; font-size: 18px; }
        .details { background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .details p { margin: 10px 0; }
        .details strong { color: #4F46E5; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; color: #6B7280; font-size: 14px; }
        .button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 Tidspunkt endret</h1>
        </div>
        <div class="content">
          <p>Hei ${params.customerName},</p>
          <p>Din booking hos <strong>${params.salonName}</strong> har blitt flyttet til et nytt tidspunkt.</p>
          
          <div class="info-box">
            <p><strong>⚠️ Viktig:</strong> Tidspunktet for din avtale er endret.</p>
          </div>

          <div class="details">
            <p><strong>Tjeneste:</strong> ${servicesList}</p>
            <p class="old-time"><strong>Gammelt tidspunkt:</strong> ${params.oldDate} kl. ${params.oldTime}</p>
            <p class="new-time"><strong>Nytt tidspunkt:</strong> ${params.newDate} kl. ${params.newTime}</p>
          </div>

          <p>Hvis dette ikke stemmer eller du har spørsmål, vennligst kontakt oss så snart som mulig.</p>
          <p>Vi gleder oss til å se deg!</p>
        </div>
        <div class="footer">
          <p><strong>${params.salonName}</strong></p>
          <p>Dette er en automatisk e-post. Vennligst ikke svar på denne meldingen.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

export function renderBookingCancellationEmail(params: {
  salonName: string;
  customerName: string;
  date: string;
  time: string;
}) {
  return {
    subject: `Timebestilling hos ${params.salonName} er kansellert`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
            color: white;
            padding: 30px 20px;
            border-radius: 8px 8px 0 0;
            text-align: center;
          }
          .content {
            background: #f9fafb;
            padding: 30px 20px;
            border-radius: 0 0 8px 8px;
          }
          .details {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .detail-row {
            margin: 10px 0;
          }
          .detail-label {
            font-weight: 600;
            color: #ef4444;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #6b7280;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0;">❌ Timebestilling kansellert</h1>
        </div>
        <div class="content">
          <p>Hei ${params.customerName},</p>
          <p>Vi informerer om at din time hos <strong>${params.salonName}</strong> er kansellert.</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">📅 Dato:</span> ${params.date}
            </div>
            <div class="detail-row">
              <span class="detail-label">🕐 Klokkeslett:</span> ${params.time}
            </div>
          </div>
          
          <p>Ta gjerne kontakt dersom du ønsker å bestille ny time.</p>
          <p style="margin-top: 30px;">Hilsen<br/><strong>${params.salonName}</strong></p>
        </div>
        <div class="footer">
          <p>Denne e-posten ble sendt automatisk fra Stylora</p>
        </div>
      </body>
      </html>
    `,
  };
}

/**
 * Send receipt email with PDF attachment
 * 
 * @param options Email options with PDF attachment
 * @returns Promise that resolves when email is sent
 */
export async function sendReceiptEmail(options: {
  to: string;
  salonName: string;
  customerName: string;
  orderId: number;
  total: string;
  pdfBuffer: Buffer;
  filename: string;
}): Promise<void> {
  // Skip if no recipient
  if (!options.to) {
    console.warn("[Email] No recipient provided, skipping receipt email");
    return;
  }

  const emailContent = renderReceiptEmail({
    salonName: options.salonName,
    customerName: options.customerName,
    orderId: options.orderId,
    total: options.total,
  });

  // Note: AWS SES doesn't support attachments directly via SendEmailCommand
  // For attachments, we must use SMTP or SES with SendRawEmailCommand
  // For now, we'll use SMTP for receipt emails with attachments
  
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPass) {
    console.warn("[Email] SMTP not configured, cannot send receipt with attachment to:", options.to);
    return;
  }

  try {
    await transporter.sendMail({
      from: ENV.smtpFromEmail,
      to: options.to,
      subject: emailContent.subject,
      html: emailContent.html,
      attachments: [
        {
          filename: options.filename,
          content: options.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    console.log("[Email] Receipt sent successfully to:", options.to);
  } catch (error) {
    console.error("[Email] Failed to send receipt to:", options.to, error);
    // Don't throw - email failure should not break main logic
  }
}

/**
 * Render receipt email template
 * 
 * Sent when a customer requests a receipt via email
 */
export function renderReceiptEmail(params: {
  salonName: string;
  customerName: string;
  orderId: number;
  total: string;
}) {
  return {
    subject: `Kvittering fra ${params.salonName} - Ordre #${params.orderId}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #2563eb 0%, #ea580c 100%);
            color: white;
            padding: 30px 20px;
            border-radius: 8px 8px 0 0;
            text-align: center;
          }
          .content {
            background: #f9fafb;
            padding: 30px 20px;
            border-radius: 0 0 8px 8px;
          }
          .details {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .detail-row {
            margin: 10px 0;
          }
          .detail-label {
            font-weight: 600;
            color: #2563eb;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #6b7280;
            font-size: 14px;
          }
          .attachment-note {
            background: #dbeafe;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0;">🧾 Kvittering</h1>
        </div>
        <div class="content">
          <p>Hei ${params.customerName},</p>
          <p>Takk for besøket hos <strong>${params.salonName}</strong>!</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">📋 Ordre-ID:</span> #${params.orderId}
            </div>
            <div class="detail-row">
              <span class="detail-label">💰 Total:</span> ${params.total}
            </div>
          </div>

          <div class="attachment-note">
            <strong>📎 Vedlegg:</strong> Din kvittering er vedlagt som PDF-fil.
          </div>
          
          <p>Velkommen tilbake!</p>
          <p style="margin-top: 30px;">Hilsen<br/><strong>${params.salonName}</strong></p>
        </div>
        <div class="footer">
          <p>Denne e-posten ble sendt automatisk fra Stylora</p>
        </div>
      </body>
      </html>
    `,
  };
}
