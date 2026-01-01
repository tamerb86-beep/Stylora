import { getAppointmentsByTenant } from './server/db.js';

const tenantId = 'goeasychargeco@gmail.com';
const startDate = new Date('2025-11-27');
const endDate = new Date('2026-01-27');

console.log('Start date:', startDate);
console.log('End date:', endDate);

const appointments = await getAppointmentsByTenant(tenantId, startDate, endDate);
console.log('Appointments found:', appointments.length);
console.log(JSON.stringify(appointments, null, 2));
