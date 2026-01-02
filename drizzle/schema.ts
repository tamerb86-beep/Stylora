import {
  bigint,
  int, 
  mysqlEnum, 
  mysqlTable, 
  text, 
  timestamp,
  datetime,
  varchar,
  decimal,
  boolean,
  date,
  time,
  json,
  index,
  unique,
  uniqueIndex
} from "drizzle-orm/mysql-core";

/**
 * Stylora SaaS Database Schema
 * Multi-tenant architecture with row-based isolation
 */

// ============================================================================
// TENANTS & IDENTITY
// ============================================================================

export const tenants = mysqlTable("tenants", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  name: varchar("name", { length: 255 }).notNull(),
  subdomain: varchar("subdomain", { length: 63 }).notNull().unique(),
  orgNumber: varchar("orgNumber", { length: 9 }), // Norwegian org number
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  logoUrl: text("logoUrl"),
  primaryColor: varchar("primaryColor", { length: 7 }), // Hex color
  timezone: varchar("timezone", { length: 50 }).default("Europe/Oslo"),
  currency: varchar("currency", { length: 3 }).default("NOK"),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("25.00"),
  status: mysqlEnum("status", ["trial", "active", "suspended", "canceled"]).default("trial"),
  trialEndsAt: timestamp("trialEndsAt"),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  // Onboarding Wizard
  onboardingCompleted: boolean("onboardingCompleted").default(false).notNull(),
  onboardingStep: mysqlEnum("onboardingStep", ["welcome", "service", "employee", "hours", "complete"]).default("welcome"),
  onboardingCompletedAt: timestamp("onboardingCompletedAt"),
  wizardDraftData: json("wizardDraftData"), // Auto-saved wizard form data
  // Cancellation & No-Show Policy
  cancellationWindowHours: int("cancellationWindowHours").default(24), // hours before appointment
  noShowThresholdForPrepayment: int("noShowThresholdForPrepayment").default(2), // max no-shows before requiring prepayment
  requirePrepayment: boolean("requirePrepayment").default(false).notNull(), // require payment for all new bookings
  // SMS Configuration (per-tenant)
  smsPhoneNumber: varchar("smsPhoneNumber", { length: 20 }), // Tenant's SMS sender number
  smsProvider: mysqlEnum("smsProvider", ["mock", "pswincom", "linkmobility", "twilio"]), // SMS provider choice
  smsApiKey: varchar("smsApiKey", { length: 255 }), // API key for SMS provider
  smsApiSecret: varchar("smsApiSecret", { length: 255 }), // API secret for SMS provider
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  subdomainIdx: index("subdomain_idx").on(table.subdomain),
  statusIdx: index("status_idx").on(table.status),
}));

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }),
  name: text("name"),
  phone: varchar("phone", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["owner", "admin", "employee"]).notNull(),
  pin: varchar("pin", { length: 6 }), // 4-6 digit PIN for time clock
  passwordHash: varchar("passwordHash", { length: 255 }), // bcrypt hashed password for email/password login
  isActive: boolean("isActive").default(true),
  deactivatedAt: timestamp("deactivatedAt"),
  commissionType: mysqlEnum("commissionType", ["percentage", "fixed", "tiered"]).default("percentage"),
  commissionRate: decimal("commissionRate", { precision: 5, scale: 2 }), // e.g., 40.00 for 40%
  // Leave Management
  annualLeaveTotal: int("annualLeaveTotal").default(25), // Total annual leave days per year (Norwegian standard: 25 days)
  annualLeaveUsed: int("annualLeaveUsed").default(0), // Annual leave days used this year
  sickLeaveUsed: int("sickLeaveUsed").default(0), // Sick leave days used this year
  // UI Preferences
  uiMode: mysqlEnum("uiMode", ["simple", "advanced"]).default("simple"), // UI complexity mode
  sidebarOpen: boolean("sidebarOpen").default(false), // Sidebar open/closed state
  onboardingCompleted: boolean("onboardingCompleted").default(false), // Whether user completed onboarding tour
  onboardingStep: int("onboardingStep").default(0), // Current onboarding step (0 = not started)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => ({
  tenantUsersIdx: index("tenant_users_idx").on(table.tenantId, table.isActive),
  openIdIdx: index("open_id_idx").on(table.openId),
}));

// ============================================================================
// REFRESH TOKENS (for automatic session renewal)
// ============================================================================

export const refreshTokens = mysqlTable("refreshTokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  userId: int("userId").notNull(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: varchar("userAgent", { length: 500 }),
  revoked: boolean("revoked").default(false).notNull(),
  revokedAt: timestamp("revokedAt"),
  revokedReason: varchar("revokedReason", { length: 255 }),
}, (table) => ({
  tokenIdx: uniqueIndex("token_idx").on(table.token),
  userIdIdx: index("user_id_idx").on(table.userId),
  tenantIdIdx: index("tenant_id_idx").on(table.tenantId),
  expiresAtIdx: index("expires_at_idx").on(table.expiresAt),
}));

// ============================================================================
// CUSTOMERS
// ============================================================================

export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }),
  dateOfBirth: date("dateOfBirth"),
  address: text("address"),
  notes: text("notes"), // Allergies, preferences
  marketingSmsConsent: boolean("marketingSmsConsent").default(false),
  marketingEmailConsent: boolean("marketingEmailConsent").default(false),
  consentTimestamp: timestamp("consentTimestamp"),
  consentIp: varchar("consentIp", { length: 45 }),
  preferredEmployeeId: int("preferredEmployeeId"),
  totalVisits: int("totalVisits").default(0),
  totalRevenue: decimal("totalRevenue", { precision: 10, scale: 2 }).default("0.00"),
  lastVisitDate: date("lastVisitDate"),
  noShowCount: int("noShowCount").default(0),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantCustomersIdx: index("tenant_customers_idx").on(table.tenantId, table.deletedAt),
  phoneIdx: index("phone_idx").on(table.tenantId, table.phone),
  emailIdx: index("email_idx").on(table.tenantId, table.email),
}));

