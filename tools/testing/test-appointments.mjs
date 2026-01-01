import { drizzle } from "drizzle-orm/mysql2";
import { appointments } from "./drizzle/schema.js";
import { and, sql, eq } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

// Get appointments for Dec 1-7, 2025
const startDateStr = '2025-12-01';
const endDateStr = '2025-12-07';

const results = await db.select().from(appointments).where(
  and(
    sql`${appointments.appointmentDate} >= ${startDateStr}`,
    sql`${appointments.appointmentDate} <= ${endDateStr}`
  )
);

console.log('=== Appointments for Dec 1-7, 2025 ===');
console.log('Total:', results.length);
console.log('\nSample appointments:');
results.slice(0, 5).forEach(apt => {
  console.log({
    id: apt.id,
    date: apt.appointmentDate,
    startTime: apt.startTime,
    endTime: apt.endTime,
    employeeId: apt.employeeId,
    customerId: apt.customerId,
  });
});

process.exit(0);
