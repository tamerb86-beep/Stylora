import { getDb } from "./db";
import { databaseBackups } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Create a full database backup
 * Exports all tables to SQL and returns the SQL content for direct download
 */
export async function createDatabaseBackup(tenantId: string, userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const backupId = await db.insert(databaseBackups).values({
    tenantId,
    backupType: userId ? "manual" : "full",
    fileKey: "", // Not used for direct download
    status: "in_progress",
    createdBy: userId,
  });

  const insertedId = Array.isArray(backupId) ? backupId[0]?.insertId : (backupId as any).insertId;

  try {
    // Generate SQL dump
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `backup-${tenantId}-${timestamp}.sql`;
    
    // Export database structure and data
    const sqlDump = await exportDatabaseToSQL(tenantId);
    const fileSize = Buffer.byteLength(sqlDump, "utf-8");

    // Update backup record with success
    await db.update(databaseBackups)
      .set({
        fileKey: fileName, // Store filename for reference
        fileSize,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(databaseBackups.id, Number(insertedId)));

    return {
      success: true,
      backupId: Number(insertedId),
      fileName,
      sqlContent: sqlDump, // Return SQL content for direct download
      size: fileSize,
    };
  } catch (error: any) {
    // Mark backup as failed
    await db.update(databaseBackups)
      .set({
        status: "failed",
        errorMessage: error.message || "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(databaseBackups.id, Number(insertedId)));

    throw error;
  }
}

/**
 * Export database to SQL format
 * Creates INSERT statements for all tenant data
 */
async function exportDatabaseToSQL(tenantId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  let sql = `-- Stylora Database Backup\n`;
  sql += `-- Tenant: ${tenantId}\n`;
  sql += `-- Date: ${new Date().toISOString()}\n\n`;
  sql += `SET FOREIGN_KEY_CHECKS=0;\n\n`;

  // List of tables to backup (in order to respect foreign keys)
  const tables = [
    "tenants",
    "users",
    "services",
    "serviceCategories",
    "products",
    "productCategories",
    "customers",
    "appointments",
    "appointmentServices",
    "orders",
    "orderItems",
    "payments",
    "refunds",
    "timeClockEntries",
    "commissions",
    "loyaltyPrograms",
    "loyaltyTransactions",
    "loyaltyRewards",
    "loyaltyRedemptions",
    "walkInQueue",
    "employeeLeaves",
    "salonHolidays",
    "notifications",
    "expenses",
    "salonSettings",
    "paymentSettings",
  ];

  for (const tableName of tables) {
    try {
      // Get table data
      const result: any = await db.execute(`SELECT * FROM ${tableName} WHERE tenantId = '${tenantId}'`);
      const rows = Array.isArray(result) ? result : [];
      
      if (rows.length === 0) continue;

      sql += `-- Table: ${tableName}\n`;
      sql += `DELETE FROM ${tableName} WHERE tenantId = '${tenantId}';\n`;

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = (row as any)[col];
          if (val === null) return "NULL";
          if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === "boolean") return val ? "1" : "0";
          return String(val);
        });

        sql += `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
      }

      sql += `\n`;
    } catch (error) {
      console.error(`Error backing up table ${tableName}:`, error);
      // Continue with other tables
    }
  }

  sql += `SET FOREIGN_KEY_CHECKS=1;\n`;
  return sql;
}

/**
 * List all backups for a tenant
 */
export async function listBackups(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const backups = await db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.tenantId, tenantId))
    .orderBy(desc(databaseBackups.createdAt))
    .limit(50);

  return backups;
}

/**
 * Delete old backups (retention policy)
 * Keeps only the last N backups
 */
export async function deleteOldBackups(tenantId: string, keepCount: number = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const allBackups = await db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.tenantId, tenantId))
    .orderBy(desc(databaseBackups.createdAt));

  if (allBackups.length <= keepCount) {
    return { deleted: 0 };
  }

  const backupsToDelete = allBackups.slice(keepCount);
  let deleted = 0;

  for (const backup of backupsToDelete) {
    try {
      await db.delete(databaseBackups).where(eq(databaseBackups.id, backup.id));
      deleted++;
    } catch (error) {
      console.error(`Error deleting backup ${backup.id}:`, error);
    }
  }

  return { deleted };
}

/**
 * Get backup details by ID
 */
export async function getBackupById(backupId: number, tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const backup = await db
    .select()
    .from(databaseBackups)
    .where(eq(databaseBackups.id, backupId))
    .limit(1);

  if (backup.length === 0 || backup[0].tenantId !== tenantId) {
    return null;
  }

  return backup[0];
}

/**
 * Delete a specific backup
 */
export async function deleteBackup(backupId: number, tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const backup = await getBackupById(backupId, tenantId);
  if (!backup) {
    throw new Error("Backup not found");
  }

  await db.delete(databaseBackups).where(eq(databaseBackups.id, backupId));
  
  return { success: true };
}

/**
 * Re-generate SQL content for an existing backup
 * Used when user wants to download an old backup
 */
export async function regenerateBackupSQL(backupId: number, tenantId: string): Promise<string> {
  const backup = await getBackupById(backupId, tenantId);
  if (!backup) {
    throw new Error("Backup not found");
  }

  // Re-generate SQL from current database state
  // Note: This will reflect current data, not the data at backup time
  return exportDatabaseToSQL(tenantId);
}