// ============================================================================
// SERVICES
// ============================================================================

export const serviceCategories = mysqlTable("serviceCategories", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  displayOrder: int("displayOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCategoriesIdx: index("tenant_categories_idx").on(table.tenantId),
}));

export const services = mysqlTable("services", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  categoryId: int("categoryId"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  durationMinutes: int("durationMinutes").notNull(), // e.g., 30 for 30-minute service
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("25.00"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantServicesIdx: index("tenant_services_idx").on(table.tenantId, table.isActive),
}));

// ============================================================================
// APPOINTMENTS
// ============================================================================

export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  employeeId: int("employeeId").notNull(),
  appointmentDate: date("appointmentDate").notNull(),
  startTime: time("startTime").notNull(),
  endTime: time("endTime").notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "completed", "canceled", "no_show"]).default("pending"),
  cancellationReason: text("cancellationReason"),
  canceledBy: mysqlEnum("canceledBy", ["customer", "staff", "system"]),
  canceledAt: timestamp("canceledAt"),
  isLateCancellation: boolean("isLateCancellation").default(false), // true if canceled inside cancellation window
  managementToken: varchar("managementToken", { length: 64 }).unique(), // Unique token for customer to manage booking
  notes: text("notes"),
  recurrenceRuleId: int("recurrenceRuleId"),
  rescheduleCount: int("rescheduleCount").default(0).notNull(), // Track number of times rescheduled
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantAppointmentsIdx: index("tenant_appointments_idx").on(table.tenantId, table.appointmentDate, table.employeeId),
  customerAppointmentsIdx: index("customer_appointments_idx").on(table.customerId, table.appointmentDate),
  employeeScheduleIdx: index("employee_schedule_idx").on(table.employeeId, table.appointmentDate, table.startTime),
}));

export const appointmentServices = mysqlTable("appointmentServices", {
  id: int("id").autoincrement().primaryKey(),
  appointmentId: int("appointmentId").notNull(),
  serviceId: int("serviceId").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Price at time of booking
}, (table) => ({
  appointmentIdx: index("appointment_idx").on(table.appointmentId),
}));

export const recurrenceRules = mysqlTable("recurrenceRules", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  employeeId: int("employeeId").notNull(),
  serviceId: int("serviceId").notNull(),
  frequency: mysqlEnum("frequency", ["weekly", "biweekly", "monthly"]).notNull(),
  preferredDayOfWeek: int("preferredDayOfWeek"), // 0-6
  preferredTime: time("preferredTime"),
  startDate: date("startDate").notNull(),
  endDate: date("endDate"),
  maxOccurrences: int("maxOccurrences"),
  currentOccurrences: int("currentOccurrences").default(0),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantRecurrencesIdx: index("tenant_recurrences_idx").on(table.tenantId, table.isActive),
}));

// ============================================================================
// PRODUCTS & INVENTORY
// ============================================================================

export const productCategories = mysqlTable("productCategories", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  displayOrder: int("displayOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCategoriesIdx: index("tenant_categories_idx").on(table.tenantId),
}));

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  categoryId: int("categoryId"),
  sku: varchar("sku", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  costPrice: decimal("costPrice", { precision: 10, scale: 2 }).notNull(),
  retailPrice: decimal("retailPrice", { precision: 10, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("25.00"),
  barcode: varchar("barcode", { length: 50 }),
  supplier: varchar("supplier", { length: 255 }),
  stockQuantity: int("stockQuantity").default(0),
  reorderPoint: int("reorderPoint").default(10),
  reorderQuantity: int("reorderQuantity").default(20),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantProductsIdx: index("tenant_products_idx").on(table.tenantId, table.isActive),
  skuIdx: unique("sku_idx").on(table.sku),
  lowStockIdx: index("low_stock_idx").on(table.tenantId, table.stockQuantity),
}));

// ============================================================================
// ORDERS & SALES
// ============================================================================

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId"), // Nullable
  employeeId: int("employeeId"), // Nullable in DB
  appointmentId: int("appointmentId"), // Nullable
  orderDate: date("orderDate", { mode: "string" }).notNull(),
  orderTime: time("orderTime").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  vatAmount: decimal("vatAmount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  status: mysqlEnum("status", ["pending", "completed", "refunded", "partially_refunded"]).notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => ({
  tenantOrdersIdx: index("tenant_orders_idx").on(table.tenantId, table.orderDate),
  employeeSalesIdx: index("employee_sales_idx").on(table.employeeId, table.orderDate),
}));

export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  itemType: mysqlEnum("itemType", ["service", "product"]).notNull(),
  itemId: int("itemId").notNull(),
  itemName: varchar("itemName", { length: 255 }).notNull().default("Unknown Item"),
  quantity: int("quantity").notNull().default(1),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull().default("25.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
}, (table) => ({
  orderIdx: index("order_idx").on(table.orderId),
}));


// ============================================================================
// PAYMENTS
// ============================================================================

export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  orderId: int("orderId"),
  appointmentId: int("appointmentId"),
  paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "vipps", "stripe", "split"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NOK").notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  paymentGateway: varchar("paymentGateway", { length: 50 }),
  gatewayPaymentId: varchar("gatewayPaymentId", { length: 255 }),
  gatewaySessionId: varchar("gatewaySessionId", { length: 255 }),
  gatewayMetadata: json("gatewayMetadata"),
  cardLast4: varchar("cardLast4", { length: 4 }),
  cardBrand: varchar("cardBrand", { length: 50 }),
  paidAt: timestamp("paidAt"),
  refundedAt: timestamp("refundedAt"),
  refundAmount: decimal("refundAmount", { precision: 10, scale: 2 }),
  refundReason: text("refundReason"),
  notes: text("notes"),
  errorMessage: text("errorMessage"),
  processedAt: timestamp("processedAt"),
  processedBy: int("processedBy"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
}, (table) => ({
  tenantPaymentsIdx: index("tenant_payments_idx").on(table.tenantId, table.createdAt),
  gatewayPaymentIdx: index("gateway_payment_idx").on(table.gatewayPaymentId),
  appointmentPaymentIdx: index("appointment_payment_idx").on(table.appointmentId),
  orderPaymentIdx: index("order_payment_idx").on(table.orderId),
  statusIdx: index("status_idx").on(table.status),
}));



