import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const result = await connection.query(`
  SELECT a.id, a.employeeId, a.appointmentDate, a.startTime, a.endTime, a.status, 
         c.name as customerName, e.name as employeeName
  FROM appointments a
  LEFT JOIN customers c ON a.customerId = c.id
  LEFT JOIN employees e ON a.employeeId = e.id
  WHERE a.appointmentDate = '2025-12-08'
  ORDER BY a.startTime
`);

console.log(JSON.stringify(result[0], null, 2));
await connection.end();
