/**
 * SMS Service for sending appointment reminders
 * 
 * In production, this would integrate with a Norwegian SMS provider like:
 * - PSWinCom (https://www.pswin.com/)
 * - Link Mobility (https://www.linkmobility.com/)
 * - Twilio (international)
 * 
 * For development, we use a mock service that logs to console.
 */

interface SMSConfig {
  provider: "mock" | "pswincom" | "linkmobility" | "twilio";
  apiKey?: string;
  apiSecret?: string;
  senderId?: string; // Sender name/number
}

interface SMSMessage {
  to: string; // Phone number in E.164 format (+47xxxxxxxx)
  message: string;
  scheduledFor?: Date;
  tenantId?: string; // Tenant ID for tenant-specific SMS settings
}

interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Get SMS configuration from environment or tenant settings
 */
async function getSMSConfig(tenantId?: string): Promise<SMSConfig> {
  // If tenantId provided, try to fetch tenant-specific SMS settings
  if (tenantId) {
    try {
      const { getDb } = await import("./db");
      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }
      
      const [tenant] = await db
        .select({
          smsProvider: tenants.smsProvider,
          smsApiKey: tenants.smsApiKey,
          smsApiSecret: tenants.smsApiSecret,
          smsPhoneNumber: tenants.smsPhoneNumber,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      
      // If tenant has SMS configured, use tenant settings
      if (tenant?.smsProvider && tenant?.smsApiKey) {
        return {
          provider: tenant.smsProvider,
          apiKey: tenant.smsApiKey,
          apiSecret: tenant.smsApiSecret || undefined,
          senderId: tenant.smsPhoneNumber || process.env.SMS_SENDER_ID || "Stylora",
        };
      }
    } catch (error) {
      console.error("Failed to fetch tenant SMS settings:", error);
      // Fall through to global settings
    }
  }
  
  // Fallback to global environment variables
  const provider = (process.env.SMS_PROVIDER || "mock") as SMSConfig["provider"];
  
  return {
    provider,
    apiKey: process.env.SMS_API_KEY,
    apiSecret: process.env.SMS_API_SECRET,
    senderId: process.env.SMS_SENDER_ID || "Stylora",
  };
}

/**
 * Send SMS using configured provider
 */
export async function sendSMS(message: SMSMessage): Promise<SMSResult> {
  const config = await getSMSConfig(message.tenantId);

  // Validate phone number format
  if (!message.to.startsWith("+")) {
    return {
      success: false,
      error: "Phone number must be in E.164 format (+47xxxxxxxx)",
    };
  }

  switch (config.provider) {
    case "mock":
      return sendMockSMS(message, config);
    
    case "pswincom":
      return sendPSWinComSMS(message, config);
    
    case "linkmobility":
      return sendLinkMobilitySMS(message, config);
    
    case "twilio":
      return sendTwilioSMS(message, config);
    
    default:
      return {
        success: false,
        error: `Unknown SMS provider: ${config.provider}`,
      };
  }
}

/**
 * Mock SMS service for development
 */
async function sendMockSMS(message: SMSMessage, config: SMSConfig): Promise<SMSResult> {
  console.log("📱 [MOCK SMS]");
  console.log(`   To: ${message.to}`);
  console.log(`   From: ${config.senderId}`);
  console.log(`   Message: ${message.message}`);
  if (message.scheduledFor) {
    console.log(`   Scheduled: ${message.scheduledFor.toISOString()}`);
  }
  console.log("   Status: ✅ Sent (mock)");

  return {
    success: true,
    messageId: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };
}

/**
 * PSWinCom SMS service (Norwegian provider)
 * Documentation: https://wiki.pswin.com/
 */
async function sendPSWinComSMS(message: SMSMessage, config: SMSConfig): Promise<SMSResult> {
  if (!config.apiKey) {
    return { success: false, error: "PSWinCom API key not configured" };
  }

  try {
    // PSWinCom API endpoint
    const response = await fetch("https://simple.pswin.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        USER: config.apiKey,
        PW: config.apiSecret,
        RCV: message.to.replace("+", ""), // Remove + prefix
        SND: config.senderId,
        TXT: message.message,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `PSWinCom API error: ${response.statusText}`,
      };
    }

    const data = await response.text();
    
    return {
      success: true,
      messageId: data.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: `PSWinCom error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Link Mobility SMS service (Norwegian provider)
 * Documentation: https://www.linkmobility.com/developers/
 */
async function sendLinkMobilitySMS(message: SMSMessage, config: SMSConfig): Promise<SMSResult> {
  if (!config.apiKey) {
    return { success: false, error: "Link Mobility API key not configured" };
  }

  try {
    const response = await fetch("https://wsx.sp247.net/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        source: config.senderId,
        destination: message.to,
        userData: message.message,
        platformId: "Stylora",
        platformPartnerId: config.apiSecret,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Link Mobility API error: ${response.statusText}`,
      };
    }

    const data = await response.json();
    
    return {
      success: true,
      messageId: data.messageId || data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: `Link Mobility error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Twilio SMS service (international provider)
 * Documentation: https://www.twilio.com/docs/sms
 */
async function sendTwilioSMS(message: SMSMessage, config: SMSConfig): Promise<SMSResult> {
  if (!config.apiKey || !config.apiSecret) {
    return { success: false, error: "Twilio credentials not configured" };
  }

  try {
    const accountSid = config.apiKey;
    const authToken = config.apiSecret;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${auth}`,
        },
        body: new URLSearchParams({
          To: message.to,
          From: config.senderId || "",
          Body: message.message,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `Twilio API error: ${error.message || response.statusText}`,
      };
    }

    const data = await response.json();
    
    return {
      success: true,
      messageId: data.sid,
    };
  } catch (error) {
    return {
      success: false,
      error: `Twilio error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Format appointment reminder message in Norwegian
 */
export function formatAppointmentReminder(params: {
  customerName: string;
  salonName: string;
  appointmentDate: Date;
  appointmentTime: string;
  serviceName?: string;
}): string {
  const dateStr = params.appointmentDate.toLocaleDateString("no-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  let message = `Hei ${params.customerName}! Dette er en påminnelse om din time hos ${params.salonName} ${dateStr} kl. ${params.appointmentTime}.`;
  
  if (params.serviceName) {
    message += ` Tjeneste: ${params.serviceName}.`;
  }

  message += ` Vi gleder oss til å se deg!`;

  return message;
}

/**
 * Validate Norwegian phone number
 */
export function validateNorwegianPhone(phone: string): boolean {
  // Norwegian mobile numbers: +47 followed by 8 digits starting with 4 or 9
  // Norwegian landline: +47 followed by 8 digits
  const pattern = /^\+47[49]\d{7}$/;
  return pattern.test(phone);
}

/**
 * Send reschedule notification SMS
 * @param customerPhone - Customer phone number
 * @param salonName - Salon name
 * @param oldDate - Old appointment date (YYYY-MM-DD)
 * @param oldTime - Old appointment time (HH:MM)
 * @param newDate - New appointment date (YYYY-MM-DD)
 * @param newTime - New appointment time (HH:MM)
 * @param tenantId - Tenant ID for tenant-specific SMS settings
 */
export async function sendRescheduleSMS(
  customerPhone: string,
  salonName: string,
  oldDate: string,
  oldTime: string,
  newDate: string,
  newTime: string,
  tenantId?: string
): Promise<{ success: boolean; error?: string }> {
  const message = `Hei! Din time hos ${salonName} er endret:\n\nFra: ${oldDate} kl. ${oldTime}\nTil: ${newDate} kl. ${newTime}\n\nHvis dette ikke stemmer, vennligst kontakt oss.`;

  return await sendSMS({
    to: customerPhone,
    message,
    tenantId,
  });
}