export const refunds = mysqlTable("refunds", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  paymentId: int("paymentId").notNull(),
  orderId: int("orderId"),
  appointmentId: int("appointmentId"), // Link to appointment if applicable
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  refundMethod: mysqlEnum("refundMethod", ["stripe", "vipps", "manual"]).notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed"]).default("pending").notNull(),
  gatewayRefundId: varchar("gatewayRefundId", { length: 255 }), // Stripe Refund ID or Vipps Refund ID
  errorMessage: text("errorMessage"),
  processedBy: int("processedBy").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantRefundsIdx: index("tenant_refunds_idx").on(table.tenantId),
  paymentIdx: index("payment_idx").on(table.paymentId),
  orderIdx: index("order_idx").on(table.orderId),
  appointmentIdx: index("appointment_idx").on(table.appointmentId),
}));

// ============================================================================
// LEAVE & HOLIDAY MANAGEMENT
// ============================================================================

export const employeeLeaves = mysqlTable("employeeLeaves", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  employeeId: int("employeeId").notNull(),
  leaveType: mysqlEnum("leaveType", ["annual", "sick", "emergency", "unpaid"]).notNull(),
  startDate: date("startDate").notNull(),
  endDate: date("endDate").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reason: text("reason"),
  approvedBy: int("approvedBy"), // User ID who approved/rejected
  approvedAt: timestamp("approvedAt"),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantLeavesIdx: index("tenant_leaves_idx").on(table.tenantId, table.status),
  employeeLeavesIdx: index("employee_leaves_idx").on(table.employeeId, table.startDate),
}));

export const salonHolidays = mysqlTable("salonHolidays", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(), // e.g., "Eid al-Fitr", "Christmas"
  date: date("date").notNull(),
  isRecurring: boolean("isRecurring").default(false), // If true, repeats every year
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantHolidaysIdx: index("tenant_holidays_idx").on(table.tenantId, table.date),
}));

export const databaseBackups = mysqlTable("databaseBackups", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  backupType: mysqlEnum("backupType", ["full", "manual"]).default("full").notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(), // S3 file key
  fileSize: bigint("fileSize", { mode: "number" }), // File size in bytes
  status: mysqlEnum("status", ["in_progress", "completed", "failed"]).default("in_progress").notNull(),
  errorMessage: text("errorMessage"),
  createdBy: int("createdBy"), // User ID who triggered manual backup
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  tenantBackupsIdx: index("tenant_backups_idx").on(table.tenantId, table.createdAt),
}));

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  recipientType: mysqlEnum("recipientType", ["customer", "employee", "owner"]).notNull(),
  recipientId: int("recipientId").notNull(),
  notificationType: mysqlEnum("notificationType", ["sms", "email"]).notNull(),
  template: varchar("template", { length: 100 }), // e.g., 'appointment_reminder_24h'
  recipientContact: varchar("recipientContact", { length: 320 }).notNull(), // Phone or email
  subject: varchar("subject", { length: 255 }),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "delivered", "failed"]).default("pending"),
  attempts: int("attempts").default(0),
  maxAttempts: int("maxAttempts").default(3),
  errorMessage: text("errorMessage"),
  scheduledAt: timestamp("scheduledAt").notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantNotificationsIdx: index("tenant_notifications_idx").on(table.tenantId, table.status, table.scheduledAt),
  pendingIdx: index("pending_idx").on(table.status, table.scheduledAt),
}));

// ============================================================================
// COMMUNICATION SYSTEM
// ============================================================================

export const communicationTemplates = mysqlTable("communicationTemplates", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  type: mysqlEnum("type", ["sms", "email"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }), // For email only
  content: text("content").notNull(),
  variables: json("variables"), // Array of available variables like {customerName}, {appointmentDate}
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  tenantTemplatesIdx: index("tenant_templates_idx").on(table.tenantId, table.type),
}));

export const communicationSettings = mysqlTable("communicationSettings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull().unique(),
  // SMS Settings
  smsProvider: varchar("smsProvider", { length: 50 }), // e.g., 'twilio', 'link_mobility'
  smsApiKey: text("smsApiKey"),
  smsApiSecret: text("smsApiSecret"),
  smsSenderName: varchar("smsSenderName", { length: 11 }), // Max 11 chars for SMS sender
  smsEnabled: boolean("smsEnabled").default(false).notNull(),
  // Email Settings
  smtpHost: varchar("smtpHost", { length: 255 }),
  smtpPort: int("smtpPort"),
  smtpUser: varchar("smtpUser", { length: 255 }),
  smtpPassword: text("smtpPassword"),
  smtpSecure: boolean("smtpSecure").default(true).notNull(), // TLS/SSL
  emailFromAddress: varchar("emailFromAddress", { length: 320 }),
  emailFromName: varchar("emailFromName", { length: 255 }),
  emailEnabled: boolean("emailEnabled").default(false).notNull(),
  // Automation Settings
  autoReminderEnabled: boolean("autoReminderEnabled").default(false).notNull(),
  reminderHoursBefore: int("reminderHoursBefore").default(24),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const bulkCampaigns = mysqlTable("bulkCampaigns", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["sms", "email"]).notNull(),
  templateId: int("templateId"),
  subject: varchar("subject", { length: 255 }), // For email
  content: text("content").notNull(),
  status: mysqlEnum("status", ["draft", "scheduled", "sending", "completed", "failed"]).default("draft"),
  recipientCount: int("recipientCount").default(0),
  sentCount: int("sentCount").default(0),
  deliveredCount: int("deliveredCount").default(0),
  failedCount: int("failedCount").default(0),
  openedCount: int("openedCount").default(0), // For email
  clickedCount: int("clickedCount").default(0), // For email with links
  scheduledAt: timestamp("scheduledAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdBy: int("createdBy").notNull(), // User ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCampaignsIdx: index("tenant_campaigns_idx").on(table.tenantId, table.status, table.createdAt),
}));

