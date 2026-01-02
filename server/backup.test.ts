import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDatabaseBackup, listBackups, deleteBackup, regenerateBackupSQL } from "./backup";
import { getDb } from "./db";
import { tenants, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

describe("Backup System", () => {
  let testTenantId: string;
  let testUserId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");

    // Create test tenant
    const tenantResult = await db.insert(tenants).values({
      id: `test-backup-tenant-${Date.now()}`,
      name: "Test Backup Salon",
      subdomain: `test-backup-${Date.now()}`,
      status: "active",
      plan: "premium",
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    testTenantId = `test-backup-tenant-${Date.now()}`;

    // Create test user
    const userResult = await db.insert(users).values({
      tenantId: testTenantId,
      openId: `test-backup-openid-${Date.now()}`,
      name: "Test Admin",
      email: `admin-backup-${Date.now()}@test.com`,
      role: "admin",
      passwordHash: await bcrypt.hash("test123", 10),
      isActive: true,
    });

    const insertedId = Array.isArray(userResult) ? userResult[0]?.insertId : (userResult as any).insertId;
    testUserId = Number(insertedId);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    // Clean up test data
    try {
      await db.delete(users).where(eq(users.tenantId, testTenantId));
      await db.delete(tenants).where(eq(tenants.id, testTenantId));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });

  it("should create a database backup", async () => {
    const result = await createDatabaseBackup(testTenantId, testUserId);

    expect(result.success).toBe(true);
    expect(result.backupId).toBeGreaterThan(0);
    expect(result.fileName).toContain("backup-");
    expect(result.fileName).toContain(".sql");
    expect(result.sqlContent).toContain("-- Stylora Database Backup");
    expect(result.sqlContent).toContain(`-- Tenant: ${testTenantId}`);
    expect(result.size).toBeGreaterThan(0);
  });

  it("should list all backups for tenant", async () => {
    const backups = await listBackups(testTenantId);

    expect(Array.isArray(backups)).toBe(true);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0]).toHaveProperty("id");
    expect(backups[0]).toHaveProperty("tenantId");
    expect(backups[0]).toHaveProperty("status");
    expect(backups[0].tenantId).toBe(testTenantId);
  });

  it("should regenerate SQL for existing backup", async () => {
    const backups = await listBackups(testTenantId);
    const firstBackup = backups[0];

    const sqlContent = await regenerateBackupSQL(firstBackup.id, testTenantId);

    expect(sqlContent).toContain("-- Stylora Database Backup");
    expect(sqlContent).toContain(`-- Tenant: ${testTenantId}`);
    expect(sqlContent).toContain("SET FOREIGN_KEY_CHECKS=0");
    expect(sqlContent).toContain("SET FOREIGN_KEY_CHECKS=1");
  });

  it("should delete a backup", async () => {
    // Create a backup to delete
    const createResult = await createDatabaseBackup(testTenantId, testUserId);
    const backupId = createResult.backupId;

    // Delete it
    const deleteResult = await deleteBackup(backupId, testTenantId);

    expect(deleteResult.success).toBe(true);

    // Verify it's deleted
    const backups = await listBackups(testTenantId);
    const deletedBackup = backups.find(b => b.id === backupId);
    expect(deletedBackup).toBeUndefined();
  });

  it("should fail to delete backup from different tenant", async () => {
    const backups = await listBackups(testTenantId);
    const firstBackup = backups[0];

    await expect(
      deleteBackup(firstBackup.id, "different-tenant-id")
    ).rejects.toThrow("Backup not found");
  });

  it("should fail to regenerate SQL for non-existent backup", async () => {
    await expect(
      regenerateBackupSQL(999999, testTenantId)
    ).rejects.toThrow("Backup not found");
  });
});
