/**
 * Notification Scheduler
 * 
 * Checks for upcoming appointments and sends SMS reminders 24 hours before.
 * Runs as a background job every hour.
 */

import { getDb } from "./db";
import { sendSMS, formatAppointmentReminder } from "./sms";
import { appointments, customers, notifications, users, tenants } from "../drizzle/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

/**
 * Check for appointments that need reminders and send SMS
 */
export async function processAppointmentReminders(): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const db = await getDb();
  if (!db) {
    console.error("[Scheduler] Database not available");
    return { processed: 0, sent: 0, failed: 0 };
  }

  console.log(`[Scheduler] Checking for appointment reminders at ${new Date().toISOString()}`);

  // Calculate time window: 24 hours from now (+/- 1 hour for scheduling tolerance)
  const now = new Date();
  const reminderStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23 hours
  const reminderEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25 hours

  try {
    // Find appointments in the reminder window that haven't been reminded yet
    const upcomingAppointments = await db
      .select({
        appointment: appointments,
        customer: customers,
        employee: users,
      })
      .from(appointments)
      .innerJoin(customers, eq(appointments.customerId, customers.id))
      .innerJoin(users, eq(appointments.employeeId, users.id))
      .where(
        and(
          // Appointment is in the reminder window
          gte(appointments.appointmentDate, reminderStart),
          lte(appointments.appointmentDate, reminderEnd),
          // Appointment is confirmed or pending (not canceled/completed)
          sql`${appointments.status} IN ('confirmed', 'pending')`,
          // Customer has a phone number
          sql`${customers.phone} IS NOT NULL AND ${customers.phone} != ''`
        )
      );

    console.log(`[Scheduler] Found ${upcomingAppointments.length} appointments to process`);

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const record of upcomingAppointments) {
      const { appointment, customer } = record;
      processed++;

      // Check if reminder was already sent
      // We check by recipientId (customer) and scheduledAt within 24h window
      const existingNotification = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, appointment.tenantId),
            eq(notifications.recipientId, customer.id),
            eq(notifications.notificationType, "sms"),
            eq(notifications.template, "appointment_reminder_24h"),
            eq(notifications.status, "sent"),
            gte(notifications.scheduledAt, reminderStart),
            lte(notifications.scheduledAt, reminderEnd)
          )
        )
        .limit(1);

      if (existingNotification.length > 0) {
        console.log(`[Scheduler] Reminder already sent for appointment #${appointment.id}`);
        continue;
      }

      // Get tenant/salon name
      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, appointment.tenantId))
        .limit(1);

      const salonName = tenant[0]?.name || "Stylora";

      // Format reminder message
      const message = formatAppointmentReminder({
        customerName: customer.firstName,
        salonName,
        appointmentDate: new Date(appointment.appointmentDate),
        appointmentTime: appointment.startTime,
      });

      // Send SMS with tenant-specific settings
      const result = await sendSMS({
        to: customer.phone,
        message,
        tenantId: appointment.tenantId,
      });

      // Record notification attempt
      await db.insert(notifications).values({
        tenantId: appointment.tenantId,
        recipientType: "customer",
        recipientId: customer.id,
        notificationType: "sms",
        template: "appointment_reminder_24h",
        recipientContact: customer.phone,
        subject: "Appointment Reminder",
        content: message,
        status: result.success ? "sent" : "failed",
        scheduledAt: new Date(),
        sentAt: result.success ? new Date() : null,
        errorMessage: result.error || null,
        attempts: 1,
      });

      if (result.success) {
        sent++;
        console.log(`[Scheduler] ✅ Sent reminder to ${customer.firstName} (${customer.phone}) for appointment #${appointment.id}`);
      } else {
        failed++;
        console.error(`[Scheduler] ❌ Failed to send reminder for appointment #${appointment.id}: ${result.error}`);
      }
    }

    console.log(`[Scheduler] Completed: ${processed} processed, ${sent} sent, ${failed} failed`);

    return { processed, sent, failed };
  } catch (error) {
    console.error("[Scheduler] Error processing reminders:", error);
    return { processed: 0, sent: 0, failed: 0 };
  }
}

/**
 * Start the notification scheduler
 * Runs every hour
 */
export function startNotificationScheduler() {
  console.log("[Scheduler] Starting notification scheduler...");

  // Run immediately on startup
  processAppointmentReminders().catch((error) => {
    console.error("[Scheduler] Error in initial run:", error);
  });

  // Then run every hour
  const intervalMs = 60 * 60 * 1000; // 1 hour
  setInterval(() => {
    processAppointmentReminders().catch((error) => {
      console.error("[Scheduler] Error in scheduled run:", error);
    });
  }, intervalMs);

  console.log(`[Scheduler] Scheduler started, will run every ${intervalMs / 1000 / 60} minutes`);
}

/**
 * Manually trigger reminder check (for testing or manual runs)
 */
export async function triggerReminderCheck(): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  console.log("[Scheduler] Manual trigger requested");
  return processAppointmentReminders();
}