export const campaignRecipients = mysqlTable("campaignRecipients", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  customerId: int("customerId").notNull(),
  recipientContact: varchar("recipientContact", { length: 320 }).notNull(), // Phone or email
  status: mysqlEnum("status", ["pending", "sent", "delivered", "failed", "opened", "clicked"]).default("pending"),
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  openedAt: timestamp("openedAt"), // For email tracking
  clickedAt: timestamp("clickedAt"), // For email link tracking
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  campaignRecipientsIdx: index("campaign_recipients_idx").on(table.campaignId, table.status),
  customerRecipientsIdx: index("customer_recipients_idx").on(table.customerId),
}));

// ============================================================================
// SYSTEM
// ============================================================================

export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  userId: int("userId"),
  action: varchar("action", { length: 100 }).notNull(), // e.g., 'customer_deleted', 'appointment_canceled'
  entityType: varchar("entityType", { length: 50 }).notNull(), // e.g., 'customer', 'appointment'
  entityId: int("entityId").notNull(),
  beforeValue: json("beforeValue"),
  afterValue: json("afterValue"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantLogsIdx: index("tenant_logs_idx").on(table.tenantId, table.createdAt),
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
}));

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  settingKey: varchar("settingKey", { length: 100 }).notNull(),
  settingValue: text("settingValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueTenantSetting: unique("unique_tenant_setting").on(table.tenantId, table.settingKey),
}));

export const businessHours = mysqlTable("businessHours", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  dayOfWeek: int("dayOfWeek").notNull(), // 0 = Sunday, 6 = Saturday
  isOpen: boolean("isOpen").default(true).notNull(),
  openTime: time("openTime"), // e.g., "09:00"
  closeTime: time("closeTime"), // e.g., "18:00"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueTenantDay: unique("unique_tenant_day").on(table.tenantId, table.dayOfWeek),
  tenantDayIdx: index("tenant_day_idx").on(table.tenantId, table.dayOfWeek),
}));

export const employeeSchedules = mysqlTable("employeeSchedules", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employeeId").notNull(),
  dayOfWeek: int("dayOfWeek").notNull(), // 0 = Sunday, 6 = Saturday
  startTime: time("startTime").notNull(),
  endTime: time("endTime").notNull(),
  breakStart: time("breakStart"),
  breakEnd: time("breakEnd"),
  isActive: boolean("isActive").default(true),
}, (table) => ({
  employeeScheduleIdx: index("employee_schedule_idx").on(table.employeeId, table.dayOfWeek),
}));

// ============================================================================
// SUBSCRIPTION & BILLING
// ============================================================================

export const subscriptionPlans = mysqlTable("subscriptionPlans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(), // 'Start', 'Pro', 'Premium'
  displayNameNo: varchar("displayNameNo", { length: 100 }).notNull(), // 'Start / Lite'
  priceMonthly: decimal("priceMonthly", { precision: 10, scale: 2 }).notNull(),
  maxEmployees: int("maxEmployees"),
  maxLocations: int("maxLocations"),
  smsQuota: int("smsQuota"),
  features: json("features"), // Array of feature flags
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const tenantSubscriptions = mysqlTable("tenantSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  planId: int("planId").notNull(),
  status: mysqlEnum("status", ["active", "past_due", "canceled", "paused"]).default("active"),
  currentPeriodStart: date("currentPeriodStart").notNull(),
  currentPeriodEnd: date("currentPeriodEnd").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantSubscriptionIdx: index("tenant_subscription_idx").on(table.tenantId),
  stripeSubscriptionIdx: index("stripe_subscription_idx").on(table.stripeSubscriptionId),
}));

// ============================================================================
// LOYALTY PROGRAM
// ============================================================================

export const loyaltyPoints = mysqlTable("loyaltyPoints", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  currentPoints: int("currentPoints").default(0).notNull(),
  lifetimePoints: int("lifetimePoints").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantCustomerIdx: index("tenant_customer_loyalty_idx").on(table.tenantId, table.customerId),
  customerUniqueIdx: uniqueIndex("customer_loyalty_unique_idx").on(table.tenantId, table.customerId),
}));

export const loyaltyTransactions = mysqlTable("loyaltyTransactions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  type: mysqlEnum("type", ["earn", "redeem", "adjustment", "expire"]).notNull(),
  points: int("points").notNull(), // Positive for earn, negative for redeem/expire
  reason: varchar("reason", { length: 500 }),
  referenceType: varchar("referenceType", { length: 50 }), // "appointment", "order", "manual", "reward"
  referenceId: int("referenceId"),
  performedBy: int("performedBy"), // User ID who performed the action
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCustomerIdx: index("tenant_customer_transactions_idx").on(table.tenantId, table.customerId),
  createdAtIdx: index("transactions_created_idx").on(table.createdAt),
}));

export const loyaltyRewards = mysqlTable("loyaltyRewards", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  pointsCost: int("pointsCost").notNull(),
  discountType: mysqlEnum("discountType", ["percentage", "fixed_amount"]).notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("isActive").default(true),
  validityDays: int("validityDays").default(30), // How long the reward is valid after redemption
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantRewardsIdx: index("tenant_rewards_idx").on(table.tenantId, table.isActive),
}));

