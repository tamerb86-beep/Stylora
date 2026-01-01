import * as db from "./server/db.ts";

const dbInstance = await db.getDb();
const { orders } = await import("./drizzle/schema.ts");
const { desc } = await import("drizzle-orm");

const allOrders = await dbInstance.select().from(orders).orderBy(desc(orders.orderDate)).limit(10);

console.log("Recent orders:");
allOrders.forEach(order => {
  console.log(`ID: ${order.id}, Date: ${order.orderDate}, Status: ${order.status}, Total: ${order.total}`);
});

process.exit(0);
