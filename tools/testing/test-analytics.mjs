import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

console.log('Testing customerGrowth query...');
try {
  const startDate = new Date('2025-11-09');
  const endDate = new Date('2025-12-09');
  
  const result = await db.execute(
    sql`SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as count 
        FROM customers 
        WHERE tenantId = '1' 
          AND createdAt >= ${startDate} 
          AND createdAt <= ${endDate}
        GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
        ORDER BY DATE_FORMAT(createdAt, '%Y-%m-%d')
        LIMIT 5`
  );
  
  console.log('Success! Results:', result);
} catch (error) {
  console.error('Error:', error.message);
}

await connection.end();