export const loyaltyRedemptions = mysqlTable("loyaltyRedemptions", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(),
  rewardId: int("rewardId").notNull(),
  transactionId: int("transactionId"), // Link to loyalty transaction
  code: varchar("code", { length: 20 }).notNull().unique(), // Unique redemption code
  status: mysqlEnum("status", ["active", "used", "expired"]).default("active"),
  usedAt: timestamp("usedAt"),
  usedInAppointment: int("usedInAppointment"),
  usedInOrder: int("usedInOrder"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantCustomerIdx: index("tenant_customer_redemptions_idx").on(table.tenantId, table.customerId),
  statusIdx: index("redemptions_status_idx").on(table.status, table.expiresAt),
  codeIdx: uniqueIndex("redemption_code_idx").on(table.code),
}));

// ============================================================================
// EXPENSES
// ============================================================================

export const expenses = mysqlTable("expenses", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  category: mysqlEnum("category", [
    "rent",
    "utilities",
    "supplies",
    "salaries",
    "marketing",
    "maintenance",
    "insurance",
    "taxes",
    "other"
  ]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  expenseDate: date("expense_date").notNull(),
  receiptUrl: text("receipt_url"),
  createdBy: int("created_by").notNull(), // User ID who created the expense
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantIdx: index("expenses_tenant_idx").on(table.tenantId),
  dateIdx: index("expenses_date_idx").on(table.expenseDate),
  categoryIdx: index("expenses_category_idx").on(table.category),
}));

// ============================================================================
// TIME TRACKING
// ============================================================================

export const salonSettings = mysqlTable("salonSettings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull().unique(),
  bookingBranding: json("bookingBranding").$type<{
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    showStaffSection: boolean;
    showSummaryCard: boolean;
  }>(),
  printSettings: json("printSettings").$type<{
    fontSize: "small" | "medium" | "large";
    showLogo: boolean;
    customFooterText: string;
    autoPrintReceipt?: boolean;
    autoOpenCashDrawer?: boolean;
    orgNumber?: string;
    bankAccount?: string;
    website?: string;
    businessHours?: string;
  }>(),
  receiptLogoUrl: text("receiptLogoUrl"),
  // Time Clock Auto Clock-Out
  autoClockOutTime: time("autoClockOutTime").default("17:00"), // Default end of shift time for auto clock-out
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantIdx: index("salon_settings_tenant_idx").on(table.tenantId),
}));

export const timesheets = mysqlTable("timesheets", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  employeeId: int("employeeId").notNull(),
  clockIn: timestamp("clockIn").notNull(),
  clockOut: timestamp("clockOut"),
  totalHours: decimal("totalHours", { precision: 5, scale: 2 }), // Calculated on clock-out
  workDate: date("workDate").notNull(), // Date of the shift
  notes: text("notes"),
  editReason: text("editReason"), // Reason for manual edit/delete
  editedBy: int("editedBy"), // User ID who edited
  editedAt: timestamp("editedAt"), // When was it edited
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantEmployeeIdx: index("tenant_employee_timesheet_idx").on(table.tenantId, table.employeeId, table.workDate),
  workDateIdx: index("timesheet_work_date_idx").on(table.workDate),
}));

// ============================================================================
// UNIMICRO ACCOUNTING INTEGRATION
// ============================================================================

export const unimicroSettings = mysqlTable("unimicroSettings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  
  // OAuth Credentials
  clientId: text("clientId"),
  clientSecret: text("clientSecret"), // Encrypted
  certificatePath: text("certificatePath"),
  companyId: int("companyId"),
  
  // Tokens
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  
  // Sync Settings
  syncFrequency: mysqlEnum("syncFrequency", ["daily", "weekly", "monthly", "manual", "custom"]).default("daily").notNull(),
  syncDayOfWeek: int("syncDayOfWeek"), // 0-6 (0=Sunday)
  syncDayOfMonth: int("syncDayOfMonth"), // 1-31 or -1 for last day
  syncHour: int("syncHour").default(23).notNull(), // 0-23
  syncMinute: int("syncMinute").default(0).notNull(), // 0-59
  
  // Sync Status
  lastSyncAt: timestamp("lastSyncAt"),
  nextSyncAt: timestamp("nextSyncAt"),
  lastSyncStatus: mysqlEnum("lastSyncStatus", ["success", "failed", "partial"]),
  lastSyncErrors: text("lastSyncErrors"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantIdx: index("unimicro_settings_tenant_idx").on(table.tenantId),
}));

export const unimicroInvoiceMapping = mysqlTable("unimicroInvoiceMapping", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  orderId: int("orderId").notNull(), // Reference to orders table
  unimicroInvoiceId: int("unimicroInvoiceId").notNull(),
  unimicroInvoiceNumber: varchar("unimicroInvoiceNumber", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["pending", "synced", "failed", "paid"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantOrderIdx: index("unimicro_invoice_tenant_order_idx").on(table.tenantId, table.orderId),
  unimicroInvoiceIdx: index("unimicro_invoice_id_idx").on(table.unimicroInvoiceId),
  statusIdx: index("unimicro_invoice_status_idx").on(table.status),
}));

export const unimicroCustomerMapping = mysqlTable("unimicroCustomerMapping", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(), // Reference to customers table
  unimicroCustomerId: int("unimicroCustomerId").notNull(),
  status: mysqlEnum("status", ["synced", "failed"]).default("synced").notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantCustomerIdx: uniqueIndex("unimicro_customer_tenant_customer_idx").on(table.tenantId, table.customerId),
  unimicroCustomerIdx: index("unimicro_customer_id_idx").on(table.unimicroCustomerId),
}));

