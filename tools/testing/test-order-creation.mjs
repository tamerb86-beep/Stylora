// Test order creation with proper date formatting
import { config } from 'dotenv';
config();

const testOrderDate = new Date();
const formattedDate = testOrderDate.toISOString().split('T')[0];
const formattedTime = testOrderDate.toTimeString().split(' ')[0].substring(0, 5);

console.log('Testing order date formatting:');
console.log('Original Date:', testOrderDate);
console.log('Formatted Date (YYYY-MM-DD):', formattedDate);
console.log('Formatted Time (HH:MM):', formattedTime);
console.log('');
console.log('Expected format for MySQL:');
console.log('  orderDate: DATE column expects "YYYY-MM-DD" string');
console.log('  orderTime: TIME column expects "HH:MM:SS" or "HH:MM" string');
