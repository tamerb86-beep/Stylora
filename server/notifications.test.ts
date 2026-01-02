import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { sendSMS, formatAppointmentReminder, validateNorwegianPhone } from "./sms";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-owner",
    email: "owner@stylora.no",
    name: "Test Owner",
    loginMethod: "email",
    role: "owner",
    tenantId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("SMS Service", () => {
  it("should send mock SMS successfully", async () => {
    const result = await sendSMS({
      to: "+4712345678",
      message: "Test message",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.messageId).toContain("mock_");
  });

  it("should reject invalid phone number format", async () => {
    const result = await sendSMS({
      to: "12345678", // Missing +47 prefix
      message: "Test message",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("E.164 format");
  });

  it("should format appointment reminder correctly", () => {
    const message = formatAppointmentReminder({
      customerName: "John",
      salonName: "Test Salon",
      appointmentDate: new Date("2025-12-01"),
      appointmentTime: "14:00",
      serviceName: "Haircut",
    });

    expect(message).toContain("John");
    expect(message).toContain("Test Salon");
    expect(message).toContain("14:00");
    expect(message).toContain("Haircut");
  });

  it("should validate Norwegian phone numbers", () => {
    expect(validateNorwegianPhone("+4741234567")).toBe(true); // Mobile starting with 4
    expect(validateNorwegianPhone("+4798765432")).toBe(true); // Mobile starting with 9
    expect(validateNorwegianPhone("+4712345678")).toBe(false); // Landline (starts with 1)
    expect(validateNorwegianPhone("12345678")).toBe(false); // Missing country code
    expect(validateNorwegianPhone("+4612345678")).toBe(false); // Sweden
  });
});

describe("Notifications API", () => {
  it("should list notifications for tenant", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const notifications = await caller.notifications.list({
      limit: 10,
    });

    expect(Array.isArray(notifications)).toBe(true);
  });

  it("should filter notifications by status", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const sentNotifications = await caller.notifications.list({
      limit: 10,
      status: "sent",
    });

    expect(Array.isArray(sentNotifications)).toBe(true);
    // All returned notifications should have status "sent"
    sentNotifications.forEach(notification => {
      expect(notification.status).toBe("sent");
    });
  });

  it("should trigger reminder check manually", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.notifications.triggerReminders();

    expect(result).toBeDefined();
    expect(typeof result.processed).toBe("number");
    expect(typeof result.sent).toBe("number");
    expect(typeof result.failed).toBe("number");
  });
});

describe("Notification Scheduler", () => {
  it("should process reminders without errors", async () => {
    const { processAppointmentReminders } = await import("./notificationScheduler");
    
    const result = await processAppointmentReminders();

    expect(result).toBeDefined();
    expect(result.processed).toBeGreaterThanOrEqual(0);
    expect(result.sent).toBeGreaterThanOrEqual(0);
    expect(result.failed).toBeGreaterThanOrEqual(0);
  });
});