export const unimicroSyncLog = mysqlTable("unimicroSyncLog", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  operation: mysqlEnum("operation", ["invoice_sync", "customer_sync", "payment_sync", "full_sync", "test_connection"]).notNull(),
  status: mysqlEnum("status", ["success", "failed", "partial"]).notNull(),
  itemsProcessed: int("itemsProcessed").default(0),
  itemsFailed: int("itemsFailed").default(0),
  errorMessage: text("errorMessage"),
  details: json("details").$type<{
    invoiceIds?: number[];
    customerIds?: number[];
    errors?: Array<{ id: number; error: string }>;
  }>(),
  duration: int("duration"), // milliseconds
  triggeredBy: mysqlEnum("triggeredBy", ["scheduled", "manual", "api"]).default("scheduled").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantOperationIdx: index("unimicro_log_tenant_operation_idx").on(table.tenantId, table.operation, table.createdAt),
  statusIdx: index("unimicro_log_status_idx").on(table.status),
  createdAtIdx: index("unimicro_log_created_idx").on(table.createdAt),
}));

// ============================================================================
// WALK-IN QUEUE
// ============================================================================

export const walkInQueue = mysqlTable("walkInQueue", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerName: varchar("customerName", { length: 200 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 20 }),
  serviceId: int("serviceId").notNull(),
  employeeId: int("employeeId"), // Optional: preferred employee
  estimatedWaitMinutes: int("estimatedWaitMinutes").default(0),
  status: mysqlEnum("status", ["waiting", "in_service", "completed", "canceled"]).default("waiting").notNull(),
  priority: mysqlEnum("priority", ["normal", "urgent", "vip"]).default("normal").notNull(),
  priorityReason: text("priorityReason"),
  position: int("position").notNull(), // Queue position
  addedAt: timestamp("addedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  notes: text("notes"),
}, (table) => ({
  tenantQueueIdx: index("tenant_queue_idx").on(table.tenantId, table.status, table.position),
  statusIdx: index("queue_status_idx").on(table.status),
}));

// ============================================================================
// EMAIL VERIFICATION
// ============================================================================

export const emailVerifications = mysqlTable("emailVerifications", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantEmailIdx: index("tenant_email_idx").on(table.tenantId, table.email),
  tokenIdx: index("token_idx").on(table.token),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

export type Service = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export type Timesheet = typeof timesheets.$inferSelect;
export type InsertTimesheet = typeof timesheets.$inferInsert;

export type SalonSettings = typeof salonSettings.$inferSelect;
export type InsertSalonSettings = typeof salonSettings.$inferInsert;

export type WalkInQueue = typeof walkInQueue.$inferSelect;
export type InsertWalkInQueue = typeof walkInQueue.$inferInsert;

export type UnimicroSettings = typeof unimicroSettings.$inferSelect;
export type InsertUnimicroSettings = typeof unimicroSettings.$inferInsert;

export type UnimicroInvoiceMapping = typeof unimicroInvoiceMapping.$inferSelect;
export type InsertUnimicroInvoiceMapping = typeof unimicroInvoiceMapping.$inferInsert;

export type UnimicroCustomerMapping = typeof unimicroCustomerMapping.$inferSelect;
export type InsertUnimicroCustomerMapping = typeof unimicroCustomerMapping.$inferInsert;

export type UnimicroSyncLog = typeof unimicroSyncLog.$inferSelect;
export type InsertUnimicroSyncLog = typeof unimicroSyncLog.$inferInsert;


// ============================================================================
// PAYMENT TERMINAL SYSTEM
// ============================================================================

export const paymentProviders = mysqlTable("paymentProviders", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  providerType: mysqlEnum("providerType", ["izettle", "stripe_terminal", "vipps", "nets", "manual_card", "cash", "generic"]).notNull(),
  providerName: varchar("providerName", { length: 100 }).notNull(), // e.g., "Main Counter Terminal"
  isActive: boolean("isActive").default(true).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(), // Default provider for this type
  
  // OAuth fields (for iZettle, Vipps, etc.)
  accessToken: text("accessToken").notNull(), // OAuth access token (encrypted)
  refreshToken: text("refreshToken").notNull(), // OAuth refresh token (encrypted)
  tokenExpiresAt: datetime("tokenExpiresAt", { fsp: 3 }).notNull(), // When access token expires
  providerAccountId: varchar("providerAccountId", { length: 255 }), // e.g., iZettle merchant ID
  providerEmail: varchar("providerEmail", { length: 320 }), // Email associated with provider account
  
  // Configuration (stored as JSON)
  config: json("config"), // API keys, terminal IDs, etc.
  
  // Sync metadata
  lastSyncAt: timestamp("lastSyncAt"), // Last successful sync with provider
  lastErrorAt: timestamp("lastErrorAt"), // Last error timestamp
  lastErrorMessage: text("lastErrorMessage"), // Last error details
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantProvidersIdx: index("tenant_providers_idx").on(table.tenantId, table.isActive),
}));

export const paymentSplits = mysqlTable("paymentSplits", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  orderId: int("orderId"),
  paymentId: int("paymentId"), // Optional: link to parent payment if created from existing payment
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["card", "cash", "vipps", "stripe"]).notNull(),
  paymentProviderId: int("paymentProviderId"),
  cardLast4: varchar("cardLast4", { length: 4 }),
  cardBrand: varchar("cardBrand", { length: 50 }),
  transactionId: varchar("transactionId", { length: 255 }),
  status: mysqlEnum("status", ["completed", "failed"]).default("completed").notNull(),
  processedBy: int("processedBy").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantSplitsIdx: index("tenant_splits_idx").on(table.tenantId),
  orderSplitsIdx: index("order_splits_idx").on(table.orderId),
  paymentIdx: index("payment_idx").on(table.paymentId),
}));

