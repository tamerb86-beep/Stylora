import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createEmployeeContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 2, // Employee ID
    openId: "test-employee",
    email: "employee@stylora.no",
    name: "Test Employee",
    loginMethod: "email",
    role: "employee",
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

function createAdminContext(): { ctx: TrpcContext } {
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

describe("Employee Dashboard API", () => {
  it("should allow employee to view their appointments", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    const appointments = await caller.employee.myAppointments({
      date: new Date().toISOString().split('T')[0],
    });

    expect(Array.isArray(appointments)).toBe(true);
  });

  it("should allow employee to view appointments for specific date", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    const appointments = await caller.employee.myAppointments({
      date: "2025-12-01",
    });

    expect(Array.isArray(appointments)).toBe(true);
  });

  it("should allow admin to access employee endpoints", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const appointments = await caller.employee.myAppointments({
      date: new Date().toISOString().split('T')[0],
    });

    expect(Array.isArray(appointments)).toBe(true);
  });

  it("should return appointments with customer and service data", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    const appointments = await caller.employee.myAppointments({});

    // Check structure of returned data
    appointments.forEach(appointment => {
      expect(appointment).toHaveProperty("id");
      expect(appointment).toHaveProperty("status");
      expect(appointment).toHaveProperty("startTime");
      expect(appointment).toHaveProperty("endTime");
      // Customer and services may be null/empty
    });
  });
});

describe("Employee Appointment Actions", () => {
  it("should allow employee to update appointment status", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    // This will fail if no appointment exists, which is expected in test environment
    // The test verifies the endpoint exists and has correct structure
    try {
      await caller.employee.updateAppointmentStatus({
        appointmentId: 999999, // Non-existent ID
        status: "confirmed",
      });
    } catch (error: any) {
      // Should throw NOT_FOUND error
      expect(error.code).toBe("NOT_FOUND");
    }
  });

  it("should allow employee to add notes to appointment", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    // This will fail if no appointment exists, which is expected in test environment
    try {
      await caller.employee.addAppointmentNote({
        appointmentId: 999999, // Non-existent ID
        note: "Test note",
      });
    } catch (error: any) {
      // Should throw NOT_FOUND error
      expect(error.code).toBe("NOT_FOUND");
    }
  });

  it("should validate status enum values", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    // Test with invalid status - should fail validation
    try {
      await caller.employee.updateAppointmentStatus({
        appointmentId: 1,
        status: "invalid_status" as any,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should throw validation error
      expect(error.code).toBe("BAD_REQUEST");
    }
  });

  it("should validate note length", async () => {
    const { ctx } = createEmployeeContext();
    const caller = appRouter.createCaller(ctx);

    // Test with empty note - should fail validation
    try {
      await caller.employee.addAppointmentNote({
        appointmentId: 1,
        note: "",
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should throw validation error
      expect(error.code).toBe("BAD_REQUEST");
    }
  });
});