export type PaymentProvider = typeof paymentProviders.$inferSelect;
export type InsertPaymentProvider = typeof paymentProviders.$inferInsert;

export type PaymentSplit = typeof paymentSplits.$inferSelect;
export type InsertPaymentSplit = typeof paymentSplits.$inferInsert;


// ============================================================================
// FIKEN ACCOUNTING INTEGRATION
// ============================================================================

export const fikenSettings = mysqlTable("fikenSettings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  
  // OAuth2 credentials
  clientId: varchar("clientId", { length: 255 }),
  clientSecret: varchar("clientSecret", { length: 255 }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  
  // Fiken company info
  companySlug: varchar("companySlug", { length: 100 }), // Fiken company identifier
  companyName: varchar("companyName", { length: 255 }),
  organizationNumber: varchar("organizationNumber", { length: 20 }),
  
  // Sync settings
  syncFrequency: mysqlEnum("syncFrequency", ["manual", "daily", "weekly", "monthly"]).default("manual").notNull(),
  autoSyncCustomers: boolean("autoSyncCustomers").default(true).notNull(),
  autoSyncInvoices: boolean("autoSyncInvoices").default(true).notNull(),
  autoSyncPayments: boolean("autoSyncPayments").default(true).notNull(),
  autoSyncProducts: boolean("autoSyncProducts").default(false).notNull(),
  
  lastSyncAt: timestamp("lastSyncAt"),
  lastSyncStatus: mysqlEnum("lastSyncStatus", ["success", "failed", "partial"]),
  lastSyncError: text("lastSyncError"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantIdx: index("fiken_settings_tenant_idx").on(table.tenantId),
}));

export const fikenCustomerMapping = mysqlTable("fikenCustomerMapping", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  customerId: int("customerId").notNull(), // Reference to customers table
  fikenContactId: int("fikenContactId").notNull(), // Fiken contact ID
  fikenContactPersonId: int("fikenContactPersonId"), // Fiken contact person ID (if applicable)
  status: mysqlEnum("status", ["synced", "failed", "pending"]).default("synced").notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantCustomerIdx: uniqueIndex("fiken_customer_tenant_customer_idx").on(table.tenantId, table.customerId),
  fikenContactIdx: index("fiken_contact_id_idx").on(table.fikenContactId),
  statusIdx: index("fiken_customer_status_idx").on(table.status),
}));

export const fikenInvoiceMapping = mysqlTable("fikenInvoiceMapping", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  orderId: int("orderId").notNull(), // Reference to orders table
  fikenInvoiceId: int("fikenInvoiceId").notNull(), // Fiken invoice ID
  fikenInvoiceNumber: varchar("fikenInvoiceNumber", { length: 50 }),
  fikenDraftId: int("fikenDraftId"), // Fiken draft ID (before sending)
  status: mysqlEnum("status", ["draft", "sent", "paid", "failed"]).default("draft").notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt"),
  sentAt: timestamp("sentAt"), // When invoice was sent in Fiken
  paidAt: timestamp("paidAt"), // When invoice was marked paid in Fiken
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantOrderIdx: index("fiken_invoice_tenant_order_idx").on(table.tenantId, table.orderId),
  fikenInvoiceIdx: index("fiken_invoice_id_idx").on(table.fikenInvoiceId),
  statusIdx: index("fiken_invoice_status_idx").on(table.status),
}));

export const fikenProductMapping = mysqlTable("fikenProductMapping", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  productId: int("productId"), // Reference to products table (null for services)
  serviceId: int("serviceId"), // Reference to services table (null for products)
  fikenProductId: int("fikenProductId").notNull(), // Fiken product ID
  status: mysqlEnum("status", ["synced", "failed", "pending"]).default("synced").notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantProductIdx: index("fiken_product_tenant_product_idx").on(table.tenantId, table.productId),
  tenantServiceIdx: index("fiken_product_tenant_service_idx").on(table.tenantId, table.serviceId),
  fikenProductIdx: index("fiken_product_id_idx").on(table.fikenProductId),
}));

export const fikenSyncLog = mysqlTable("fikenSyncLog", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  operation: mysqlEnum("operation", [
    "customer_sync",
    "invoice_sync",
    "payment_sync",
    "product_sync",
    "full_sync",
    "test_connection",
    "oauth_refresh"
  ]).notNull(),
  status: mysqlEnum("status", ["success", "failed", "partial"]).notNull(),
  itemsProcessed: int("itemsProcessed").default(0),
  itemsFailed: int("itemsFailed").default(0),
  errorMessage: text("errorMessage"),
  details: json("details").$type<{
    invoiceIds?: number[];
    customerIds?: number[];
    productIds?: number[];
    errors?: Array<{ id: number; error: string }>;
  }>(),
  duration: int("duration"), // milliseconds
  triggeredBy: mysqlEnum("triggeredBy", ["scheduled", "manual", "api", "auto"]).default("manual").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tenantOperationIdx: index("fiken_log_tenant_operation_idx").on(table.tenantId, table.operation, table.createdAt),
  statusIdx: index("fiken_log_status_idx").on(table.status),
  createdAtIdx: index("fiken_log_created_idx").on(table.createdAt),
}));

// ============================================================================
// CONTACT MESSAGES
// ============================================================================

export const contactMessages = mysqlTable("contactMessages", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  subject: varchar("subject", { length: 500 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["new", "read", "replied", "archived"]).default("new").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv6 compatible
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  readAt: timestamp("readAt"),
  repliedAt: timestamp("repliedAt"),
}, (table) => ({
  tenantIdx: index("tenant_idx").on(table.tenantId),
  statusIdx: index("status_idx").on(table.status),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type ContactMessage = typeof contactMessages.$inferSelect;
export type InsertContactMessage = typeof contactMessages.$inferInsert;

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

export const emailTemplates = mysqlTable("emailTemplates", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  templateType: mysqlEnum("templateType", [
    "reminder_24h",
    "reminder_2h",
    "booking_confirmation",
    "booking_cancellation",
    "booking_update"
  ]).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: text("bodyHtml").notNull(),
  logoUrl: text("logoUrl"),
  primaryColor: varchar("primaryColor", { length: 7 }).default("#8b5cf6"), // Hex color
  secondaryColor: varchar("secondaryColor", { length: 7 }).default("#6366f1"), // Hex color
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantTypeIdx: uniqueIndex("tenant_type_idx").on(table.tenantId, table.templateType),
}));

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

export type FikenSettings = typeof fikenSettings.$inferSelect;
export type InsertFikenSettings = typeof fikenSettings.$inferInsert;

export type FikenCustomerMapping = typeof fikenCustomerMapping.$inferSelect;
export type InsertFikenCustomerMapping = typeof fikenCustomerMapping.$inferInsert;

export type FikenInvoiceMapping = typeof fikenInvoiceMapping.$inferSelect;
export type InsertFikenInvoiceMapping = typeof fikenInvoiceMapping.$inferInsert;

export type FikenProductMapping = typeof fikenProductMapping.$inferSelect;
export type InsertFikenProductMapping = typeof fikenProductMapping.$inferInsert;

export type FikenSyncLog = typeof fikenSyncLog.$inferSelect;
export type InsertFikenSyncLog = typeof fikenSyncLog.$inferInsert;

// ============================================================================
// PAYMENT SETTINGS (for online booking)
// ============================================================================

export const paymentSettings = mysqlTable("paymentSettings", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull().unique(),
  
  // Enable/disable payment methods
  vippsEnabled: boolean("vippsEnabled").default(false).notNull(),
  cardEnabled: boolean("cardEnabled").default(false).notNull(),
  cashEnabled: boolean("cashEnabled").default(true).notNull(),
  payAtSalonEnabled: boolean("payAtSalonEnabled").default(true).notNull(),
  
  // Vipps configuration
  vippsClientId: text("vippsClientId"),
  vippsClientSecret: text("vippsClientSecret"),
  vippsSubscriptionKey: text("vippsSubscriptionKey"),
  vippsMerchantSerialNumber: varchar("vippsMerchantSerialNumber", { length: 20 }),
  vippsTestMode: boolean("vippsTestMode").default(true).notNull(),
  
  // Stripe configuration (legacy - manual API keys)
  stripePublishableKey: text("stripePublishableKey"),
  stripeSecretKey: text("stripeSecretKey"),
  stripeTestMode: boolean("stripeTestMode").default(true).notNull(),
  
  // Stripe Connect (OAuth - recommended for SaaS)
  stripeConnectedAccountId: varchar("stripeConnectedAccountId", { length: 255 }),
  stripeAccessToken: text("stripeAccessToken"),
  stripeRefreshToken: text("stripeRefreshToken"),
  stripeAccountStatus: mysqlEnum("stripeAccountStatus", ["connected", "disconnected", "pending"]).default("disconnected"),
  stripeConnectedAt: timestamp("stripeConnectedAt"),
  
  // Default payment method
  defaultPaymentMethod: mysqlEnum("defaultPaymentMethod", [
    "vipps",
    "card",
    "cash",
    "pay_at_salon"
  ]).default("pay_at_salon"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantIdx: index("tenant_idx").on(table.tenantId),
}));

export type PaymentSettings = typeof paymentSettings.$inferSelect;
export type InsertPaymentSettings = typeof paymentSettings.$inferInsert;

// ============================================================================
// DATA IMPORTS
// ============================================================================

export const dataImports = mysqlTable("dataImports", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  importType: mysqlEnum("importType", ["customers", "services", "products", "sql_restore"]).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileSize: int("fileSize"), // bytes
  status: mysqlEnum("status", ["in_progress", "completed", "failed"]).default("in_progress").notNull(),
  recordsTotal: int("recordsTotal").default(0), // Total records in file
  recordsImported: int("recordsImported").default(0), // Successfully imported
  recordsFailed: int("recordsFailed").default(0), // Failed to import
  errorMessage: text("errorMessage"),
  errorDetails: json("errorDetails"), // Array of error objects
  importedBy: int("importedBy"), // User ID who initiated import
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  tenantIdx: index("tenant_idx").on(table.tenantId),
  statusIdx: index("status_idx").on(table.status),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type DataImport = typeof dataImports.$inferSelect;
export type InsertDataImport = typeof dataImports.$inferInsert;

// ============================================================================
// APPOINTMENT HISTORY
// ============================================================================

export const appointmentHistory = mysqlTable("appointmentHistory", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 36 }).notNull(),
  appointmentId: int("appointmentId").notNull(),
  changeType: mysqlEnum("changeType", [
    "created",
    "rescheduled",
    "status_changed",
    "service_changed",
    "employee_changed",
    "canceled",
    "notes_updated"
  ]).notNull(),
  fieldName: varchar("fieldName", { length: 100 }), // e.g., "appointmentDate", "startTime", "status"
  oldValue: text("oldValue"), // JSON or string representation of old value
  newValue: text("newValue"), // JSON or string representation of new value
  changedBy: mysqlEnum("changedBy", ["customer", "staff", "system"]).notNull(),
  changedByUserId: int("changedByUserId"), // User ID if changed by staff
  changedByEmail: varchar("changedByEmail", { length: 320 }), // Email if changed by customer
  notes: text("notes"), // Optional notes about the change
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  appointmentIdx: index("appointment_idx").on(table.appointmentId),
  tenantIdx: index("tenant_idx").on(table.tenantId),
  changeTypeIdx: index("change_type_idx").on(table.changeType),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type AppointmentHistory = typeof appointmentHistory.$inferSelect;
export type InsertAppointmentHistory = typeof appointmentHistory.$inferInsert;
