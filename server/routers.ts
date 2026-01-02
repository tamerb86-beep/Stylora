import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { contactMessages } from "../drizzle/schema";
// Fiken imports
import { FikenClient } from "./fiken/client";
import { syncCustomerToFiken, bulkSyncCustomers, getUnsyncedCustomersCount } from "./fiken/customers";
import { syncOrderToFiken, bulkSyncOrders, getUnsyncedOrdersCount } from "./fiken/invoices";
import { fikenSettings, fikenSyncLog, fikenCustomerMapping, fikenInvoiceMapping } from "../drizzle/schema";
import { nanoid } from "nanoid";
import { eq, and, or, gte, lte, sql, desc } from "drizzle-orm";
import { exportRouter } from "./export";
import { loyaltyRouter } from "./loyalty-router";
import { onboardingRouter } from './routers/onboarding';
import { monitoringRouter } from './routers/monitoring';
import { ENV } from "./_core/env";

// ============================================================================
// AUTHENTICATION & TENANT CONTEXT
// ============================================================================

// Middleware to ensure user has tenant access AND email is verified
const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
  }
  
  // Check email verification
  const dbInstance = await db.getDb();
  if (!dbInstance) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  }

  const { tenants } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [tenant] = await dbInstance
    .select()
    .from(tenants)
    .where(eq(tenants.id, ctx.user.tenantId))
    .limit(1);

  if (!tenant) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
  }

  if (!tenant.emailVerified) {
    throw new TRPCError({ 
      code: "FORBIDDEN", 
      message: "EMAIL_NOT_VERIFIED",
    });
  }
  
  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.user.tenantId,
    },
  });
});

// Middleware for wizard - allows access without email verification
const wizardProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
  }
  
  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.user.tenantId,
    },
  });
});

// Middleware for owner/admin only
const adminProcedure = tenantProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// Middleware for employees (including admins)
const employeeProcedure = tenantProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "owner" && ctx.user.role !== "admin" && ctx.user.role !== "employee") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Employee access required" });
  }
  return next({ ctx });
});

// Middleware for platform owner (SaaS admin)
const platformAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access required" });
  }
  return next({ ctx });
});

// ============================================================================
// ROUTERS
// ============================================================================

export const appRouter = router({
  system: systemRouter,
  export: exportRouter,
  loyalty: loyaltyRouter,
  onboarding: onboardingRouter,
  monitoring: monitoringRouter,
  
  // ============================================================================
  // STRIPE CONNECT (OAuth for SaaS)
  // ============================================================================
  stripeConnect: router({
    // Get Stripe Connect authorization URL
    getAuthUrl: tenantProcedure.query(async ({ ctx }) => {
      const STRIPE_CONNECT_CLIENT_ID = ENV.stripeConnectClientId || "";
      const FRONTEND_URL = process.env.VITE_FRONTEND_URL || "http://localhost:3000";
      
      if (!STRIPE_CONNECT_CLIENT_ID) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe Connect is not configured. Please contact support.",
        });
      }

      const redirectUri = `${FRONTEND_URL}/stripe/callback`;
      const state = ctx.tenantId; // Use tenantId as state for security

      const authUrl =
        `https://connect.stripe.com/oauth/authorize?` +
        `response_type=code&` +
        `client_id=${STRIPE_CONNECT_CLIENT_ID}&` +
        `scope=read_write&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}`;

      return { authUrl };
    }),

    // Handle OAuth callback
    handleCallback: publicProcedure
      .input(
        z.object({
          code: z.string(),
          state: z.string(), // tenantId
        })
      )
      .mutation(async ({ input }) => {
        const { code, state: tenantId } = input;
        const STRIPE_SECRET_KEY = ENV.stripeSecretKey || "";

        if (!STRIPE_SECRET_KEY) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Stripe is not configured",
          });
        }

        try {
          const dbInstance = await db.getDb();
          if (!dbInstance) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
          }

          const { paymentSettings } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");

          // Exchange authorization code for access token
          const response = await fetch("https://connect.stripe.com/oauth/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_secret: STRIPE_SECRET_KEY,
              code,
              grant_type: "authorization_code",
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error_description || "Failed to connect to Stripe");
          }

          const data = await response.json();

          // Save connected account info to database
          const existing = await dbInstance
            .select()
            .from(paymentSettings)
            .where(eq(paymentSettings.tenantId, tenantId))
            .limit(1);

          if (existing.length > 0) {
            // Update existing settings
            await dbInstance
              .update(paymentSettings)
              .set({
                stripeConnectedAccountId: data.stripe_user_id,
                stripeAccessToken: data.access_token,
                stripeRefreshToken: data.refresh_token,
                stripeAccountStatus: "connected",
                stripeConnectedAt: new Date(),
                cardEnabled: true,
              })
              .where(eq(paymentSettings.tenantId, tenantId));
          } else {
            // Create new settings
            await dbInstance.insert(paymentSettings).values({
              tenantId,
              stripeConnectedAccountId: data.stripe_user_id,
              stripeAccessToken: data.access_token,
              stripeRefreshToken: data.refresh_token,
              stripeAccountStatus: "connected",
              stripeConnectedAt: new Date(),
              cardEnabled: true,
              vippsEnabled: false,
              cashEnabled: true,
              payAtSalonEnabled: true,
              stripeTestMode: false,
            });
          }

          return {
            success: true,
            accountId: data.stripe_user_id,
          };
        } catch (error: any) {
          console.error("Stripe Connect callback error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "Failed to connect Stripe account",
          });
        }
      }),

    // Get connection status
    getStatus: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return { connected: false, accountId: null, status: "disconnected" };

      const { paymentSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const settings = await dbInstance
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.tenantId, ctx.tenantId))
        .limit(1);

      if (settings.length === 0 || !settings[0].stripeConnectedAccountId) {
        return {
          connected: false,
          accountId: null,
          status: "disconnected",
        };
      }

      return {
        connected: true,
        accountId: settings[0].stripeConnectedAccountId,
        status: settings[0].stripeAccountStatus || "connected",
        connectedAt: settings[0].stripeConnectedAt,
      };
    }),

    // Disconnect Stripe account
    disconnect: tenantProcedure.mutation(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { paymentSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const settings = await dbInstance
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.tenantId, ctx.tenantId))
        .limit(1);

      if (settings.length === 0 || !settings[0].stripeConnectedAccountId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No connected Stripe account found",
        });
      }

      await dbInstance
        .update(paymentSettings)
        .set({
          stripeConnectedAccountId: null,
          stripeAccessToken: null,
          stripeRefreshToken: null,
          stripeAccountStatus: "disconnected",
          stripeConnectedAt: null,
          cardEnabled: false,
        })
        .where(eq(paymentSettings.tenantId, ctx.tenantId));

      return { success: true };
    }),

    // Get account details from Stripe
    getAccountDetails: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { paymentSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const STRIPE_SECRET_KEY = ENV.stripeSecretKey || "";

      const settings = await dbInstance
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.tenantId, ctx.tenantId))
        .limit(1);

      if (settings.length === 0 || !settings[0].stripeConnectedAccountId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No connected Stripe account found",
        });
      }

      try {
        const response = await fetch(
          `https://api.stripe.com/v1/accounts/${settings[0].stripeConnectedAccountId}`,
          {
            headers: {
              Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch account details");
        }

        const account = await response.json();

        return {
          id: account.id,
          email: account.email,
          displayName: account.settings?.dashboard?.display_name || account.email,
          country: account.country,
          currency: account.default_currency,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        };
      } catch (error: any) {
        console.error("Failed to fetch Stripe account details:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch account details",
        });
      }
    }),
  }),
  
  // ============================================================================
  // FIKEN ACCOUNTING INTEGRATION
  // ============================================================================
  fiken: router({
    // Get Fiken settings
    getSettings: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const [settings] = await dbInstance
          .select()
          .from(fikenSettings)
          .where(eq(fikenSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (!settings) {
          return null;
        }

        // Don't expose sensitive data
        return {
          id: settings.id,
          enabled: settings.enabled,
          companySlug: settings.companySlug,
          companyName: settings.companyName,
          organizationNumber: settings.organizationNumber,
          syncFrequency: settings.syncFrequency,
          autoSyncCustomers: settings.autoSyncCustomers,
          autoSyncInvoices: settings.autoSyncInvoices,
          autoSyncPayments: settings.autoSyncPayments,
          autoSyncProducts: settings.autoSyncProducts,
          lastSyncAt: settings.lastSyncAt,
          lastSyncStatus: settings.lastSyncStatus,
          lastSyncError: settings.lastSyncError,
          hasCredentials: !!(settings.clientId && settings.clientSecret),
          isConnected: !!(settings.accessToken && settings.companySlug),
        };
      }),

    // Save OAuth credentials
    saveCredentials: adminProcedure
      .input(z.object({
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const [existing] = await dbInstance
          .select()
          .from(fikenSettings)
          .where(eq(fikenSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          await dbInstance
            .update(fikenSettings)
            .set({
              clientId: input.clientId,
              clientSecret: input.clientSecret,
              updatedAt: new Date(),
            })
            .where(eq(fikenSettings.id, existing.id));
        } else {
          await dbInstance.insert(fikenSettings).values({
            tenantId: ctx.tenantId,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            enabled: false,
          });
        }

        return { success: true };
      }),

    // Get OAuth authorization URL
    getAuthUrl: adminProcedure
      .input(z.object({
        redirectUri: z.string().url(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const [settings] = await dbInstance
          .select()
          .from(fikenSettings)
          .where(eq(fikenSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (!settings || !settings.clientId) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "Please save OAuth credentials first" 
          });
        }

        const state = `${ctx.tenantId}:${Date.now()}`;
        const authUrl = FikenClient.getAuthorizationUrl(
          settings.clientId,
          input.redirectUri,
          state
        );

        return { authUrl, state };
      }),

    // Handle OAuth callback
    handleCallback: adminProcedure
      .input(z.object({
        code: z.string(),
        state: z.string(),
        redirectUri: z.string().url(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        // Verify state matches tenant
        const [tenantId] = input.state.split(':');
        if (tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid state parameter" });
        }

        const [settings] = await dbInstance
          .select()
          .from(fikenSettings)
          .where(eq(fikenSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (!settings || !settings.clientId || !settings.clientSecret) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "OAuth credentials not found" 
          });
        }

        try {
          // Exchange code for tokens
          const tokens = await FikenClient.exchangeCodeForToken(
            input.code,
            settings.clientId,
            settings.clientSecret,
            input.redirectUri
          );

          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

          // Initialize client to get company info
          const client = new FikenClient(ctx.tenantId);
          
          // Temporarily set tokens
          await dbInstance
            .update(fikenSettings)
            .set({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              tokenExpiresAt: expiresAt,
              enabled: true,
              updatedAt: new Date(),
            })
            .where(eq(fikenSettings.id, settings.id));

          // Get company info
          await client.initialize();
          const companies = await client.getCompanies();

          if (companies.length === 0) {
            throw new Error("No companies found in Fiken account");
          }

          // Use first company
          const company = companies[0];

          // Update settings with company info
          await dbInstance
            .update(fikenSettings)
            .set({
              companySlug: company.slug,
              companyName: company.name,
              organizationNumber: company.organizationNumber,
              updatedAt: new Date(),
            })
            .where(eq(fikenSettings.id, settings.id));

          return {
            success: true,
            companyName: company.name,
          };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "Failed to connect to Fiken",
          });
        }
      }),

    // Disconnect Fiken
    disconnect: adminProcedure
      .mutation(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        await dbInstance
          .update(fikenSettings)
          .set({
            enabled: false,
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            companySlug: null,
            companyName: null,
            organizationNumber: null,
            updatedAt: new Date(),
          })
          .where(eq(fikenSettings.tenantId, ctx.tenantId));

        return { success: true };
      }),

    // Test connection
    testConnection: adminProcedure
      .mutation(async ({ ctx }) => {
        try {
          const client = new FikenClient(ctx.tenantId);
          await client.initialize();
          const result = await client.testConnection();

          const dbInstance = await db.getDb();
          if (dbInstance) {
            await dbInstance.insert(fikenSyncLog).values({
              tenantId: ctx.tenantId,
              operation: "test_connection",
              status: result.success ? "success" : "failed",
              errorMessage: result.error,
              triggeredBy: "manual",
            });
          }

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          
          const dbInstance = await db.getDb();
          if (dbInstance) {
            await dbInstance.insert(fikenSyncLog).values({
              tenantId: ctx.tenantId,
              operation: "test_connection",
              status: "failed",
              errorMessage,
              triggeredBy: "manual",
            });
          }

          return {
            success: false,
            error: errorMessage,
          };
        }
      }),

    // Get sync status
    getSyncStatus: adminProcedure
      .query(async ({ ctx }) => {
        const unsyncedCustomers = await getUnsyncedCustomersCount(ctx.tenantId);
        const unsyncedOrders = await getUnsyncedOrdersCount(ctx.tenantId);

        return {
          unsyncedCustomers,
          unsyncedOrders,
        };
      }),

    // Sync single customer
    syncCustomer: adminProcedure
      .input(z.object({
        customerId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await syncCustomerToFiken(ctx.tenantId, input.customerId);
        return result;
      }),

    // Sync all customers
    syncAllCustomers: adminProcedure
      .mutation(async ({ ctx }) => {
        const result = await bulkSyncCustomers(ctx.tenantId);
        return result;
      }),

    // Sync single order
    syncOrder: adminProcedure
      .input(z.object({
        orderId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await syncOrderToFiken(ctx.tenantId, input.orderId);
        return result;
      }),

    // Sync all orders
    syncAllOrders: adminProcedure
      .mutation(async ({ ctx }) => {
        const result = await bulkSyncOrders(ctx.tenantId);
        return result;
      }),

    // Get sync logs
    getSyncLogs: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
        operation: z.enum(["customer_sync", "invoice_sync", "payment_sync", "product_sync", "full_sync", "test_connection", "oauth_refresh"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let query = dbInstance
          .select()
          .from(fikenSyncLog)
          .where(eq(fikenSyncLog.tenantId, ctx.tenantId))
          .orderBy(desc(fikenSyncLog.createdAt))
          .limit(input.limit);

        if (input.operation) {
          query = dbInstance
            .select()
            .from(fikenSyncLog)
            .where(and(
              eq(fikenSyncLog.tenantId, ctx.tenantId),
              eq(fikenSyncLog.operation, input.operation)
            ))
            .orderBy(desc(fikenSyncLog.createdAt))
            .limit(input.limit);
        }

        const logs = await query;
        return logs;
      }),

    // Sync single payment
    syncPayment: adminProcedure
      .input(z.object({
        paymentId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { FikenClient } = await import("./fiken/client");
        const { syncPaymentToFiken } = await import("./fiken/payments");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        const result = await syncPaymentToFiken(client, ctx.tenantId, input.paymentId);
        return result;
      }),

    // Sync single service
    syncService: adminProcedure
      .input(z.object({
        serviceId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { FikenClient } = await import("./fiken/client");
        const { syncServiceToFiken } = await import("./fiken/products");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        const result = await syncServiceToFiken(client, ctx.tenantId, input.serviceId);
        return result;
      }),

    // Sync single product
    syncProduct: adminProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { FikenClient } = await import("./fiken/client");
        const { syncProductToFiken } = await import("./fiken/products");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        const result = await syncProductToFiken(client, ctx.tenantId, input.productId);
        return result;
      }),

    // Sync all services
    syncAllServices: adminProcedure
      .mutation(async ({ ctx }) => {
        const { FikenClient } = await import("./fiken/client");
        const { bulkSyncServices } = await import("./fiken/products");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        const result = await bulkSyncServices(client, ctx.tenantId);
        return result;
      }),

    // Sync all products
    syncAllProducts: adminProcedure
      .mutation(async ({ ctx }) => {
        const { FikenClient } = await import("./fiken/client");
        const { bulkSyncProducts } = await import("./fiken/products");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        const result = await bulkSyncProducts(client, ctx.tenantId);
        return result;
      }),

    // Manual full sync (all data types)
    manualFullSync: adminProcedure
      .mutation(async ({ ctx }) => {
        const { FikenClient } = await import("./fiken/client");
        const { bulkSyncCustomers } = await import("./fiken/customers");
        const { bulkSyncOrders } = await import("./fiken/invoices");
        const { bulkSyncServices, bulkSyncProducts } = await import("./fiken/products");
        
        const client = new FikenClient(ctx.tenantId);
        await client.initialize();
        
        // Sync all data types
        const customers = await bulkSyncCustomers(ctx.tenantId);
        const services = await bulkSyncServices(client, ctx.tenantId);
        const products = await bulkSyncProducts(client, ctx.tenantId);
        const orders = await bulkSyncOrders(ctx.tenantId);
        
        return {
          success: true,
          customers,
          services,
          products,
          orders,
        };
      }),

    // Update settings
    updateSettings: adminProcedure
      .input(z.object({
        syncFrequency: z.enum(["manual", "daily", "weekly", "monthly"]).optional(),
        autoSyncCustomers: z.boolean().optional(),
        autoSyncInvoices: z.boolean().optional(),
        autoSyncPayments: z.boolean().optional(),
        autoSyncProducts: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const [existing] = await dbInstance
          .select()
          .from(fikenSettings)
          .where(eq(fikenSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Fiken settings not found" });
        }

        await dbInstance
          .update(fikenSettings)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(fikenSettings.id, existing.id));

        return { success: true };
      }),
  }),
  
  // ============================================================================
  // TENANT SIGNUP (Public)
  // ============================================================================
  signup: router({
    createTenant: publicProcedure
      .input(z.object({
        salonName: z.string().min(2, "Salon name must be at least 2 characters"),
        ownerEmail: z.string().email("Invalid email address"),
        ownerPhone: z.string().min(8, "Phone number must be at least 8 digits"),
        password: z.string().min(6, "Password must be at least 6 characters").optional(),
        address: z.string().optional(),
        orgNumber: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Generate unique subdomain from salon name
        let subdomain = input.salonName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 30);

        // Check if subdomain exists, add random suffix if needed
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          const [existing] = await dbInstance
            .select()
            .from(tenants)
            .where(eq(tenants.subdomain, subdomain))
            .limit(1);
          
          if (!existing) {
            isUnique = true;
          } else {
            subdomain = `${subdomain}-${Math.floor(Math.random() * 1000)}`;
            attempts++;
          }
        }

        if (!isUnique) {
          throw new TRPCError({ code: "CONFLICT", message: "Could not generate unique subdomain" });
        }

        // Calculate trial end date (30 days from now)
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 30);

        // Create tenant
        const tenantId = nanoid();
        await dbInstance.insert(tenants).values({
          id: tenantId,
          name: input.salonName,
          subdomain,
          phone: input.ownerPhone,
          email: input.ownerEmail,
          address: input.address || null,
          orgNumber: input.orgNumber || null,
          status: "trial",
          trialEndsAt,
          timezone: "Europe/Oslo",
          currency: "NOK",
          vatRate: "25.00",
        });

        // Create owner user with unique openId
        const ownerOpenId = `owner-${tenantId}-${nanoid()}`;
        
        // Hash password if provided
        let passwordHash = null;
        if (input.password) {
          const bcrypt = await import("bcrypt");
          passwordHash = await bcrypt.hash(input.password, 10);
        }
        
        await dbInstance.insert(users).values({
          tenantId,
          openId: ownerOpenId,
          email: input.ownerEmail,
          name: input.salonName + " Owner",
          phone: input.ownerPhone,
          role: "owner",
          loginMethod: "email",
          passwordHash,
          isActive: true,
        });

        // Send verification email
        try {
          const { sendVerificationEmail } = await import("./emailService");
          await sendVerificationEmail(tenantId, input.ownerEmail);
          console.log(`[Signup] Verification email sent to ${input.ownerEmail}`);
        } catch (emailError) {
          console.error(`[Signup] Failed to send verification email:`, emailError);
          // Don't fail signup if email fails, just log it
        }

        // Create session token for auto-login
        const { sdk } = await import("./_core/sdk");
        const { COOKIE_NAME, ONE_YEAR_MS } = await import("@shared/const");
        const sessionToken = await sdk.createSessionToken(ownerOpenId, {
          name: input.salonName + " Owner",
          expiresInMs: ONE_YEAR_MS,
        });

        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return {
          success: true,
          tenantId,
          subdomain,
          trialEndsAt,
        };
      }),
    
    verifyEmail: publicProcedure
      .input(z.object({
        token: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { verifyEmailToken } = await import("./emailService");
        return await verifyEmailToken(input.token);
      }),
    
    resendVerification: protectedProcedure
      .mutation(async ({ ctx }) => {
        if (!ctx.user.tenantId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
        }
        const { resendVerificationEmail } = await import("./emailService");
        return await resendVerificationEmail(ctx.user.tenantId);
      }),
  }),
  
  // Global search
  search: router({
    global: tenantProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        return await db.globalSearch(ctx.tenantId, input.query);
      }),
  }),
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateUIMode: protectedProcedure
      .input(z.object({ uiMode: z.enum(["simple", "advanced"]) }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(users)
          .set({ uiMode: input.uiMode, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { success: true, uiMode: input.uiMode };
      }),
    updateSidebarState: protectedProcedure
      .input(z.object({ sidebarOpen: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(users)
          .set({ sidebarOpen: input.sidebarOpen, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { success: true, sidebarOpen: input.sidebarOpen };
      }),
    updateOnboardingStep: protectedProcedure
      .input(z.object({ step: z.number().int().min(0) }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(users)
          .set({ onboardingStep: input.step, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { success: true, step: input.step };
      }),
    completeOnboarding: protectedProcedure
      .mutation(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(users)
          .set({ onboardingCompleted: true, onboardingStep: 0, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { success: true };
      }),
    resetOnboarding: protectedProcedure
      .mutation(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(users)
          .set({ onboardingCompleted: false, onboardingStep: 0, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { success: true };
      }),
  }),

  // ============================================================================
  // TENANTS
  // ============================================================================
  tenants: router({
    // Special procedure that doesn't require email verification
    getVerificationStatus: protectedProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select({
          id: tenants.id,
          email: tenants.email,
          emailVerified: tenants.emailVerified,
          name: tenants.name,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.user.tenantId))
        .limit(1);

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return tenant;
    }),

    getCurrent: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select()
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return tenant;
    }),
  }),

  // ============================================================================
  // SALON SETTINGS
  // ============================================================================
  salonSettings: router({
    getBookingSettings: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select({
          id: tenants.id,
          name: tenants.name,
          requirePrepayment: tenants.requirePrepayment,
          cancellationWindowHours: tenants.cancellationWindowHours,
          noShowThresholdForPrepayment: tenants.noShowThresholdForPrepayment,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return tenant;
    }),

    updateBookingSettings: tenantProcedure
      .input(
        z.object({
          requirePrepayment: z.boolean(),
          cancellationWindowHours: z.number().int().min(1).max(168), // 1h – 7 days
          noShowThresholdForPrepayment: z.number().int().min(0).max(10).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const updateData: any = {
          requirePrepayment: input.requirePrepayment,
          cancellationWindowHours: input.cancellationWindowHours,
          updatedAt: new Date(),
        };

        if (input.noShowThresholdForPrepayment !== undefined) {
          updateData.noShowThresholdForPrepayment = input.noShowThresholdForPrepayment;
        }

        await dbInstance
          .update(tenants)
          .set(updateData)
          .where(eq(tenants.id, ctx.tenantId));

        // Fetch and return updated settings
        const [updated] = await dbInstance
          .select({
            id: tenants.id,
            requirePrepayment: tenants.requirePrepayment,
            cancellationWindowHours: tenants.cancellationWindowHours,
            noShowThresholdForPrepayment: tenants.noShowThresholdForPrepayment,
          })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId));

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        return updated;
      }),

    // Domain/Subdomain Management
    getDomainInfo: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select({
          id: tenants.id,
          name: tenants.name,
          subdomain: tenants.subdomain,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return {
        subdomain: tenant.subdomain,
        bookingUrl: `https://${tenant.subdomain}.stylora.no/book`,
        lastUpdated: tenant.updatedAt,
      };
    }),

    checkSubdomainAvailability: tenantProcedure
      .input(z.object({ subdomain: z.string().min(3).max(63) }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq, and, ne } = await import("drizzle-orm");

        // Check if subdomain exists for other tenants (not current tenant)
        const [existing] = await dbInstance
          .select({ id: tenants.id })
          .from(tenants)
          .where(
            and(
              eq(tenants.subdomain, input.subdomain),
              ne(tenants.id, ctx.tenantId)
            )
          )
          .limit(1);

        return { available: !existing };
      }),

    updateSubdomain: adminProcedure
      .input(
        z.object({
          subdomain: z
            .string()
            .min(3, "Subdomain must be at least 3 characters")
            .max(63, "Subdomain must be at most 63 characters")
            .regex(
              /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
              "Subdomain must contain only lowercase letters, numbers, and hyphens (not at start/end)"
            ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if subdomain is already taken
        const [existing] = await dbInstance
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.subdomain, input.subdomain))
          .limit(1);

        if (existing && existing.id !== ctx.tenantId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Subdomain is already taken",
          });
        }

        // Update subdomain
        await dbInstance
          .update(tenants)
          .set({
            subdomain: input.subdomain,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));

        return {
          success: true,
          subdomain: input.subdomain,
          bookingUrl: `https://${input.subdomain}.stylora.no/book`,
        };
      }),

    // Branding Management
    getBranding: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { salonSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [settings] = await dbInstance
        .select()
        .from(salonSettings)
        .where(eq(salonSettings.tenantId, ctx.tenantId))
        .limit(1);

      // If no settings exist, return defaults
      if (!settings) {
        return {
          logoUrl: null,
          primaryColor: "#2563eb",
          accentColor: "#ea580c",
          welcomeTitle: "Velkommen!",
          welcomeSubtitle: "Bestill din time på nett.",
          showStaffSection: true,
          showSummaryCard: true,
          receiptLogoUrl: null,
        };
      }

      return {
        ...settings.bookingBranding,
        receiptLogoUrl: settings.receiptLogoUrl || null,
      };
    }),

    updateBranding: adminProcedure
      .input(
        z.object({
          logoUrl: z.string().url().nullable(),
          primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
          accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
          welcomeTitle: z.string().min(1).max(100),
          welcomeSubtitle: z.string().min(1).max(200),
          showStaffSection: z.boolean(),
          showSummaryCard: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { salonSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if settings exist
        const [existing] = await dbInstance
          .select({ id: salonSettings.id })
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          // Update existing settings
          await dbInstance
            .update(salonSettings)
            .set({
              bookingBranding: input,
              updatedAt: new Date(),
            })
            .where(eq(salonSettings.tenantId, ctx.tenantId));
        } else {
          // Insert new settings
          await dbInstance.insert(salonSettings).values({
            tenantId: ctx.tenantId,
            bookingBranding: input,
          });
        }

        return { success: true, branding: input };
      }),

    // Print Settings Management
    getPrintSettings: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { salonSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [settings] = await dbInstance
        .select()
        .from(salonSettings)
        .where(eq(salonSettings.tenantId, ctx.tenantId))
        .limit(1);

      // If no settings exist, return defaults
      if (!settings || !settings.printSettings) {
        return {
          printerType: "thermal_80mm" as const,
          fontSize: "medium" as const,
          showLogo: true,
          customFooterText: "Takk for besøket! Velkommen tilbake!",
          autoPrintReceipt: false,
          autoOpenCashDrawer: false,
          orgNumber: "",
          bankAccount: "",
          website: "",
          businessHours: "",
        };
      }

      return {
        ...settings.printSettings,
        autoPrintReceipt: settings.printSettings.autoPrintReceipt ?? false,
        autoOpenCashDrawer: settings.printSettings.autoOpenCashDrawer ?? false,
        orgNumber: settings.printSettings.orgNumber || "",
        bankAccount: settings.printSettings.bankAccount || "",
        website: settings.printSettings.website || "",
        businessHours: settings.printSettings.businessHours || "",
      };
    }),

    updatePrintSettings: adminProcedure
      .input(
        z.object({
          printerType: z.enum(["thermal_80mm", "a4"]),
          fontSize: z.enum(["small", "medium", "large"]),
          showLogo: z.boolean(),
          customFooterText: z.string().max(200),
          autoPrintReceipt: z.boolean().optional(),
          autoOpenCashDrawer: z.boolean().optional(),
          orgNumber: z.string().max(50).optional(),
          bankAccount: z.string().max(50).optional(),
          website: z.string().url().max(200).optional().or(z.literal("")),
          businessHours: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { salonSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if settings exist
        const [existing] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          // Update existing settings
          await dbInstance
            .update(salonSettings)
            .set({
              printSettings: input,
              updatedAt: new Date(),
            })
            .where(eq(salonSettings.tenantId, ctx.tenantId));
        } else {
          // Create new settings
          await dbInstance.insert(salonSettings).values({
            tenantId: ctx.tenantId,
            printSettings: input,
          });
        }

        return { success: true, printSettings: input };
      }),

    uploadReceiptLogo: adminProcedure
      .input(
        z.object({
          fileData: z.string(), // base64 encoded image
          fileName: z.string(),
          mimeType: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        // Validate image type
        const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        if (!allowedTypes.includes(input.mimeType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only JPEG, PNG, and WebP images are allowed",
          });
        }

        // Decode base64 and validate size (max 2MB)
        const buffer = Buffer.from(input.fileData, "base64");
        const maxSize = 2 * 1024 * 1024; // 2MB
        if (buffer.length > maxSize) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Image size must be less than 2MB",
          });
        }

        // Generate unique file key
        const { storagePut } = await import("./storage");
        const timestamp = Date.now();
        const ext = input.fileName.split(".").pop();
        const fileKey = `receipts/${ctx.tenantId}/logo-${timestamp}.${ext}`;

        // Upload to S3
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        // Update salonSettings with logo URL
        const { salonSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [existing] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          await dbInstance
            .update(salonSettings)
            .set({
              receiptLogoUrl: url,
              updatedAt: new Date(),
            })
            .where(eq(salonSettings.tenantId, ctx.tenantId));
        } else {
          await dbInstance.insert(salonSettings).values({
            tenantId: ctx.tenantId,
            receiptLogoUrl: url,
          });
        }

        return { success: true, logoUrl: url };
      }),

    removeReceiptLogo: adminProcedure.mutation(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { salonSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      await dbInstance
        .update(salonSettings)
        .set({
          receiptLogoUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(salonSettings.tenantId, ctx.tenantId));

      return { success: true };
    }),

    // Salon Info Management
    getSalonInfo: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select({
          name: tenants.name,
          phone: tenants.phone,
          email: tenants.email,
          address: tenants.address,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return {
        name: tenant.name || "",
        phone: tenant.phone || "",
        email: tenant.email || "",
        address: tenant.address || "",
      };
    }),

    updateSalonInfo: adminProcedure
      .input(
        z.object({
          name: z.string().min(1, "Salongnavn er påkrevd"),
          phone: z.string().optional(),
          email: z.string().email("Ugyldig e-postadresse").optional().or(z.literal("")),
          address: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await dbInstance
          .update(tenants)
          .set({
            name: input.name,
            phone: input.phone || null,
            email: input.email || null,
            address: input.address || null,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));

        return { success: true };
      }),

    // SMS Settings Management
    getSmsSettings: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [tenant] = await dbInstance
        .select({
          smsPhoneNumber: tenants.smsPhoneNumber,
          smsProvider: tenants.smsProvider,
          smsApiKey: tenants.smsApiKey,
          smsApiSecret: tenants.smsApiSecret,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return {
        smsPhoneNumber: tenant.smsPhoneNumber || "",
        smsProvider: tenant.smsProvider || "mock",
        smsApiKey: tenant.smsApiKey || "",
        smsApiSecret: tenant.smsApiSecret || "",
      };
    }),

    updateSmsSettings: adminProcedure
      .input(
        z.object({
          smsPhoneNumber: z.string().regex(/^\+47[49]\d{7}$/, "Ugyldig norsk telefonnummer (+47xxxxxxxx)").optional().or(z.literal("")),
          smsProvider: z.enum(["mock", "pswincom", "linkmobility", "twilio"]).optional(),
          smsApiKey: z.string().optional(),
          smsApiSecret: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (input.smsPhoneNumber !== undefined) {
          updateData.smsPhoneNumber = input.smsPhoneNumber || null;
        }
        if (input.smsProvider !== undefined) {
          updateData.smsProvider = input.smsProvider;
        }
        if (input.smsApiKey !== undefined) {
          updateData.smsApiKey = input.smsApiKey || null;
        }
        if (input.smsApiSecret !== undefined) {
          updateData.smsApiSecret = input.smsApiSecret || null;
        }

        await dbInstance
          .update(tenants)
          .set(updateData)
          .where(eq(tenants.id, ctx.tenantId));

        return { success: true };
      }),

    testSmsConnection: adminProcedure
      .input(
        z.object({
          phoneNumber: z.string().regex(/^\+47[49]\d{7}$/, "Ugyldig norsk telefonnummer"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { sendSMS } = await import("./sms");

        const result = await sendSMS({
          to: input.phoneNumber,
          message: "Dette er en test-SMS fra Stylora. Hvis du mottar denne meldingen, er SMS-innstillingene dine konfigurert riktig!",
          tenantId: ctx.tenantId,
        });

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error || "Kunne ikke sende test-SMS",
          });
        }

        return {
          success: true,
          messageId: result.messageId,
          message: "Test-SMS sendt!",
        };
      }),

    // Load Default Services and Products
    loadDefaultData: adminProcedure
      .input(
        z.object({
          loadServices: z.boolean().default(true),
          loadProducts: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { services, serviceCategories, products, productCategories } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { 
          defaultServiceCategories, 
          defaultServices, 
          defaultProductCategories, 
          defaultProducts 
        } = await import("./services/defaultData");

        let servicesAdded = 0;
        let productsAdded = 0;
        let serviceCategoriesAdded = 0;
        let productCategoriesAdded = 0;

        // Load Services
        if (input.loadServices) {
          const categoryMap = new Map<string, number>();
          
          for (const cat of defaultServiceCategories) {
            const existingCat = await dbInstance
              .select()
              .from(serviceCategories)
              .where(eq(serviceCategories.tenantId, ctx.tenantId));
            
            const found = existingCat.find(c => c.name === cat.name);
            
            if (found) {
              categoryMap.set(cat.name, found.id);
            } else {
              const [inserted] = await dbInstance
                .insert(serviceCategories)
                .values({
                  tenantId: ctx.tenantId,
                  name: cat.name,
                  displayOrder: cat.displayOrder,
                });
              const insertId = (inserted as any).insertId;
              categoryMap.set(cat.name, insertId);
              serviceCategoriesAdded++;
            }
          }

          for (const service of defaultServices) {
            const categoryId = categoryMap.get(service.categoryName);
            
            const existingServices = await dbInstance
              .select()
              .from(services)
              .where(eq(services.tenantId, ctx.tenantId));
            
            const exists = existingServices.find(s => s.name === service.name);
            
            if (!exists) {
              await dbInstance.insert(services).values({
                tenantId: ctx.tenantId,
                categoryId: categoryId || null,
                name: service.name,
                description: service.description,
                durationMinutes: service.durationMinutes,
                price: service.price.toString(),
                isActive: true,
              });
              servicesAdded++;
            }
          }
        }

        // Load Products
        if (input.loadProducts) {
          const productCategoryMap = new Map<string, number>();
          
          for (const cat of defaultProductCategories) {
            const existingCat = await dbInstance
              .select()
              .from(productCategories)
              .where(eq(productCategories.tenantId, ctx.tenantId));
            
            const found = existingCat.find(c => c.name === cat.name);
            
            if (found) {
              productCategoryMap.set(cat.name, found.id);
            } else {
              const [inserted] = await dbInstance
                .insert(productCategories)
                .values({
                  tenantId: ctx.tenantId,
                  name: cat.name,
                  displayOrder: cat.displayOrder,
                });
              const insertId = (inserted as any).insertId;
              productCategoryMap.set(cat.name, insertId);
              productCategoriesAdded++;
            }
          }

          for (const product of defaultProducts) {
            const categoryId = productCategoryMap.get(product.categoryName);
            
            const existingProducts = await dbInstance
              .select()
              .from(products)
              .where(eq(products.tenantId, ctx.tenantId));
            
            const exists = existingProducts.find(p => p.sku === product.sku || p.name === product.name);
            
            if (!exists) {
              await dbInstance.insert(products).values({
                tenantId: ctx.tenantId,
                categoryId: categoryId || null,
                sku: product.sku,
                name: product.name,
                description: product.description,
                costPrice: product.costPrice.toString(),
                retailPrice: product.retailPrice.toString(),
                stockQuantity: product.stockQuantity,
                reorderPoint: product.reorderPoint,
                isActive: true,
              });
              productsAdded++;
            }
          }
        }

        return {
          success: true,
          message: `Lagt til ${servicesAdded} tjenester, ${serviceCategoriesAdded} tjenestekategorier, ${productsAdded} produkter, ${productCategoriesAdded} produktkategorier`,
          stats: {
            servicesAdded,
            serviceCategoriesAdded,
            productsAdded,
            productCategoriesAdded,
          },
        };
      }),

    // Get default data preview
    getDefaultDataPreview: tenantProcedure.query(async () => {
      const { 
        defaultServiceCategories, 
        defaultServices, 
        defaultProductCategories, 
        defaultProducts,
        defaultDataSummary,
      } = await import("./services/defaultData");

      return {
        summary: defaultDataSummary,
        serviceCategories: defaultServiceCategories,
        services: defaultServices,
        productCategories: defaultProductCategories,
        products: defaultProducts,
      };
    }),
  }),

  // ============================================================================
  // CUSTOMERS
  // ============================================================================
  customers: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      return db.getCustomersByTenant(ctx.tenantId);
    }),

    getById: tenantProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getCustomerById(input.id, ctx.tenantId);
      }),

    create: tenantProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().optional(),
        phone: z.string().min(1),
        email: z.string().email().optional().or(z.literal('')),
        dateOfBirth: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        marketingSmsConsent: z.boolean().default(false),
        marketingEmailConsent: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { customers } = await import("../drizzle/schema");
        
        await dbInstance.insert(customers).values({
          tenantId: ctx.tenantId,
          firstName: input.firstName,
          lastName: input.lastName || null,
          phone: input.phone,
          email: input.email || null,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          address: input.address || null,
          notes: input.notes || null,
          marketingSmsConsent: input.marketingSmsConsent,
          marketingEmailConsent: input.marketingEmailConsent,
          consentTimestamp: input.marketingSmsConsent || input.marketingEmailConsent ? new Date() : null,
          consentIp: ctx.req.ip || null,
        });

        return { success: true };
      }),

    update: tenantProcedure
      .input(z.object({
        id: z.number(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().optional(),
        phone: z.string().min(1).optional(),
        email: z.string().email().optional().or(z.literal('')),
        dateOfBirth: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        marketingSmsConsent: z.boolean().optional(),
        marketingEmailConsent: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { customers } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        const updateData: any = {};
        if (input.firstName) updateData.firstName = input.firstName;
        if (input.lastName !== undefined) updateData.lastName = input.lastName;
        if (input.phone) updateData.phone = input.phone;
        if (input.email !== undefined) updateData.email = input.email;
        if (input.dateOfBirth !== undefined) updateData.dateOfBirth = input.dateOfBirth;
        if (input.address !== undefined) updateData.address = input.address;
        if (input.notes !== undefined) updateData.notes = input.notes;
        if (input.marketingSmsConsent !== undefined) updateData.marketingSmsConsent = input.marketingSmsConsent;
        if (input.marketingEmailConsent !== undefined) updateData.marketingEmailConsent = input.marketingEmailConsent;

        await dbInstance.update(customers)
          .set(updateData)
          .where(eq(customers.id, input.id));

        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { customers } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        // Soft delete
        await dbInstance.update(customers)
          .set({ deletedAt: new Date() })
          .where(eq(customers.id, input.id));

        return { success: true };
      }),

    // GDPR: Complete data deletion (Right to Erasure)
    gdprDelete: tenantProcedure
      .input(z.object({ 
        customerId: z.number(),
        confirmationCode: z.string().min(1), // Customer must confirm with their phone number
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { customers, appointments, appointmentServices, payments, loyaltyPoints, loyaltyTransactions, loyaltyRedemptions, auditLogs } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Get customer to verify
        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(and(
            eq(customers.id, input.customerId),
            eq(customers.tenantId, ctx.tenantId)
          ))
          .limit(1);

        if (!customer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Kunde ikke funnet" });
        }

        // Verify confirmation code matches phone number (last 4 digits)
        const lastFourDigits = customer.phone.replace(/\D/g, '').slice(-4);
        if (input.confirmationCode !== lastFourDigits) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Feil bekreftelseskode. Bruk de siste 4 sifrene i kundens telefonnummer." });
        }

        // Log the GDPR deletion request before deleting
        await dbInstance.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          action: "gdpr_data_deletion",
          entityType: "customer",
          entityId: input.customerId,
          beforeValue: {
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            email: customer.email,
          },
          afterValue: { deleted: true, reason: input.reason || "GDPR request" },
          ipAddress: ctx.req.ip || null,
          userAgent: ctx.req.headers["user-agent"] || null,
        });

        // Delete loyalty data
        await dbInstance.delete(loyaltyRedemptions)
          .where(eq(loyaltyRedemptions.customerId, input.customerId));
        
        await dbInstance.delete(loyaltyTransactions)
          .where(eq(loyaltyTransactions.customerId, input.customerId));
        
        await dbInstance.delete(loyaltyPoints)
          .where(eq(loyaltyPoints.customerId, input.customerId));

        // Anonymize appointments (keep for business records but remove personal data)
        await dbInstance.update(appointments)
          .set({ 
            notes: "[GDPR - Data slettet]",
          })
          .where(eq(appointments.customerId, input.customerId));

        // Permanently delete customer record
        await dbInstance.delete(customers)
          .where(eq(customers.id, input.customerId));

        return { 
          success: true, 
          message: "Alle kundedata er permanent slettet i henhold til GDPR." 
        };
      }),

    // GDPR: Export customer data (Right to Data Portability)
    gdprExport: tenantProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { customers, appointments, appointmentServices, services, payments, loyaltyPoints, loyaltyTransactions } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Get customer
        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(and(
            eq(customers.id, input.customerId),
            eq(customers.tenantId, ctx.tenantId)
          ))
          .limit(1);

        if (!customer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Kunde ikke funnet" });
        }

        // Get appointments
        const customerAppointments = await dbInstance
          .select()
          .from(appointments)
          .where(eq(appointments.customerId, input.customerId));

        // Get loyalty data
        const [loyalty] = await dbInstance
          .select()
          .from(loyaltyPoints)
          .where(eq(loyaltyPoints.customerId, input.customerId))
          .limit(1);

        const transactions = await dbInstance
          .select()
          .from(loyaltyTransactions)
          .where(eq(loyaltyTransactions.customerId, input.customerId));

        return {
          exportDate: new Date().toISOString(),
          customer: {
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            email: customer.email,
            dateOfBirth: customer.dateOfBirth,
            address: customer.address,
            notes: customer.notes,
            marketingSmsConsent: customer.marketingSmsConsent,
            marketingEmailConsent: customer.marketingEmailConsent,
            consentTimestamp: customer.consentTimestamp,
            createdAt: customer.createdAt,
          },
          appointments: customerAppointments.map(a => ({
            date: a.startTime,
            status: a.status,
            notes: a.notes,
          })),
          loyalty: loyalty ? {
            currentPoints: loyalty.currentPoints,
            lifetimePoints: loyalty.lifetimePoints,
            transactions: transactions.map(t => ({
              type: t.type,
              points: t.points,
              reason: t.reason,
              createdAt: t.createdAt,
            })),
          } : null,
        };
      }),

    getNoShowInfo: tenantProcedure
      .input(z.object({ customerId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenantId } = ctx;
        const noShowCount = await db.getNoShowCountForCustomer(tenantId, input.customerId);

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, tenantId));

        const threshold = tenant?.noShowThresholdForPrepayment ?? 2;

        return {
          customerId: input.customerId,
          noShowCount,
          noShowThresholdForPrepayment: threshold,
          hasReachedThreshold: noShowCount >= threshold,
        };
      }),
  }),

  // ============================================================================
  // SERVICES
  // ============================================================================
  services: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      return db.getServicesByTenant(ctx.tenantId);
    }),

    getById: tenantProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getServiceById(input.id, ctx.tenantId);
      }),

    create: tenantProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        durationMinutes: z.number(),
        price: z.string(), // decimal as string
        categoryId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { services } = await import("../drizzle/schema");
        
        await dbInstance.insert(services).values({
          tenantId: ctx.tenantId,
          name: input.name,
          description: input.description || null,
          durationMinutes: input.durationMinutes,
          price: input.price,
          categoryId: input.categoryId || null,
        });

        return { success: true };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        durationMinutes: z.number().min(5).optional(),
        price: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { services } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        const updateData: any = {};
        if (input.name) updateData.name = input.name;
        if (input.description !== undefined) updateData.description = input.description;
        if (input.durationMinutes) updateData.durationMinutes = input.durationMinutes;
        if (input.price) updateData.price = input.price;
        if (input.isActive !== undefined) updateData.isActive = input.isActive;

        await dbInstance.update(services)
          .set(updateData)
          .where(eq(services.id, input.id));

        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { services } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        // Soft delete by setting isActive to false
        await dbInstance
          .update(services)
          .set({ isActive: false })
          .where(
            and(
              eq(services.id, input.id),
              eq(services.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),
  }),

  // ============================================================================
  // APPOINTMENTS
  // ============================================================================
  appointments: router({
    list: tenantProcedure
      .input(z.object({
        startDate: z.string().transform((val) => new Date(val)),
        endDate: z.string().transform((val) => new Date(val)),
      }))
      .query(async ({ ctx, input }) => {
        return db.getAppointmentsByTenant(ctx.tenantId, input.startDate, input.endDate);
      }),

    getById: tenantProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getAppointmentById(input.id, ctx.tenantId);
      }),

    getToday: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, users, services, appointmentServices } = await import("../drizzle/schema");
        const { eq, and, gte, lt } = await import("drizzle-orm");

        // Get today's date range (00:00:00 to 23:59:59)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Fetch today's appointments with related data
        const todayAppointments = await dbInstance
          .select({
            id: appointments.id,
            appointmentDate: appointments.appointmentDate,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            status: appointments.status,
            notes: appointments.notes,
            customerId: appointments.customerId,
            customerName: customers.firstName,
            employeeId: appointments.employeeId,
            employeeName: users.name,
          })
          .from(appointments)
          .leftJoin(customers, eq(appointments.customerId, customers.id))
          .leftJoin(users, eq(appointments.employeeId, users.id))
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              gte(appointments.appointmentDate, today),
              lt(appointments.appointmentDate, tomorrow)
            )
          )
          .orderBy(appointments.startTime);

        // Fetch services for each appointment
        const appointmentsWithServices = await Promise.all(
          todayAppointments.map(async (apt) => {
            const aptServices = await dbInstance
              .select({
                serviceName: services.name,
              })
              .from(appointmentServices)
              .leftJoin(services, eq(appointmentServices.serviceId, services.id))
              .where(eq(appointmentServices.appointmentId, apt.id));

            return {
              ...apt,
              services: aptServices
                .map(s => s.serviceName)
                .filter((name): name is string => typeof name === 'string' && name.length > 0),
            };
          })
        );

        return appointmentsWithServices;
      }),

    create: tenantProcedure
      .input(z.object({
        customerId: z.number(),
        employeeId: z.number(),
        appointmentDate: z.string(), // YYYY-MM-DD
        startTime: z.string(), // HH:MM:SS
        endTime: z.string(),
        serviceIds: z.array(z.number()),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments, appointmentServices, employeeLeaves, salonHolidays, customers } = await import("../drizzle/schema");
        const { eq, and, lte, gte, or } = await import("drizzle-orm");
        
        const appointmentDate = new Date(input.appointmentDate);
        
        // Check if date is a salon holiday
        const holidays = await dbInstance
          .select()
          .from(salonHolidays)
          .where(
            and(
              eq(salonHolidays.tenantId, ctx.tenantId),
              or(
                eq(salonHolidays.date, appointmentDate),
                and(
                  eq(salonHolidays.isRecurring, true),
                  // Check if month and day match for recurring holidays
                  eq(salonHolidays.date, appointmentDate) // Simplified - in production would check month/day
                )
              )
            )
          );
        
        if (holidays.length > 0) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `Kan ikke booke på helligdag: ${holidays[0].name}` 
          });
        }
        
        // Check if employee is on leave
        const leaves = await dbInstance
          .select()
          .from(employeeLeaves)
          .where(
            and(
              eq(employeeLeaves.employeeId, input.employeeId),
              eq(employeeLeaves.status, "approved"),
              lte(employeeLeaves.startDate, appointmentDate),
              gte(employeeLeaves.endDate, appointmentDate)
            )
          );
        
        if (leaves.length > 0) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `Ansatt er på ferie (${leaves[0].leaveType}). Vennligst velg en annen dato eller ansatt.` 
          });
        }
        
        // Check for conflicting appointments (overlapping time slots for same employee)
        const [year, month, day] = input.appointmentDate.split('-').map(Number);
        const appointmentDateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        
        const conflictingAppointments = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.employeeId, input.employeeId),
              eq(appointments.appointmentDate, appointmentDateObj),
              or(
                eq(appointments.status, "pending"),
                eq(appointments.status, "confirmed")
              ),
              or(
                // New appointment starts during existing appointment
                and(
                  lte(appointments.startTime, input.startTime),
                  gte(appointments.endTime, input.startTime)
                ),
                // New appointment ends during existing appointment
                and(
                  lte(appointments.startTime, input.endTime),
                  gte(appointments.endTime, input.endTime)
                ),
                // New appointment completely contains existing appointment
                and(
                  gte(appointments.startTime, input.startTime),
                  lte(appointments.endTime, input.endTime)
                )
              )
            )
          );
        
        if (conflictingAppointments.length > 0) {
          const conflict = conflictingAppointments[0];
          
          // Get customer name separately
          const customer = await dbInstance
            .select({ firstName: customers.firstName, lastName: customers.lastName })
            .from(customers)
            .where(eq(customers.id, conflict.customerId))
            .limit(1);
          
          const customerName = customer[0] 
            ? `${customer[0].firstName} ${customer[0].lastName || ''}`.trim()
            : "Ukjent kunde";
          
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `APPOINTMENT_CONFLICT`,
            cause: {
              existingAppointment: {
                id: conflict.id,
                customerName,
                startTime: conflict.startTime,
                endTime: conflict.endTime,
              }
            }
          });
        }
        
        // Insert appointment
        // Date already converted above for conflict check
        
        const [appointment] = await dbInstance.insert(appointments).values({
          tenantId: ctx.tenantId,
          customerId: input.customerId,
          employeeId: input.employeeId,
          appointmentDate: appointmentDateObj,
          startTime: input.startTime,
          endTime: input.endTime,
          notes: input.notes || null,
          status: "pending",
        });

        // Get appointment ID
        const appointmentId = appointment.insertId;

        // Insert services
        for (const serviceId of input.serviceIds) {
          const service = await db.getServiceById(serviceId, ctx.tenantId);
          if (service) {
            await dbInstance.insert(appointmentServices).values({
              appointmentId: Number(appointmentId),
              serviceId,
              price: service.price,
            });
          }
        }

        return { success: true, appointmentId };
      }),

    reschedule: tenantProcedure
      .input(z.object({
        id: z.number(),
        newDate: z.string(), // YYYY-MM-DD
        newTime: z.string(), // HH:MM
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        // Get existing appointment to calculate duration
        const existing = await db.getAppointmentById(input.id, ctx.tenantId);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        // Parse time strings (HH:MM format)
        const [startHour, startMin] = existing.startTime.split(":").map(Number);
        const [endHour, endMin] = existing.endTime.split(":").map(Number);
        const durationMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);
        
        // Calculate new end time
        const [newStartHour, newStartMin] = input.newTime.split(":").map(Number);
        const newEndTotalMinutes = newStartHour * 60 + newStartMin + durationMinutes;
        const newEndHour = Math.floor(newEndTotalMinutes / 60);
        const newEndMin = newEndTotalMinutes % 60;
        const newEndTimeStr = `${newEndHour.toString().padStart(2, "0")}:${newEndMin.toString().padStart(2, "0")}`;

        const result = await dbInstance.update(appointments)
          .set({
            appointmentDate: new Date(input.newDate),
            startTime: input.newTime,
            endTime: newEndTimeStr,
          })
          .where(eq(appointments.id, input.id));

        return { success: true, updated: result };
      }),

    updateStatus: tenantProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "confirmed", "completed", "canceled", "no_show"]),
        cancellationReason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { sendAppointmentConfirmationIfPossible, sendAppointmentCancellationIfPossible } = await import("./notifications-appointments");
        
        // Get appointment details before updating
        const appointment = await dbInstance
          .select()
          .from(appointments)
          .where(eq(appointments.id, input.id))
          .limit(1);

        if (!appointment[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        const previousStatus = appointment[0].status;

        const updateData: any = { status: input.status };
        
        // Handle cancellation with late cancellation detection
        if (input.status === "canceled") {
          updateData.canceledAt = new Date();
          updateData.canceledBy = "staff";
          updateData.cancellationReason = input.cancellationReason || null;

          // Check if this is a late cancellation
          const { tenants } = await import("../drizzle/schema");
          const [tenant] = await dbInstance
            .select()
            .from(tenants)
            .where(eq(tenants.id, String(ctx.tenantId)));

          const cancellationWindowHours = tenant?.cancellationWindowHours ?? 24;
          
          // Combine appointmentDate and startTime to get appointment start DateTime
          const appointmentDate = new Date(appointment[0].appointmentDate);
          const [hours, minutes] = String(appointment[0].startTime).split(":").map(Number);
          appointmentDate.setHours(hours, minutes, 0, 0);

          // Calculate the cancellation deadline (appointment start - window hours)
          const cancellationDeadline = new Date(appointmentDate);
          cancellationDeadline.setHours(cancellationDeadline.getHours() - cancellationWindowHours);

          // Check if current time is after the deadline
          const now = new Date();
          updateData.isLateCancellation = now > cancellationDeadline;
        }

        await dbInstance.update(appointments)
          .set(updateData)
          .where(eq(appointments.id, input.id));

        // Send email notifications based on status transitions
        if (previousStatus !== "confirmed" && input.status === "confirmed") {
          // Transitioning TO confirmed → send confirmation email
          sendAppointmentConfirmationIfPossible(input.id, String(ctx.tenantId)).catch((err) => {
            console.error("[Appointments] Failed to send confirmation email:", err);
          });
        } else if (previousStatus !== "canceled" && input.status === "canceled") {
          // Transitioning TO canceled → send cancellation email
          sendAppointmentCancellationIfPossible(input.id, String(ctx.tenantId)).catch((err) => {
            console.error("[Appointments] Failed to send cancellation email:", err);
          });
        }

        // Auto-award loyalty points when appointment is completed
        if (input.status === "completed" && appointment[0]) {
          const { getLoyaltySettings, awardPoints } = await import("./loyalty");
          const settings = await getLoyaltySettings(String(ctx.tenantId));

          if (settings.enabled) {
            // Calculate total amount from appointment services
            const { appointmentServices, services } = await import("../drizzle/schema");
            const appointmentServicesList = await dbInstance
              .select({
                price: services.price,
              })
              .from(appointmentServices)
              .leftJoin(services, eq(appointmentServices.serviceId, services.id))
              .where(eq(appointmentServices.appointmentId, input.id));

            const totalAmount = appointmentServicesList.reduce(
              (sum, item) => sum + parseFloat(String(item.price || 0)),
              0
            );

            const pointsForVisit = settings.pointsPerVisit;
            const pointsForAmount = Math.floor(totalAmount * settings.pointsPerNOK);
            const totalPoints = pointsForVisit + pointsForAmount;

            if (totalPoints > 0) {
              await awardPoints(
                String(ctx.tenantId),
                appointment[0].customerId,
                totalPoints,
                `Fullført avtale #${input.id} (${pointsForVisit} for besøk + ${pointsForAmount} for ${totalAmount.toFixed(0)} NOK)`,
                "appointment",
                input.id,
                ctx.user.id
              );
            }
          }
        }

        return { success: true };
      }),

    // Cancel appointment with refund
    cancelWithRefund: tenantProcedure
      .input(z.object({
        appointmentId: z.number(),
        reason: z.string(),
        cancellationType: z.enum(["customer", "staff", "no_show"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { cancelAppointmentWithRefund } = await import("./cancellation");
        return cancelAppointmentWithRefund(
          input.appointmentId,
          ctx.tenantId,
          ctx.user.id,
          input.reason,
          input.cancellationType
        );
      }),

    // Calculate refund preview
    calculateRefund: tenantProcedure
      .input(z.object({
        appointmentId: z.number(),
        cancellationType: z.enum(["customer", "staff", "no_show"]),
      }))
      .query(async ({ ctx, input }) => {
        const { calculateRefundAmount } = await import("./cancellation");
        return calculateRefundAmount(
          input.appointmentId,
          ctx.tenantId,
          input.cancellationType
        );
      }),

    // Get available slots count per day for calendar
    getAvailableSlotsCount: tenantProcedure
      .input(z.object({
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string(),   // YYYY-MM-DD
        employeeId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments, users, salonSettings } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        // Use default slot duration (30 minutes)
        const slotDuration = 30; // default 30 minutes
        const startHour = 9; // 9 AM
        const endHour = 18;  // 6 PM
        const totalSlotsPerDay = ((endHour - startHour) * 60) / slotDuration;

        // Get all appointments in date range
        const conditions = [
          eq(appointments.tenantId, ctx.tenantId),
          gte(appointments.appointmentDate, new Date(input.startDate)),
          lte(appointments.appointmentDate, new Date(input.endDate)),
        ];

        if (input.employeeId) {
          conditions.push(eq(appointments.employeeId, input.employeeId));
        }

        const bookedAppointments = await dbInstance
          .select({
            date: sql<string>`DATE(appointmentDate)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(appointments)
          .where(and(...conditions))
          .groupBy(sql`DATE(appointmentDate)`);

        // Calculate available slots per day
        const result: Record<string, number> = {};
        const start = new Date(input.startDate);
        const end = new Date(input.endDate);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          const booked = bookedAppointments.find(a => a.date === dateStr);
          const bookedCount = booked ? Number(booked.count) : 0;
          result[dateStr] = Math.max(0, totalSlotsPerDay - bookedCount);
        }

        return result;
      }),

    // Create recurring appointment series
    createRecurring: tenantProcedure
      .input(z.object({
        customerId: z.number(),
        employeeId: z.number(),
        serviceId: z.number(),
        duration: z.number(), // in minutes
        frequency: z.enum(["weekly", "biweekly", "monthly"]),
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string().optional(), // YYYY-MM-DD
        maxOccurrences: z.number().optional(),
        preferredTime: z.string(), // HH:MM
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createRecurringAppointments } = await import("./recurringAppointments");
        
        const result = await createRecurringAppointments({
          tenantId: ctx.tenantId,
          customerId: input.customerId,
          employeeId: input.employeeId,
          serviceId: input.serviceId,
          duration: input.duration,
          pattern: {
            frequency: input.frequency,
            startDate: new Date(input.startDate),
            endDate: input.endDate ? new Date(input.endDate) : undefined,
            maxOccurrences: input.maxOccurrences,
            preferredTime: input.preferredTime,
          },
          notes: input.notes,
        });

        return result;
      }),

    // Get recurring series appointments
    getRecurringSeries: tenantProcedure
      .input(z.object({ ruleId: z.number() }))
      .query(async ({ input }) => {
        const { getRecurringSeriesAppointments } = await import("./recurringAppointments");
        return getRecurringSeriesAppointments(input.ruleId);
      }),

    // Update entire recurring series
    updateRecurringSeries: tenantProcedure
      .input(z.object({
        ruleId: z.number(),
        employeeId: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { updateRecurringSeries } = await import("./recurringAppointments");
        await updateRecurringSeries(input.ruleId, {
          employeeId: input.employeeId,
          notes: input.notes,
        });
        return { success: true };
      }),

    // Cancel entire recurring series
    cancelRecurringSeries: tenantProcedure
      .input(z.object({
        ruleId: z.number(),
        reason: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { cancelRecurringSeries } = await import("./recurringAppointments");
        await cancelRecurringSeries(input.ruleId, input.reason);
        return { success: true };
      }),

    // Delete single occurrence from series
    deleteSingleOccurrence: tenantProcedure
      .input(z.object({
        appointmentId: z.number(),
        reason: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { deleteSingleOccurrence } = await import("./recurringAppointments");
        await deleteSingleOccurrence(input.appointmentId, input.reason);
        return { success: true };
      }),

    // Check if appointment is recurring
    isRecurring: tenantProcedure
      .input(z.object({ appointmentId: z.number() }))
      .query(async ({ input }) => {
        const { isRecurringAppointment } = await import("./recurringAppointments");
        const isRecurring = await isRecurringAppointment(input.appointmentId);
        return { isRecurring };
      }),
  }),

  // ============================================================================
  // REFUNDS
  // ============================================================================
  refunds: router({
    list: tenantProcedure
      .input(z.object({
        appointmentId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getRefundHistory } = await import("./cancellation");
        return getRefundHistory(ctx.tenantId, input.appointmentId);
      }),

    // Manual refund for cash/card terminal payments
    createManual: adminProcedure
      .input(z.object({
        paymentId: z.number(),
        appointmentId: z.number().optional(),
        amount: z.number().positive(),
        reason: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { refunds } = await import("../drizzle/schema");
        
        await dbInstance.insert(refunds).values({
          tenantId: ctx.tenantId,
          paymentId: input.paymentId,
          appointmentId: input.appointmentId || null,
          amount: String(input.amount),
          reason: input.reason,
          refundMethod: "manual",
          status: "completed",
          processedBy: ctx.user.id,
          processedAt: new Date(),
        });

        return { success: true };
      }),

    // Create POS refund (full or partial)
    createPOSRefund: tenantProcedure
      .input(z.object({
        paymentId: z.number(),
        orderId: z.number(),
        amount: z.number().positive(),
        reason: z.string().min(1),
        refundMethod: z.enum(["stripe", "vipps", "manual"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { payments, refunds, orders } = await import("../drizzle/schema");
        const { eq, sum } = await import("drizzle-orm");

        // Get original payment
        const [payment] = await dbInstance
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
          .limit(1);

        if (!payment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
        }

        if (payment.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        const originalAmount = parseFloat(payment.amount);

        // Get existing refunds for this payment
        const existingRefunds = await dbInstance
          .select()
          .from(refunds)
          .where(eq(refunds.paymentId, input.paymentId));

        const totalRefunded = existingRefunds
          .filter((r) => r.status === "completed")
          .reduce((sum, r) => sum + parseFloat(r.amount), 0);

        // Validate refund amount
        if (input.amount > originalAmount - totalRefunded) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Refund amount exceeds available balance. Original: ${originalAmount}, Already refunded: ${totalRefunded}`,
          });
        }

        // Create refund record
        const [refund] = await dbInstance.insert(refunds).values({
          tenantId: ctx.tenantId,
          paymentId: input.paymentId,
          orderId: input.orderId,
          amount: input.amount.toString(),
          reason: input.reason,
          refundMethod: input.refundMethod,
          status: "completed",
          processedBy: ctx.user.id,
          processedAt: new Date(),
        });

        // Update order status if fully refunded
        const newTotalRefunded = totalRefunded + input.amount;
        if (Math.abs(newTotalRefunded - originalAmount) < 0.01) {
          await dbInstance
            .update(orders)
            .set({ status: "refunded" })
            .where(eq(orders.id, input.orderId));
        } else if (newTotalRefunded > 0) {
          await dbInstance
            .update(orders)
            .set({ status: "partially_refunded" })
            .where(eq(orders.id, input.orderId));
        }

        // Update payment status
        if (Math.abs(newTotalRefunded - originalAmount) < 0.01) {
          await dbInstance
            .update(payments)
            .set({ status: "refunded", refundedAt: new Date() })
            .where(eq(payments.id, input.paymentId));
        }

        return {
          success: true,
          refundId: refund.insertId,
          totalRefunded: newTotalRefunded,
          remainingAmount: originalAmount - newTotalRefunded,
        };
      }),

    // Get refunds by order
    getByOrder: tenantProcedure
      .input(z.object({
        orderId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const { getRefundsByOrder } = await import("./db");
        const refunds = await getRefundsByOrder(input.orderId, ctx.tenantId);
        return refunds;
      }),

    // Get refunds by payment
    getByPayment: tenantProcedure
      .input(z.object({
        paymentId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const { getRefundsByPayment } = await import("./db");
        const refunds = await getRefundsByPayment(input.paymentId, ctx.tenantId);
        return refunds;
      }),

    // Get all refunds for tenant
    getAll: tenantProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.enum(["pending", "completed", "failed"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { refunds } = await import("../drizzle/schema");
        const { eq, and, gte, lte, desc } = await import("drizzle-orm");

        const conditions = [eq(refunds.tenantId, ctx.tenantId)];

        if (input.status) {
          conditions.push(eq(refunds.status, input.status));
        }

        if (input.startDate) {
          conditions.push(gte(refunds.createdAt, new Date(input.startDate)));
        }

        if (input.endDate) {
          conditions.push(lte(refunds.createdAt, new Date(input.endDate)));
        }

        return dbInstance
          .select()
          .from(refunds)
          .where(and(...conditions))
          .orderBy(desc(refunds.createdAt));
      }),
  }),

  // ============================================================================
  // LEAVE MANAGEMENT
  // ============================================================================
  leaves: router({
    // Get my leaves (employee)
    myLeaves: tenantProcedure
      .input(z.object({
        status: z.enum(["pending", "approved", "rejected"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { getEmployeeLeaves } = await import("./leave");
        return getEmployeeLeaves(ctx.user.id, ctx.tenantId, input.status);
      }),

    // Get my leave balance (employee)
    myBalance: tenantProcedure.query(async ({ ctx }) => {
      const { getLeaveBalance } = await import("./leave");
      return getLeaveBalance(ctx.user.id, ctx.tenantId);
    }),

    // Create leave request (employee)
    create: tenantProcedure
      .input(z.object({
        leaveType: z.enum(["annual", "sick", "emergency", "unpaid"]),
        startDate: z.date(),
        endDate: z.date(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createLeaveRequest } = await import("./leave");
        return createLeaveRequest(
          ctx.user.id,
          ctx.tenantId,
          input.leaveType,
          input.startDate,
          input.endDate,
          input.reason
        );
      }),

    // Get pending requests (admin)
    pending: adminProcedure.query(async ({ ctx }) => {
      const { getPendingLeaveRequests } = await import("./leave");
      return getPendingLeaveRequests(ctx.tenantId);
    }),

    // Approve/reject leave (admin)
    approve: adminProcedure
      .input(z.object({
        leaveId: z.number(),
        approved: z.boolean(),
        rejectionReason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { approveLeaveRequest } = await import("./leave");
        return approveLeaveRequest(
          input.leaveId,
          ctx.tenantId,
          ctx.user.id,
          input.approved,
          input.rejectionReason
        );
      }),

    // Get leaves for date range (for calendar display)
    getForDateRange: tenantProcedure
      .input(z.object({
        startDate: z.string().transform((val) => new Date(val)),
        endDate: z.string().transform((val) => new Date(val)),
        employeeId: z.number().optional(), // If provided, filter by employee
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];
        
        const { employeeLeaves, users } = await import("../drizzle/schema");
        const { eq, and, lte, gte, or } = await import("drizzle-orm");
        
        const conditions = [
          eq(employeeLeaves.tenantId, ctx.tenantId),
          eq(employeeLeaves.status, "approved"),
          or(
            and(
              lte(employeeLeaves.startDate, input.endDate),
              gte(employeeLeaves.endDate, input.startDate)
            )
          )
        ];
        
        if (input.employeeId) {
          conditions.push(eq(employeeLeaves.employeeId, input.employeeId));
        }
        
        const leaves = await dbInstance
          .select({
            id: employeeLeaves.id,
            employeeId: employeeLeaves.employeeId,
            employeeName: users.name,
            leaveType: employeeLeaves.leaveType,
            startDate: employeeLeaves.startDate,
            endDate: employeeLeaves.endDate,
            reason: employeeLeaves.reason,
          })
          .from(employeeLeaves)
          .leftJoin(users, eq(employeeLeaves.employeeId, users.id))
          .where(and(...conditions));
        
        return leaves;
      }),

    // Check if employee is on leave
    checkAvailability: tenantProcedure
      .input(z.object({
        employeeId: z.number(),
        startDate: z.date(),
        endDate: z.date(),
      }))
      .query(async ({ input }) => {
        const { isEmployeeOnLeave } = await import("./leave");
        const onLeave = await isEmployeeOnLeave(
          input.employeeId,
          input.startDate,
          input.endDate
        );
        return { available: !onLeave, onLeave };
      }),
  }),

  // ============================================================================
  // SALON HOLIDAYS
  // ============================================================================
  holidays: router({
    // List all holidays
    list: tenantProcedure.query(async ({ ctx }) => {
      const { getSalonHolidays } = await import("./leave");
      return getSalonHolidays(ctx.tenantId);
    }),

    // Create holiday (admin)
    create: adminProcedure
      .input(z.object({
        name: z.string(),
        date: z.date(),
        isRecurring: z.boolean().default(false),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createSalonHoliday } = await import("./leave");
        return createSalonHoliday(
          ctx.tenantId,
          input.name,
          input.date,
          input.isRecurring,
          input.description
        );
      }),

    // Delete holiday (admin)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteSalonHoliday } = await import("./leave");
        return deleteSalonHoliday(input.id, ctx.tenantId);
      }),

    // Get holidays for month (for calendar display)
    getForMonth: tenantProcedure
      .input(z.object({
        year: z.number(),
        month: z.number().min(1).max(12),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];
        
        const { salonHolidays } = await import("../drizzle/schema");
        const { eq, and, gte, lte } = await import("drizzle-orm");
        
        // Get start and end of month
        const startOfMonth = new Date(input.year, input.month - 1, 1);
        const endOfMonth = new Date(input.year, input.month, 0);
        
        const holidays = await dbInstance
          .select()
          .from(salonHolidays)
          .where(
            and(
              eq(salonHolidays.tenantId, ctx.tenantId),
              gte(salonHolidays.date, startOfMonth),
              lte(salonHolidays.date, endOfMonth)
            )
          );
        
        return holidays;
      }),

    // Check if date is holiday
    checkDate: tenantProcedure
      .input(z.object({ date: z.date() }))
      .query(async ({ ctx, input }) => {
        const { isSalonHoliday } = await import("./leave");
        const isHoliday = await isSalonHoliday(ctx.tenantId, input.date);
        return { isHoliday };
      }),
  }),

  // ============================================================================
  // EMPLOYEES
  // ============================================================================
  employees: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];

      const { users } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      
      return dbInstance.select().from(users).where(
        and(
          eq(users.tenantId, ctx.tenantId),
          eq(users.isActive, true)
        )
      );
    }),

    create: tenantProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.union([z.string().email(), z.literal("")]).optional(),
        phone: z.string().optional(),
        role: z.enum(["admin", "employee"]),
        commissionType: z.enum(["percentage", "fixed", "tiered"]).optional(),
        commissionRate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { users } = await import("../drizzle/schema");
        
        // Generate a temporary openId for employees not yet registered
        const tempOpenId = `temp_${nanoid()}`;
        
        await dbInstance.insert(users).values({
          tenantId: ctx.tenantId,
          openId: tempOpenId,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          role: input.role,
          commissionType: input.commissionType || "percentage",
          commissionRate: input.commissionRate || null,
          isActive: true, // Set employee as active by default
        });

        return { success: true };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.union([z.string().email(), z.literal("")]).optional(),
        phone: z.string().optional(),
        pin: z.string().length(4).or(z.string().length(5)).or(z.string().length(6)).optional(),
        commissionType: z.enum(["percentage", "fixed", "tiered"]).optional(),
        commissionRate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // If PIN is provided, check it's unique for this tenant
        if (input.pin) {
          const existing = await dbInstance
            .select()
            .from(users)
            .where(
              and(
                eq(users.tenantId, ctx.tenantId),
                eq(users.pin, input.pin)
              )
            )
            .limit(1);

          if (existing.length > 0 && existing[0].id !== input.id) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: "PIN-koden er allerede i bruk av en annen ansatt" 
            });
          }
        }

        const updateData: any = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.email !== undefined) updateData.email = input.email || null;
        if (input.phone !== undefined) updateData.phone = input.phone;
        if (input.pin !== undefined) updateData.pin = input.pin;
        if (input.commissionType !== undefined) updateData.commissionType = input.commissionType;
        if (input.commissionRate !== undefined) updateData.commissionRate = input.commissionRate;

        await dbInstance
          .update(users)
          .set(updateData)
          .where(
            and(
              eq(users.id, input.id),
              eq(users.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    deactivate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        await dbInstance.update(users)
          .set({ 
            isActive: false,
            deactivatedAt: new Date(),
          })
          .where(
            and(
              eq(users.id, input.id),
              eq(users.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    activate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        await dbInstance.update(users)
          .set({ 
            isActive: true,
            deactivatedAt: null,
          })
          .where(
            and(
              eq(users.id, input.id),
              eq(users.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),
  }),

  // ============================================================================
  // PRODUCTS
  // ============================================================================
  products: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];

      const { products } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      
      return dbInstance.select().from(products).where(
        and(
          eq(products.tenantId, ctx.tenantId),
          eq(products.isActive, true)
        )
      );
    }),

    create: tenantProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.string(),
        cost: z.string().optional(),
        barcode: z.string().optional(),
        stockQuantity: z.number().default(0),
        minStockLevel: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { products } = await import("../drizzle/schema");
        const { nanoid } = await import("nanoid");
        
        await dbInstance.insert(products).values({
          tenantId: ctx.tenantId,
          sku: `SKU-${nanoid(8)}`,
          name: input.name,
          description: input.description || null,
          retailPrice: input.price,
          costPrice: input.cost || "0.00",
          barcode: input.barcode || null,
          stockQuantity: input.stockQuantity,
          reorderPoint: input.minStockLevel || 10,
        });

        return { success: true };
      }),

    adjustStock: tenantProcedure
      .input(z.object({
        productId: z.number(),
        adjustment: z.number(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { products } = await import("../drizzle/schema");
        const { eq, sql } = await import("drizzle-orm");
        
        await dbInstance.update(products)
          .set({ 
            stockQuantity: sql`${products.stockQuantity} + ${input.adjustment}`,
          })
          .where(eq(products.id, input.productId));

        return { success: true };
      }),

    update: tenantProcedure
      .input(z.object({
        productId: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        price: z.string().optional(),
        cost: z.string().optional(),
        barcode: z.string().optional(),
        stockQuantity: z.number().optional(),
        minStockLevel: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { products } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        // Verify product belongs to tenant
        const [product] = await dbInstance
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, input.productId),
              eq(products.tenantId, ctx.tenantId)
            )
          )
          .limit(1);

        if (!product) {
          throw new TRPCError({ 
            code: "NOT_FOUND", 
            message: "Product not found" 
          });
        }

        // Check barcode uniqueness if provided and different
        if (input.barcode && input.barcode !== product.barcode) {
          const [existing] = await dbInstance
            .select()
            .from(products)
            .where(
              and(
                eq(products.barcode, input.barcode),
                eq(products.tenantId, ctx.tenantId)
              )
            )
            .limit(1);

          if (existing && existing.id !== input.productId) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: "Barcode already exists for another product" 
            });
          }
        }

        // Build update object with only provided fields
        const updateData: any = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.description !== undefined) updateData.description = input.description || null;
        if (input.price !== undefined) updateData.retailPrice = input.price;
        if (input.cost !== undefined) updateData.costPrice = input.cost;
        if (input.barcode !== undefined) updateData.barcode = input.barcode || null;
        if (input.stockQuantity !== undefined) updateData.stockQuantity = input.stockQuantity;
        if (input.minStockLevel !== undefined) updateData.reorderPoint = input.minStockLevel;

        await dbInstance
          .update(products)
          .set(updateData)
          .where(eq(products.id, input.productId));

        return { success: true };
      }),

    delete: tenantProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { products } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        // Soft delete by setting isActive to false
        await dbInstance
          .update(products)
          .set({ isActive: false })
          .where(
            and(
              eq(products.id, input.productId),
              eq(products.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),
  }),

  // ============================================================================
  // LOYALTY PROGRAM
  // ============================================================================
  loyalty: router({
    // Get customer loyalty points
    getPoints: tenantProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getOrCreateLoyaltyPoints } = await import("./loyalty");
        return await getOrCreateLoyaltyPoints(String(ctx.tenantId), input.customerId);
      }),

    // Get customer loyalty history
    getHistory: tenantProcedure
      .input(z.object({ 
        customerId: z.number(),
        limit: z.number().min(1).max(100).default(50)
      }))
      .query(async ({ ctx, input }) => {
        const { getCustomerLoyaltyHistory } = await import("./loyalty");
        return await getCustomerLoyaltyHistory(String(ctx.tenantId), input.customerId, input.limit);
      }),

    // Get customer active redemptions
    getRedemptions: tenantProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCustomerRedemptions } = await import("./loyalty");
        return await getCustomerRedemptions(String(ctx.tenantId), input.customerId);
      }),

    // Award points manually
    awardPoints: adminProcedure
      .input(z.object({
        customerId: z.number(),
        points: z.number().min(1),
        reason: z.string().min(1).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const { awardPoints } = await import("./loyalty");
        return await awardPoints(
          String(ctx.tenantId),
          input.customerId,
          input.points,
          input.reason,
          "manual",
          undefined,
          ctx.user.id
        );
      }),

    // Deduct points manually
    deductPoints: adminProcedure
      .input(z.object({
        customerId: z.number(),
        points: z.number().min(1),
        reason: z.string().min(1).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const { deductPoints } = await import("./loyalty");
        return await deductPoints(
          String(ctx.tenantId),
          input.customerId,
          input.points,
          input.reason,
          "adjustment",
          "manual",
          undefined,
          ctx.user.id
        );
      }),

    // List available rewards
    listRewards: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { loyaltyRewards } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        return await dbInstance
          .select()
          .from(loyaltyRewards)
          .where(and(
            eq(loyaltyRewards.tenantId, String(ctx.tenantId)),
            eq(loyaltyRewards.isActive, true)
          ));
      }),

    // Create reward
    createReward: adminProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        pointsCost: z.number().min(1),
        discountType: z.enum(["percentage", "fixed_amount"]),
        discountValue: z.string(), // Decimal as string
        validityDays: z.number().min(1).default(30),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { loyaltyRewards } = await import("../drizzle/schema");

        await dbInstance.insert(loyaltyRewards).values({
          tenantId: String(ctx.tenantId),
          name: input.name,
          description: input.description,
          pointsCost: input.pointsCost,
          discountType: input.discountType,
          discountValue: input.discountValue,
          validityDays: input.validityDays,
          isActive: true,
        });

        return { success: true };
      }),

    // Redeem reward
    redeemReward: tenantProcedure
      .input(z.object({
        customerId: z.number(),
        rewardId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { redeemReward } = await import("./loyalty");
        return await redeemReward(
          String(ctx.tenantId),
          input.customerId,
          input.rewardId,
          ctx.user.id
        );
      }),

    // Get loyalty settings
    getSettings: tenantProcedure
      .query(async ({ ctx }) => {
        const { getLoyaltySettings } = await import("./loyalty");
        return await getLoyaltySettings(String(ctx.tenantId));
      }),

    // Update loyalty settings
    updateSettings: adminProcedure
      .input(z.object({
        enabled: z.boolean(),
        pointsPerVisit: z.number().min(0),
        pointsPerNOK: z.number().min(0),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { settings } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Update or insert settings
        const settingsToUpdate = [
          { key: "loyaltyEnabled", value: String(input.enabled) },
          { key: "loyaltyPointsPerVisit", value: String(input.pointsPerVisit) },
          { key: "loyaltyPointsPerNOK", value: String(input.pointsPerNOK) },
        ];

        for (const setting of settingsToUpdate) {
          const existing = await dbInstance
            .select()
            .from(settings)
            .where(and(
              eq(settings.tenantId, String(ctx.tenantId)),
              eq(settings.settingKey, setting.key)
            ))
            .limit(1);

          if (existing.length > 0) {
            await dbInstance
              .update(settings)
              .set({ settingValue: setting.value })
              .where(eq(settings.id, existing[0]!.id));
          } else {
            await dbInstance.insert(settings).values({
              tenantId: String(ctx.tenantId),
              settingKey: setting.key,
              settingValue: setting.value,
            });
          }
        }

        return { success: true };
      }),
  }),

  // ============================================================================
  // EMPLOYEE DASHBOARD
  // ============================================================================
  employee: router({    myAppointments: employeeProcedure
      .input(z.object({
        date: z.string().optional(), // YYYY-MM-DD format, defaults to today
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, customers, services, appointmentServices } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");
        
        const targetDate = input.date || new Date().toISOString().split('T')[0];

        // Get appointments for this employee on the specified date
        const appts = await dbInstance
          .select({
            appointment: appointments,
            customer: customers,
          })
          .from(appointments)
          .leftJoin(customers, eq(appointments.customerId, customers.id))
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.employeeId, ctx.user.id),
              sql`${appointments.appointmentDate} = ${targetDate}`
            )
          )
          .orderBy(appointments.startTime);

        // Get services for each appointment
        const appointmentIds = appts.map(a => a.appointment.id);
        const servicesData = appointmentIds.length > 0
          ? await dbInstance
              .select({
                appointmentId: appointmentServices.appointmentId,
                service: services,
              })
              .from(appointmentServices)
              .leftJoin(services, eq(appointmentServices.serviceId, services.id))
              .where(sql`${appointmentServices.appointmentId} IN (${sql.join(appointmentIds, sql`, `)})`)
          : [];

        // Combine data
        return appts.map(({ appointment, customer }) => ({
          ...appointment,
          customer,
          services: servicesData
            .filter(s => s.appointmentId === appointment.id)
            .map(s => s.service)
            .filter(Boolean),
        }));
      }),

    updateAppointmentStatus: employeeProcedure
      .input(z.object({
        appointmentId: z.number(),
        status: z.enum(["pending", "confirmed", "completed", "canceled", "no_show"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Verify this appointment belongs to this employee
        const existing = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.employeeId, ctx.user.id),
              eq(appointments.tenantId, ctx.tenantId)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        await dbInstance
          .update(appointments)
          .set({ status: input.status })
          .where(eq(appointments.id, input.appointmentId));

        return { success: true };
      }),

    addAppointmentNote: employeeProcedure
      .input(z.object({
        appointmentId: z.number(),
        note: z.string().min(1).max(1000),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { appointments } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Verify this appointment belongs to this employee
        const existing = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.employeeId, ctx.user.id),
              eq(appointments.tenantId, ctx.tenantId)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        // Append note to existing notes
        const currentNotes = existing[0]?.notes || "";
        const timestamp = new Date().toLocaleString("no-NO");
        const newNote = currentNotes
          ? `${currentNotes}\n\n[${timestamp}] ${input.note}`
          : `[${timestamp}] ${input.note}`;

        await dbInstance
          .update(appointments)
          .set({ notes: newNote })
          .where(eq(appointments.id, input.appointmentId));

        return { success: true };
      }),

    // Time Clock endpoints
    clockIn: publicProcedure
      .input(z.object({
        pin: z.string().length(4).or(z.string().length(5)).or(z.string().length(6)),
        tenantId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database ikke tilgjengelig" });

        const { users, timesheets, tenants } = await import("../drizzle/schema");
        const { eq, and, isNull, sql } = await import("drizzle-orm");

        // Get tenant timezone for accurate workDate calculation
        const [tenant] = await dbInstance
          .select({ timezone: tenants.timezone })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        
        const timezone = tenant?.timezone || "Europe/Oslo";

        // Find employee by PIN and tenantId
        // First check if PIN is provided and not empty
        if (!input.pin || input.pin.trim() === '') {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Vennligst skriv inn PIN-kode" });
        }

        const employee = await dbInstance
          .select()
          .from(users)
          .where(
            and(
              eq(users.pin, input.pin),
              eq(users.tenantId, input.tenantId),
              eq(users.isActive, true)
            )
          )
          .limit(1);

        if (employee.length === 0) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Ugyldig PIN-kode. Kontakt administrator for å sette opp PIN." });
        }

        const emp = employee[0];

        // Check if already clocked in (any open shift, regardless of date)
        const existingShiftResult = await dbInstance.execute(
          sql`SELECT * FROM timesheets 
              WHERE employeeId = ${emp.id} 
              AND tenantId = ${input.tenantId} 
              AND clockOut IS NULL 
              LIMIT 1`
        );
        const existingShift = (existingShiftResult[0] as unknown) as any[];

        if (existingShift.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Du er allerede innstemplet. Vennligst stemple ut først." });
        }

        // Calculate workDate in tenant's timezone
        const now = new Date();
        const workDate = now.toLocaleDateString('sv-SE', { timeZone: timezone }); // YYYY-MM-DD format

        // Create new timesheet entry with timezone-aware workDate
        const insertResult = await dbInstance.execute(
          sql`INSERT INTO timesheets (tenantId, employeeId, clockIn, workDate) 
              VALUES (${input.tenantId}, ${emp.id}, NOW(), ${workDate})`
        );

        return { 
          success: true, 
          employeeName: emp.name || "Ansatt",
          clockIn: now.toISOString(),
          workDate: workDate
        };
      }),

    clockOut: publicProcedure
      .input(z.object({
        pin: z.string().length(4).or(z.string().length(5)).or(z.string().length(6)),
        tenantId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database ikke tilgjengelig" });

        const { users, timesheets, tenants } = await import("../drizzle/schema");
        const { eq, and, isNull, sql } = await import("drizzle-orm");

        // First check if PIN is provided and not empty
        if (!input.pin || input.pin.trim() === '') {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Vennligst skriv inn PIN-kode" });
        }

        // Find employee by PIN and tenantId
        const employee = await dbInstance
          .select()
          .from(users)
          .where(
            and(
              eq(users.pin, input.pin),
              eq(users.tenantId, input.tenantId),
              eq(users.isActive, true)
            )
          )
          .limit(1);

        if (employee.length === 0) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Ugyldig PIN-kode. Kontakt administrator for å sette opp PIN." });
        }

        const emp = employee[0];

        // Find active shift (any date - employee may have forgotten to clock out yesterday)
        const activeShiftResult = await dbInstance.execute(
          sql`SELECT id, clockIn FROM timesheets 
              WHERE employeeId = ${emp.id} 
              AND tenantId = ${input.tenantId} 
              AND clockOut IS NULL 
              ORDER BY clockIn DESC
              LIMIT 1`
        );
        const activeShift = (activeShiftResult[0] as unknown) as any[];

        if (activeShift.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ingen aktiv innstemplingstid funnet. Vennligst stemple inn først." });
        }

        const shift = activeShift[0] as any;

        // Calculate shift length for validation
        const clockInTime = new Date(shift.clockIn);
        const now = new Date();
        const shiftHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

        // Warn if shift is longer than 16 hours (likely forgot to clock out)
        let warning = null;
        if (shiftHours > 16) {
          warning = `Advarsel: Vakt på ${shiftHours.toFixed(1)} timer. Glemte du å stemple ut tidligere?`;
        }

        // Update timesheet with clock out time and calculate hours using SQL
        await dbInstance.execute(
          sql`UPDATE timesheets 
              SET clockOut = NOW(),
                  totalHours = ROUND(TIMESTAMPDIFF(SECOND, clockIn, NOW()) / 3600, 2)
              WHERE id = ${shift.id}`
        );

        // Fetch updated record to get accurate values
        const updatedResult = await dbInstance.execute(
          sql`SELECT clockOut, totalHours FROM timesheets WHERE id = ${shift.id}`
        );
        const updated = (updatedResult[0] as unknown as any[])[0] as any;

        return { 
          success: true,
          employeeName: emp.name || "Ansatt",
          clockOut: new Date(updated.clockOut).toISOString(),
          totalHours: parseFloat(updated.totalHours || "0"),
          warning: warning
        };
      }),

    getMyTimesheet: employeeProcedure
      .input(z.object({
        date: z.string().optional(), // YYYY-MM-DD
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { timesheets } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const targetDate = input.date || new Date().toISOString().split('T')[0];

        const shifts = await dbInstance
          .select()
          .from(timesheets)
          .where(
            and(
              eq(timesheets.employeeId, ctx.user.id),
              eq(timesheets.tenantId, ctx.tenantId),
              sql`${timesheets.workDate} = ${targetDate}`
            )
          )
          .orderBy(desc(timesheets.clockIn));

        return shifts[0] || null;
      }),

    getMyPerformance: employeeProcedure
      .input(z.object({
        date: z.string().optional(), // YYYY-MM-DD
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return { servicesCount: 0, salesAmount: 0 };

        const { appointments, orders } = await import("../drizzle/schema");
        const { eq, and, sql, sum } = await import("drizzle-orm");

        const targetDate = input.date || new Date().toISOString().split('T')[0];

        // Count completed appointments
        const appts = await dbInstance
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(
            and(
              eq(appointments.employeeId, ctx.user.id),
              eq(appointments.tenantId, ctx.tenantId),
              sql`${appointments.appointmentDate} = ${targetDate}`,
              eq(appointments.status, "completed")
            )
          );

        // Sum sales amount
        const sales = await dbInstance
          .select({ total: sum(orders.total) })
          .from(orders)
          .where(
            and(
              eq(orders.employeeId, ctx.user.id),
              eq(orders.tenantId, ctx.tenantId),
              sql`${orders.orderDate} = ${targetDate}`
            )
          );

        return {
          servicesCount: Number(appts[0]?.count || 0),
          salesAmount: parseFloat(sales[0]?.total || "0")
        };
      }),

    // Get currently clocked-in employees (for Time Clock display)
    getActiveEmployees: publicProcedure
      .input(z.object({
        tenantId: z.string(),
      }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { users, timesheets } = await import("../drizzle/schema");
        const { eq, and, isNull, desc } = await import("drizzle-orm");

        // Find all active shifts (clockIn exists, clockOut is null)
        const activeShifts = await dbInstance
          .select({
            id: timesheets.id,
            employeeId: timesheets.employeeId,
            employeeName: users.name,
            clockIn: timesheets.clockIn,
            workDate: timesheets.workDate,
          })
          .from(timesheets)
          .innerJoin(users, eq(timesheets.employeeId, users.id))
          .where(
            and(
              eq(timesheets.tenantId, input.tenantId),
              isNull(timesheets.clockOut)
            )
          )
          .orderBy(desc(timesheets.clockIn));

        return activeShifts.map((shift: any) => ({
          id: shift.id,
          employeeId: shift.employeeId,
          employeeName: shift.employeeName || "Ansatt",
          clockIn: shift.clockIn,
          workDate: shift.workDate,
        }));
      }),

    // Admin: Get all active shifts with employee details
    adminGetAllActiveShifts: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { users, timesheets } = await import("../drizzle/schema");
        const { eq, and, isNull, desc, sql } = await import("drizzle-orm");

        // Find all active shifts for this tenant with employee details
        const activeShifts = await dbInstance
          .select({
            id: timesheets.id,
            employeeId: timesheets.employeeId,
            employeeName: users.name,
            employeePhone: users.phone,
            clockIn: timesheets.clockIn,
            workDate: timesheets.workDate,
          })
          .from(timesheets)
          .innerJoin(users, eq(timesheets.employeeId, users.id))
          .where(
            and(
              eq(timesheets.tenantId, ctx.tenantId),
              isNull(timesheets.clockOut)
            )
          )
          .orderBy(desc(timesheets.clockIn));

        return activeShifts.map((shift: any) => ({
          id: shift.id,
          employeeId: shift.employeeId,
          employeeName: shift.employeeName || "Ansatt",
          employeePhone: shift.employeePhone,
          clockIn: shift.clockIn,
          workDate: shift.workDate,
        }));
      }),

    // Admin: Manually clock out a specific employee
    adminClockOut: adminProcedure
      .input(z.object({
        timesheetId: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database ikke tilgjengelig" });

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, isNull, sql } = await import("drizzle-orm");

        // Get timesheet details
        const [timesheet] = await dbInstance
          .select({
            id: timesheets.id,
            employeeId: timesheets.employeeId,
            clockIn: timesheets.clockIn,
            tenantId: timesheets.tenantId,
          })
          .from(timesheets)
          .where(
            and(
              eq(timesheets.id, input.timesheetId),
              eq(timesheets.tenantId, ctx.tenantId),
              isNull(timesheets.clockOut)
            )
          )
          .limit(1);

        if (!timesheet) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ingen aktiv vakt funnet" });
        }

        // Get employee name
        const [employee] = await dbInstance
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, timesheet.employeeId))
          .limit(1);

        // Calculate shift length for validation
        const clockInTime = new Date(timesheet.clockIn);
        const now = new Date();
        const shiftHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

        // Warn if shift is longer than 16 hours
        let warning = null;
        if (shiftHours > 16) {
          warning = `Advarsel: Vakt på ${shiftHours.toFixed(1)} timer`;
        }

        // Clock out with admin note
        const adminNote = input.reason 
          ? `Manuelt utstemplet av admin: ${input.reason}`
          : "Manuelt utstemplet av admin";

        await dbInstance.execute(
          sql`UPDATE timesheets 
              SET clockOut = NOW(),
                  totalHours = ROUND(TIMESTAMPDIFF(SECOND, clockIn, NOW()) / 3600, 2),
                  notes = CONCAT(COALESCE(notes, ''), '\n', ${adminNote})
              WHERE id = ${input.timesheetId}`
        );

        // Fetch updated record
        const result = await dbInstance.execute(
          sql`SELECT clockOut, totalHours FROM timesheets WHERE id = ${input.timesheetId}`
        );
        const updatedData = (result as any[])[0];

        return {
          success: true,
          employeeName: employee?.name || "Ansatt",
          clockOut: new Date(updatedData.clockOut).toISOString(),
          totalHours: parseFloat(updatedData.totalHours || "0"),
          warning: warning,
        };
      }),

    // Admin: Clock out all active employees (for end of day)
    adminClockOutAll: adminProcedure
      .input(z.object({
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database ikke tilgjengelig" });

        const { sql } = await import("drizzle-orm");

        const adminNote = input.reason
          ? `Manuelt utstemplet av admin: ${input.reason}`
          : "Manuelt utstemplet av admin (slutt på dagen)";

        // Clock out all employees with open shifts
        const result = await dbInstance.execute(
          sql`UPDATE timesheets 
              SET clockOut = NOW(),
                  totalHours = ROUND(TIMESTAMPDIFF(SECOND, clockIn, NOW()) / 3600, 2),
                  notes = CONCAT(COALESCE(notes, ''), '\n', ${adminNote})
              WHERE tenantId = ${ctx.tenantId} 
              AND clockOut IS NULL`
        );

        const affectedRows = (result as any).rowsAffected || 0;

        return {
          success: true,
          clockedOut: affectedRows,
          message: `${affectedRows} ansatte stemplet ut`,
        };
      }),

    // Clock out all active employees (for end of day or manual intervention)
    clockOutAll: publicProcedure
      .input(z.object({
        tenantId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { sql } = await import("drizzle-orm");

        // Clock out all employees with open shifts
        const result = await dbInstance.execute(
          sql`UPDATE timesheets 
              SET clockOut = NOW(),
                  totalHours = TIMESTAMPDIFF(SECOND, clockIn, NOW()) / 3600
              WHERE tenantId = ${input.tenantId} 
              AND clockOut IS NULL`
        );

        const affectedRows = (result as any).rowsAffected || 0;

        return { 
          success: true, 
          clockedOut: affectedRows,
          message: `${affectedRows} ansatte stemplet ut`
        };
      }),
  }),

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================
  notifications: router({
    list: tenantProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
        status: z.enum(["pending", "sent", "delivered", "failed"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { notifications } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        
        const conditions = [eq(notifications.tenantId, ctx.tenantId)];
        if (input.status) {
          conditions.push(eq(notifications.status, input.status));
        }

        return dbInstance
          .select()
          .from(notifications)
          .where(and(...conditions))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit);
      }),

    triggerReminders: adminProcedure
      .mutation(async () => {
        const { triggerReminderCheck } = await import("./notificationScheduler");
        const result = await triggerReminderCheck();
        return result;
      }),

    // Get notification statistics
    getStats: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { notifications } = await import("../drizzle/schema");
        const { eq, count } = await import("drizzle-orm");

        // Total notifications by status
        const stats = await dbInstance
          .select({
            status: notifications.status,
            count: count(),
          })
          .from(notifications)
          .where(eq(notifications.tenantId, ctx.tenantId))
          .groupBy(notifications.status);

        // Recent notifications (last 50)
        const recent = await dbInstance
          .select()
          .from(notifications)
          .where(eq(notifications.tenantId, ctx.tenantId))
          .orderBy(desc(notifications.createdAt))
          .limit(50);

        return {
          stats,
          recent,
        };
      }),

    // Manually trigger email scheduler (for testing)
    triggerEmailScheduler: adminProcedure
      .mutation(async ({ ctx }) => {
        const { runEmailScheduler } = await import("./emailScheduler");
        await runEmailScheduler();
        return { success: true };
      }),
  }),

  // ============================================================================
  // FINANCIAL REPORTS
  // ============================================================================
  financial: router({
    // Create expense
    createExpense: adminProcedure
      .input(z.object({
        category: z.enum(["rent", "utilities", "supplies", "salaries", "marketing", "maintenance", "insurance", "taxes", "other"]),
        amount: z.string(),
        description: z.string().optional(),
        expenseDate: z.string(),
        receiptUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { expenses } = await import("../drizzle/schema");
        await dbInstance.insert(expenses).values({
          tenantId: String(ctx.tenantId),
          category: input.category,
          amount: input.amount,
          description: input.description || null,
          expenseDate: new Date(input.expenseDate),
          receiptUrl: input.receiptUrl || null,
          createdBy: ctx.user.id,
        });
        return { success: true };
      }),

    // List expenses
    listExpenses: tenantProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        category: z.enum(["rent", "utilities", "supplies", "salaries", "marketing", "maintenance", "insurance", "taxes", "other"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { expenses } = await import("../drizzle/schema");
        const conditions = [eq(expenses.tenantId, String(ctx.tenantId))];
        if (input.startDate) conditions.push(gte(expenses.expenseDate, new Date(input.startDate)));
        if (input.endDate) conditions.push(lte(expenses.expenseDate, new Date(input.endDate)));
        if (input.category) conditions.push(eq(expenses.category, input.category));
        return await dbInstance.select().from(expenses).where(and(...conditions)).orderBy(desc(expenses.expenseDate)).limit(input.limit);
      }),

    // Delete expense
    deleteExpense: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { expenses } = await import("../drizzle/schema");
        await dbInstance.delete(expenses).where(and(eq(expenses.id, input.id), eq(expenses.tenantId, String(ctx.tenantId))));
        return { success: true };
      }),

    // Get financial summary
    getSummary: tenantProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { appointments, appointmentServices, services, expenses } = await import("../drizzle/schema");
        const revenueResult = await dbInstance.select({ total: sql<string>`COALESCE(SUM(CAST(${services.price} AS DECIMAL(10,2))), 0)` })
          .from(appointments).innerJoin(appointmentServices, eq(appointments.id, appointmentServices.appointmentId))
          .innerJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(and(eq(appointments.tenantId, String(ctx.tenantId)), eq(appointments.status, "completed"),
            gte(appointments.appointmentDate, new Date(input.startDate)), lte(appointments.appointmentDate, new Date(input.endDate))));
        const revenue = parseFloat(revenueResult[0]?.total || "0");
        const expensesResult = await dbInstance.select({ total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS DECIMAL(10,2))), 0)` })
          .from(expenses).where(and(eq(expenses.tenantId, String(ctx.tenantId)),
            gte(expenses.expenseDate, new Date(input.startDate)), lte(expenses.expenseDate, new Date(input.endDate))));
        const totalExpenses = parseFloat(expensesResult[0]?.total || "0");
        return { revenue, expenses: totalExpenses, profit: revenue - totalExpenses, profitMargin: revenue > 0 ? ((revenue - totalExpenses) / revenue) * 100 : 0 };
      }),

    // Get expense breakdown by category
    getExpensesByCategory: tenantProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { expenses } = await import("../drizzle/schema");
        return await dbInstance.select({
          category: expenses.category,
          count: sql<number>`COUNT(*)`,
          total: sql<string>`SUM(CAST(${expenses.amount} AS DECIMAL(10,2)))`,
        }).from(expenses).where(and(eq(expenses.tenantId, String(ctx.tenantId)),
          gte(expenses.expenseDate, new Date(input.startDate)), lte(expenses.expenseDate, new Date(input.endDate))))
          .groupBy(expenses.category).orderBy(desc(sql`SUM(CAST(${expenses.amount} AS DECIMAL(10,2)))`));
      }),
  }),

  // ============================================================================
  // ADVANCED FINANCIAL REPORTS
  // ============================================================================
  financialReports: router({    
    // Sales by employee with detailed breakdown
    salesByEmployee: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string(),
        paymentMethod: z.enum(["all", "cash", "card", "stripe", "vipps"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders, users } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const conditions = [
          eq(orders.tenantId, ctx.tenantId),
          eq(orders.status, "completed"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`,
        ];

        // Note: paymentMethod filter removed as orders table doesn't have this column
        // Payment method is stored in payments table, not orders table

        const result = await dbInstance
          .select({
            employeeId: orders.employeeId,
            employeeName: users.name,
            orderCount: sql<number>`COUNT(DISTINCT ${orders.id})`,
            totalRevenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
            averageOrderValue: sql<string>`COALESCE(AVG(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orders)
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(and(...conditions))
          .groupBy(orders.employeeId, users.name)
          .orderBy(sql`SUM(CAST(${orders.total} AS DECIMAL(10,2))) DESC`);

        return result;
      }),

    // Sales by service from orders
    salesByService: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string() 
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders, orderItems, services } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            serviceId: services.id,
            serviceName: services.name,
            itemCount: sql<number>`COUNT(*)`,
            totalRevenue: sql<string>`COALESCE(SUM(CAST(${orderItems.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orderItems)
          .leftJoin(services, eq(orderItems.itemId, services.id))
          .leftJoin(orders, eq(orderItems.orderId, orders.id))
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "completed"),
              eq(orderItems.itemType, "service"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`
            )
          )
          .groupBy(services.id, services.name)
          .orderBy(sql`SUM(CAST(${orderItems.total} AS DECIMAL(10,2))) DESC`);

        return result;
      }),

    // Revenue trends by period (daily/weekly/monthly)
    revenueTrends: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string(),
        period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        let dateFormat: string;
        switch (input.period) {
          case "weekly":
            dateFormat = "YEARWEEK(orderDate, 1)";
            break;
          case "monthly":
            dateFormat = "DATE_FORMAT(orderDate, '%Y-%m')";
            break;
          default:
            dateFormat = "CAST(orderDate AS DATE)";
        }

        const result = await dbInstance
          .select({
            period: sql<string>`${sql.raw(dateFormat)}`,
            revenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
            orderCount: sql<number>`COUNT(*)`,
            averageOrderValue: sql<string>`COALESCE(AVG(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "completed"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`
            )
          )
          .groupBy(sql.raw(dateFormat))
          .orderBy(sql.raw(dateFormat));

        return result;
      }),

    // Top performing employees
    topPerformers: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string(),
        limit: z.number().min(1).max(20).default(10),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders, users } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            employeeId: orders.employeeId,
            employeeName: users.name,
            totalRevenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
            orderCount: sql<number>`COUNT(*)`,
            averageOrderValue: sql<string>`COALESCE(AVG(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orders)
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "completed"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`
            )
          )
          .groupBy(orders.employeeId, users.name)
          .orderBy(sql`SUM(CAST(${orders.total} AS DECIMAL(10,2))) DESC`)
          .limit(input.limit);

        return result;
      }),

    // Top selling services
    topServices: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string(),
        limit: z.number().min(1).max(20).default(10),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders, orderItems, services } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            serviceId: services.id,
            serviceName: services.name,
            bookingCount: sql<number>`COUNT(*)`,
            totalRevenue: sql<string>`COALESCE(SUM(CAST(${orderItems.total} AS DECIMAL(10,2))), 0)`,
            averagePrice: sql<string>`COALESCE(AVG(CAST(${orderItems.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orderItems)
          .leftJoin(services, eq(orderItems.itemId, services.id))
          .leftJoin(orders, eq(orderItems.orderId, orders.id))
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "completed"),
              eq(orderItems.itemType, "service"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`
            )
          )
          .groupBy(services.id, services.name)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(input.limit);

        return result;
      }),

    // Detailed orders list for export
    detailedOrdersList: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string(),
        employeeId: z.number().optional(),
        serviceId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { orders, orderItems, users, services, customers } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const conditions = [
          eq(orders.tenantId, ctx.tenantId),
          eq(orders.status, "completed"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`,
        ];

        if (input.employeeId) {
          conditions.push(eq(orders.employeeId, input.employeeId));
        }

        // Get orders with customer and employee info
        const ordersData = await dbInstance
          .select({
            orderId: orders.id,
            orderDate: orders.orderDate,
            customerId: orders.customerId,
            customerName: sql<string>`CONCAT(${customers.firstName}, ' ', COALESCE(${customers.lastName}, ''))`,
            employeeId: orders.employeeId,
            employeeName: sql<string>`${users.name}`,
            total: orders.total,
            // paymentMethod is in payments table, not orders table
            paymentMethod: sql<string>`NULL`,
          })
          .from(orders)
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(and(...conditions))
          .orderBy(orders.orderDate);

        // Get order items for each order
        const orderIds = ordersData.map(o => o.orderId);
        if (orderIds.length === 0) return [];

        const { inArray } = await import("drizzle-orm");
        const itemsData = await dbInstance
          .select({
            orderId: orderItems.orderId,
            itemType: orderItems.itemType,
            itemId: orderItems.itemId,
            serviceName: services.name,
            quantity: orderItems.quantity,
            price: orderItems.unitPrice,
            total: orderItems.total,
          })
          .from(orderItems)
          .leftJoin(services, and(
            eq(orderItems.itemId, services.id),
            eq(orderItems.itemType, "service")
          ))
          .where(inArray(orderItems.orderId, orderIds));

        // Combine orders with their items
        const result = ordersData.map(order => {
          const items = itemsData.filter(item => item.orderId === order.orderId);
          const serviceNames = items
            .filter(item => item.itemType === "service" && item.serviceName)
            .map(item => item.serviceName)
            .join(", ");

          return {
            ...order,
            serviceName: serviceNames || "Diverse",
            items,
          };
        });

        // Apply service filter if specified
        if (input.serviceId) {
          return result.filter(order => 
            order.items.some(item => 
              item.itemType === "service" && item.itemId === input.serviceId
            )
          );
        }

        return result;
      }),

    // Overall summary statistics
    getSummary: tenantProcedure
      .input(z.object({ 
        startDate: z.string(), 
        endDate: z.string() 
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { orders } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const [summary] = await dbInstance
          .select({
            totalRevenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
            totalOrders: sql<number>`COUNT(*)`,
            averageOrderValue: sql<string>`COALESCE(AVG(CAST(${orders.total} AS DECIMAL(10,2))), 0)`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "completed"),
              sql`${orders.orderDate} >= ${input.startDate}`,
              sql`${orders.orderDate} <= ${input.endDate}`
            )
          );

        return summary || { totalRevenue: "0", totalOrders: 0, averageOrderValue: "0" };
      }),
  }),

  // ============================================================================
  // PUBLIC BOOKING
  // ============================================================================
  publicBooking: router({
    // Get tenant ID from subdomain or direct ID
    getTenantBySubdomain: publicProcedure
      .input(z.object({ subdomain: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { tenants } = await import("../drizzle/schema");
        const { eq, or } = await import("drizzle-orm");

        // Search by subdomain OR by ID (to support both ?tenantId=xxx and subdomain.domain.com)
        const [tenant] = await dbInstance
          .select({
            id: tenants.id,
            subdomain: tenants.subdomain,
            name: tenants.name,
          })
          .from(tenants)
          .where(
            or(
              eq(tenants.subdomain, input.subdomain),
              eq(tenants.id, input.subdomain)
            )
          )
          .limit(1);

        return tenant || null;
      }),

    getBranding: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          return {
            logoUrl: null,
            primaryColor: "#2563eb",
            accentColor: "#ea580c",
            welcomeTitle: "Velkommen!",
            welcomeSubtitle: "Bestill din time på nett.",
            showStaffSection: true,
            showSummaryCard: true,
          };
        }

        const { salonSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [settings] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, input.tenantId));

        if (!settings || !settings.bookingBranding) {
          return {
            logoUrl: null,
            primaryColor: "#2563eb",
            accentColor: "#ea580c",
            welcomeTitle: "Velkommen!",
            welcomeSubtitle: "Bestill din time på nett.",
            showStaffSection: true,
            showSummaryCard: true,
          };
        }

        return settings.bookingBranding as any;
      }),

    getSalonInfo: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [salon] = await dbInstance
          .select({
            id: tenants.id,
            name: tenants.name,
            phone: tenants.phone,
            email: tenants.email,
            address: tenants.address,
            logoUrl: tenants.logoUrl,
            primaryColor: tenants.primaryColor,
          })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        return salon || null;
      }),

    getAvailableServices: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { services } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            id: services.id,
            name: services.name,
            description: services.description,
            durationMinutes: services.durationMinutes,
            price: services.price,
          })
          .from(services)
          .where(
            and(
              eq(services.tenantId, input.tenantId),
              eq(services.isActive, true)
            )
          );

        return result;
      }),

    getAvailableEmployees: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            id: users.id,
            name: users.name,
          })
          .from(users)
          .where(
            and(
              eq(users.tenantId, input.tenantId),
              eq(users.role, "employee"),
              eq(users.isActive, true)
            )
          );

        return result;
      }),

    getAvailableTimeSlots: publicProcedure
      .input(
        z.object({
          tenantId: z.string(),
          date: z.string(),
          serviceId: z.number(),
          employeeId: z.number().optional(),
        })
      )
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, services, users, employeeLeaves } = await import("../drizzle/schema");
        const { eq, and, lte, gte, inArray } = await import("drizzle-orm");

        // Get service duration
        const [service] = await dbInstance
          .select({ durationMinutes: services.durationMinutes })
          .from(services)
          .where(eq(services.id, input.serviceId));

        if (!service) return [];

        // Get employees to check (either specified or all active)
        let employeeIds: number[];
        if (input.employeeId) {
          employeeIds = [input.employeeId];
        } else {
          const employees = await dbInstance
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.tenantId, input.tenantId),
                eq(users.role, "employee"),
                eq(users.isActive, true)
              )
            );
          employeeIds = employees.map((e) => e.id);
        }

        // Get approved employee leaves that overlap with the requested date
        const requestedDate = new Date(input.date);
        const approvedLeaves = employeeIds.length > 0 ? await dbInstance
          .select({
            employeeId: employeeLeaves.employeeId,
            startDate: employeeLeaves.startDate,
            endDate: employeeLeaves.endDate,
          })
          .from(employeeLeaves)
          .where(
            and(
              eq(employeeLeaves.tenantId, input.tenantId),
              eq(employeeLeaves.status, "approved"),
              lte(employeeLeaves.startDate, requestedDate),
              gte(employeeLeaves.endDate, requestedDate),
              inArray(employeeLeaves.employeeId, employeeIds)
            )
          ) : [];

        // Filter out employees who are on leave
        const employeesOnLeave = new Set(approvedLeaves.map(l => l.employeeId));
        const availableEmployeeIds = employeeIds.filter(id => !employeesOnLeave.has(id));

        // If no employees available (all on leave), return empty slots
        if (availableEmployeeIds.length === 0) {
          return [];
        }

        // Get existing appointments for the date
        const existingAppointments = await dbInstance
          .select({
            employeeId: appointments.employeeId,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.appointmentDate, new Date(input.date))
            )
          );

        // Generate time slots (8:00 - 20:00, 30-minute intervals)
        const slots: { time: string; available: boolean; employeeId?: number }[] = [];
        const startHour = 8;
        const endHour = 20;

        for (let hour = startHour; hour < endHour; hour++) {
          for (let minute = 0; minute < 60; minute += 30) {
            const timeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;
            
            // Calculate end time based on service duration
            const startMinutes = hour * 60 + minute;
            const endMinutes = startMinutes + service.durationMinutes;
            const endHour = Math.floor(endMinutes / 60);
            const endMinute = endMinutes % 60;
            const endTimeStr = `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}:00`;

            // Check if any employee is available (excluding those on leave)
            let availableEmployeeId: number | undefined;
            for (const empId of availableEmployeeIds) {
              const hasConflict = existingAppointments.some((appt) => {
                if (appt.employeeId !== empId) return false;
                // Check for time overlap
                return (
                  (timeStr >= appt.startTime && timeStr < appt.endTime) ||
                  (endTimeStr > appt.startTime && endTimeStr <= appt.endTime) ||
                  (timeStr <= appt.startTime && endTimeStr >= appt.endTime)
                );
              });

              if (!hasConflict) {
                availableEmployeeId = empId;
                break;
              }
            }

            if (availableEmployeeId) {
              slots.push({
                time: timeStr,
                available: true,
                employeeId: availableEmployeeId,
              });
            }
          }
        }

        return slots;
      }),

    createBooking: publicProcedure
      .input(
        z.object({
          tenantId: z.string(),
          serviceId: z.number(),
          employeeId: z.number(),
          date: z.string(),
          time: z.string(),
          customerInfo: z.object({
            firstName: z.string(),
            lastName: z.string().optional(),
            phone: z.string(),
            email: z.string().email().optional(),
          }),
        })
      )
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new Error("Database not available");

        const { customers, appointments, services, appointmentServices } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Get service details
        const [service] = await dbInstance
          .select({
            id: services.id,
            durationMinutes: services.durationMinutes,
            price: services.price,
          })
          .from(services)
          .where(eq(services.id, input.serviceId));

        if (!service) throw new Error("Service not found");

        // Calculate end time
        const [hours, minutes] = input.time.split(":").map(Number);
        const startMinutes = hours * 60 + minutes;
        const endMinutes = startMinutes + service.durationMinutes;
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        const endTime = `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}:00`;

        // Check or create customer
        let customerId: number;
        const [existingCustomer] = await dbInstance
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.phone, input.customerInfo.phone)
            )
          );

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const [newCustomer] = await dbInstance
            .insert(customers)
            .values({
              tenantId: input.tenantId,
              firstName: input.customerInfo.firstName,
              lastName: input.customerInfo.lastName || "",
              phone: input.customerInfo.phone,
              email: input.customerInfo.email || null,
            });
          customerId = newCustomer.insertId;
        }

        // Generate unique management token
        const managementToken = nanoid(32);

        // Create appointment
        const [appointment] = await dbInstance.insert(appointments).values({
          tenantId: input.tenantId,
          customerId,
          employeeId: input.employeeId,
          appointmentDate: new Date(input.date),
          startTime: input.time,
          endTime,
          status: "pending",
          managementToken,
        });

        const appointmentId = appointment.insertId;

        // Link service to appointment
        await dbInstance.insert(appointmentServices).values({
          appointmentId,
          serviceId: service.id,
          price: service.price,
        });

        return {
          success: true,
          appointmentId,
          customerId,
          managementToken,
        };
      }),

    /**
     * Combined endpoint: Create booking + Start Stripe Checkout
     * 
     * This endpoint combines the booking creation and payment checkout flow:
     * 1. Creates the appointment (status: "pending")
     * 2. Creates a Stripe Checkout Session
     * 3. Returns the checkout URL for frontend redirect
     * 4. When payment completes, webhook updates appointment to "confirmed"
     */
    createBookingAndStartPayment: publicProcedure
      .input(
        z.object({
          tenantId: z.string(),
          serviceId: z.number(),
          employeeId: z.number(),
          date: z.string(),
          time: z.string(),
          customerInfo: z.object({
            firstName: z.string(),
            lastName: z.string().optional(),
            phone: z.string(),
            email: z.string().email().optional(),
          }),
          successUrl: z.string().url(),
          cancelUrl: z.string().url(),
        })
      )
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { customers, appointments, services, appointmentServices } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // ========================================
        // STEP 1: Create the booking (same logic as createBooking)
        // ========================================

        // Get service details
        const [service] = await dbInstance
          .select({
            id: services.id,
            durationMinutes: services.durationMinutes,
            price: services.price,
          })
          .from(services)
          .where(eq(services.id, input.serviceId));

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
        }

        // Calculate end time
        const [hours, minutes] = input.time.split(":").map(Number);
        const startMinutes = hours * 60 + minutes;
        const endMinutes = startMinutes + service.durationMinutes;
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        const endTime = `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}:00`;

        // Check or create customer
        let customerId: number;
        const [existingCustomer] = await dbInstance
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.phone, input.customerInfo.phone)
            )
          );

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const [newCustomer] = await dbInstance
            .insert(customers)
            .values({
              tenantId: input.tenantId,
              firstName: input.customerInfo.firstName,
              lastName: input.customerInfo.lastName || "",
              phone: input.customerInfo.phone,
              email: input.customerInfo.email || null,
            });
          customerId = newCustomer.insertId;
        }

        // Generate unique management token
        const managementToken = nanoid(32);

        // Create appointment
        const [appointment] = await dbInstance.insert(appointments).values({
          tenantId: input.tenantId,
          customerId,
          employeeId: input.employeeId,
          appointmentDate: new Date(input.date),
          startTime: input.time,
          endTime,
          status: "pending",
          managementToken,
        });

        const appointmentId = appointment.insertId;

        // Link service to appointment
        await dbInstance.insert(appointmentServices).values({
          appointmentId,
          serviceId: service.id,
          price: service.price,
        });

        // ========================================
        // STEP 2: Create Stripe Checkout Session
        // ========================================

        // Calculate total amount in NOK and øre
        const totalAmountNok = Number(service.price);
        if (totalAmountNok <= 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Service price must be greater than zero",
          });
        }

        const amountInOre = Math.round(totalAmountNok * 100);

        // Create Stripe Checkout Session
        const { stripe } = await import("./stripe");
        if (!stripe) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Stripe is not configured. Please add STRIPE_SECRET_KEY to enable payments.",
          });
        }
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          currency: "nok",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "nok",
                unit_amount: amountInOre,
                product_data: {
                  name: `Timebestilling #${appointmentId} - ${service.id}`,
                },
              },
            },
          ],
          success_url: input.successUrl.replace("{APPOINTMENT_ID}", String(appointmentId)),
          cancel_url: input.cancelUrl,
          metadata: {
            tenantId: input.tenantId,
            appointmentId: String(appointmentId),
            type: "appointment_payment",
          },
        });

        // Store payment record with status "pending"
        const payment = await db.createPayment({
          tenantId: input.tenantId,
          appointmentId,
          orderId: null,
          paymentMethod: "stripe",
          paymentGateway: "stripe",
          amount: totalAmountNok.toFixed(2),
          currency: "NOK",
          status: "pending",
          gatewaySessionId: session.id,
          gatewayPaymentId: null,
          gatewayMetadata: {
            checkoutMode: "payment",
          },
          processedBy: null,
          processedAt: null,
          lastFour: null,
          cardBrand: null,
          errorMessage: null,
        });

        // ========================================
        // STEP 3: Return combined result
        // ========================================

        return {
          success: true,
          appointmentId,
          customerId,
          checkoutUrl: session.url,
          paymentId: payment.id,
          sessionId: session.id,
        };
      }),

    /**
     * Create booking and initiate Vipps payment (public endpoint)
     * Similar to createBookingAndStartPayment but for Vipps
     */
    createBookingAndStartVippsPayment: publicProcedure
      .input(
        z.object({
          tenantId: z.string(),
          serviceId: z.number(),
          employeeId: z.number(),
          date: z.string(),
          time: z.string(),
          customerInfo: z.object({
            firstName: z.string(),
            lastName: z.string().optional(),
            phone: z.string(),
            email: z.string().email().optional(),
          }),
          callbackUrl: z.string().url(),
          fallbackUrl: z.string().url(),
        })
      )
      .mutation(async ({ input }) => {
        const { initiateVippsPayment, isVippsConfigured } = await import("./vipps");

        // Check if Vipps is configured
        if (!isVippsConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Vipps payment gateway is not configured. Please contact support.",
          });
        }

        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, appointmentServices, customers, services } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // ========================================
        // STEP 1: Create booking (same as Stripe version)
        // ========================================

        // Verify service exists and belongs to tenant
        const [service] = await dbInstance
          .select()
          .from(services)
          .where(and(eq(services.id, input.serviceId), eq(services.tenantId, input.tenantId)));

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
        }

        // Calculate end time
        const [hours, minutes] = input.time.split(":").map(Number);
        const startMinutes = hours * 60 + minutes;
        const endMinutes = startMinutes + service.durationMinutes;
        const endHours = Math.floor(endMinutes / 60);
        const endMins = endMinutes % 60;
        const endTime = `${String(endHours).padStart(2, "0")}:${String(endMins).padStart(2, "0")}`;

        // Find or create customer
        let customerId: number;
        const [existingCustomer] = await dbInstance
          .select()
          .from(customers)
          .where(and(eq(customers.phone, input.customerInfo.phone), eq(customers.tenantId, input.tenantId)));

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const [newCustomer] = await dbInstance.insert(customers).values({
            tenantId: input.tenantId,
            firstName: input.customerInfo.firstName,
            lastName: input.customerInfo.lastName || null,
            phone: input.customerInfo.phone,
            email: input.customerInfo.email || null,
          });
          customerId = newCustomer.insertId;
        }

        // Generate unique management token
        const managementToken = nanoid(32);

        // Create appointment
        const [appointment] = await dbInstance.insert(appointments).values({
          tenantId: input.tenantId,
          customerId,
          employeeId: input.employeeId,
          appointmentDate: new Date(input.date),
          startTime: input.time,
          endTime,
          status: "pending",
          managementToken,
        });

        const appointmentId = appointment.insertId;

        // Link service to appointment
        await dbInstance.insert(appointmentServices).values({
          appointmentId,
          serviceId: service.id,
          price: service.price,
        });

        // ========================================
        // STEP 2: Initiate Vipps Payment
        // ========================================

        const totalAmountNok = Number(service.price);
        if (totalAmountNok <= 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Service price must be greater than zero",
          });
        }

        // Generate unique order ID for Vipps
        const vippsOrderId = `apt-${appointmentId}-${nanoid(10)}`;

        // Initiate Vipps payment
        const vippsResponse = await initiateVippsPayment({
          orderId: vippsOrderId,
          amountNOK: totalAmountNok,
          transactionText: `Timebestilling #${appointmentId}`,
          callbackUrl: input.callbackUrl,
          fallbackUrl: input.fallbackUrl,
          mobileNumber: input.customerInfo.phone,
        });

        // Create payment record in DB with status "pending"
        const payment = await db.createPayment({
          tenantId: input.tenantId,
          appointmentId,
          orderId: null,
          paymentMethod: "vipps",
          paymentGateway: "vipps",
          amount: totalAmountNok.toFixed(2),
          currency: "NOK",
          status: "pending",
          gatewaySessionId: vippsOrderId,
          gatewayPaymentId: null,
          gatewayMetadata: {
            vippsOrderId,
            mobileNumber: input.customerInfo.phone,
          },
          processedBy: null,
          processedAt: null,
          lastFour: null,
          cardBrand: null,
          errorMessage: null,
        });

        // ========================================
        // STEP 3: Return combined result
        // ========================================

        return {
          success: true,
          appointmentId,
          customerId,
          vippsUrl: vippsResponse.url,
          paymentId: payment.id,
          vippsOrderId: vippsResponse.orderId,
        };
      }),

    /**
     * Get booking details for confirmation page
     * Used after successful payment to display booking information
     */
    getBookingDetails: publicProcedure
      .input(z.object({ bookingId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, users, services, appointmentServices, payments } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Get appointment with all related data
        const [appointment] = await dbInstance
          .select({
            id: appointments.id,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            appointmentDate: appointments.appointmentDate,
            status: appointments.status,
            managementToken: appointments.managementToken,
            customerName: customers.firstName,
            customerPhone: customers.phone,
            customerEmail: customers.email,
            employeeName: users.name,
          })
          .from(appointments)
          .leftJoin(customers, eq(appointments.customerId, customers.id))
          .leftJoin(users, eq(appointments.employeeId, users.id))
          .where(eq(appointments.id, input.bookingId));

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        // Get service details
        const [serviceDetails] = await dbInstance
          .select({
            serviceName: services.name,
            price: appointmentServices.price,
          })
          .from(appointmentServices)
          .leftJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(eq(appointmentServices.appointmentId, input.bookingId));

        // Get payment details
        const [payment] = await dbInstance
          .select({
            amount: payments.amount,
            paymentGateway: payments.paymentGateway,
            status: payments.status,
          })
          .from(payments)
          .where(eq(payments.appointmentId, input.bookingId));

        // Combine start date and time
        const appointmentDateTime = new Date(appointment.appointmentDate);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);

        const endDateTime = new Date(appointment.appointmentDate);
        const [endHours, endMinutes] = appointment.endTime.split(":").map(Number);
        endDateTime.setHours(endHours, endMinutes, 0, 0);

        return {
          id: appointment.id,
          startTime: appointmentDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          status: appointment.status,
          managementToken: appointment.managementToken || undefined,
          customerName: `${appointment.customerName}`,
          customerPhone: appointment.customerPhone,
          customerEmail: appointment.customerEmail || undefined,
          employeeName: appointment.employeeName || undefined,
          serviceName: serviceDetails?.serviceName || "Unknown Service",
          totalPrice: serviceDetails?.price || 0,
          paymentMethod: payment?.paymentGateway || "unknown",
          paymentStatus: payment?.status || "unknown",
        };
      }),

    /**
     * Get booking by management token
     * Allows customers to access their booking without authentication
     */
    getBookingByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, users, services, appointmentServices, tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Get appointment with all related data
        const [appointment] = await dbInstance
          .select({
            id: appointments.id,
            tenantId: appointments.tenantId,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            appointmentDate: appointments.appointmentDate,
            status: appointments.status,
            notes: appointments.notes,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            customerPhone: customers.phone,
            customerEmail: customers.email,
            employeeName: users.name,
            employeeId: users.id,
            salonName: tenants.name,
            salonPhone: tenants.phone,
            salonAddress: tenants.address,
            cancellationWindowHours: tenants.cancellationWindowHours,
          })
          .from(appointments)
          .innerJoin(customers, eq(appointments.customerId, customers.id))
          .innerJoin(users, eq(appointments.employeeId, users.id))
          .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
          .where(eq(appointments.managementToken, input.token))
          .limit(1);

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        // Get services
        const servicesList = await dbInstance
          .select({
            serviceName: services.name,
            price: appointmentServices.price,
          })
          .from(appointmentServices)
          .innerJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(eq(appointmentServices.appointmentId, appointment.id));

        const totalPrice = servicesList.reduce((sum, s) => sum + Number(s.price), 0);

        // Calculate if cancellation is allowed
        const appointmentDateTime = new Date(appointment.appointmentDate);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);

        const now = new Date();
        const hoursUntilAppointment = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const canCancel = hoursUntilAppointment > (appointment.cancellationWindowHours || 24) && 
                         (appointment.status === "pending" || appointment.status === "confirmed");
        const canReschedule = canCancel; // Same rules for now

        return {
          id: appointment.id,
          tenantId: appointment.tenantId,
          startTime: appointmentDateTime.toISOString(),
          endTime: appointment.endTime,
          status: appointment.status,
          notes: appointment.notes,
          customerName: `${appointment.customerFirstName} ${appointment.customerLastName || ""}`.trim(),
          customerPhone: appointment.customerPhone,
          customerEmail: appointment.customerEmail,
          employeeName: appointment.employeeName,
          employeeId: appointment.employeeId,
          services: servicesList.map(s => ({
            name: s.serviceName,
            price: Number(s.price),
          })),
          totalPrice,
          salonName: appointment.salonName,
          salonPhone: appointment.salonPhone,
          salonAddress: appointment.salonAddress,
          canCancel,
          canReschedule,
          cancellationWindowHours: appointment.cancellationWindowHours || 24,
        };
      }),

    /**
     * Cancel booking by management token
     */
    cancelBooking: publicProcedure
      .input(z.object({ 
        token: z.string(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Get appointment
        const [appointment] = await dbInstance
          .select({
            id: appointments.id,
            tenantId: appointments.tenantId,
            appointmentDate: appointments.appointmentDate,
            startTime: appointments.startTime,
            status: appointments.status,
          })
          .from(appointments)
          .where(eq(appointments.managementToken, input.token))
          .limit(1);

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        if (appointment.status === "canceled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Booking is already canceled" });
        }

        if (appointment.status === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot cancel completed booking" });
        }

        // Get tenant cancellation policy
        const [tenant] = await dbInstance
          .select({ cancellationWindowHours: tenants.cancellationWindowHours })
          .from(tenants)
          .where(eq(tenants.id, appointment.tenantId))
          .limit(1);

        // Check if within cancellation window
        const appointmentDateTime = new Date(appointment.appointmentDate);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);

        const now = new Date();
        const hoursUntilAppointment = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancellationWindow = tenant?.cancellationWindowHours || 24;
        const isLateCancellation = hoursUntilAppointment < cancellationWindow;

        if (hoursUntilAppointment < 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot cancel past appointment" });
        }

        // Update appointment
        await dbInstance
          .update(appointments)
          .set({
            status: "canceled",
            cancellationReason: input.reason || "Canceled by customer",
            canceledBy: "customer",
            canceledAt: new Date(),
            isLateCancellation,
          })
          .where(eq(appointments.id, appointment.id));

        return {
          success: true,
          isLateCancellation,
          message: isLateCancellation 
            ? `Booking canceled. Note: This is a late cancellation (less than ${cancellationWindow} hours notice).`
            : "Booking canceled successfully.",
        };
      }),

    /**
     * Reschedule booking by management token
     */
    rescheduleBooking: publicProcedure
      .input(z.object({ 
        token: z.string(),
        newDate: z.string(),
        newTime: z.string(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, tenants, services, appointmentServices } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Get appointment
        const [appointment] = await dbInstance
          .select({
            id: appointments.id,
            tenantId: appointments.tenantId,
            appointmentDate: appointments.appointmentDate,
            startTime: appointments.startTime,
            status: appointments.status,
          })
          .from(appointments)
          .where(eq(appointments.managementToken, input.token))
          .limit(1);

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        if (appointment.status === "canceled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reschedule canceled booking" });
        }

        if (appointment.status === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reschedule completed booking" });
        }

        // Get tenant cancellation policy
        const [tenant] = await dbInstance
          .select({ cancellationWindowHours: tenants.cancellationWindowHours })
          .from(tenants)
          .where(eq(tenants.id, appointment.tenantId))
          .limit(1);

        // Check if within cancellation window for original appointment
        const appointmentDateTime = new Date(appointment.appointmentDate);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);

        const now = new Date();
        const hoursUntilAppointment = (appointmentDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancellationWindow = tenant?.cancellationWindowHours || 24;

        if (hoursUntilAppointment < cancellationWindow) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `Cannot reschedule within ${cancellationWindow} hours of appointment` 
          });
        }

        // Get service duration to calculate new end time
        const [appointmentService] = await dbInstance
          .select({ serviceId: appointmentServices.serviceId })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, appointment.id))
          .limit(1);

        const [service] = await dbInstance
          .select({ durationMinutes: services.durationMinutes })
          .from(services)
          .where(eq(services.id, appointmentService.serviceId))
          .limit(1);

        // Calculate new end time
        const [newHours, newMinutes] = input.newTime.split(":").map(Number);
        const startMinutes = newHours * 60 + newMinutes;
        const endMinutes = startMinutes + (service?.durationMinutes || 60);
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        const newEndTime = `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}:00`;

        // Update appointment
        await dbInstance
          .update(appointments)
          .set({
            appointmentDate: new Date(input.newDate),
            startTime: input.newTime,
            endTime: newEndTime,
          })
          .where(eq(appointments.id, appointment.id));

        return {
          success: true,
          message: "Booking rescheduled successfully.",
        };
      }),
  }),

  // ============================================================================
  // ANALYTICS
  // ============================================================================
  analytics: router({
    customerGrowth: tenantProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { customers } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            date: sql<string>`DATE(${sql.identifier('customers')}.${sql.identifier('createdAt')})`,
            count: sql<number>`COUNT(*)`,
          })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, ctx.tenantId),
              gte(customers.createdAt, input.startDate),
              lte(customers.createdAt, input.endDate)
            )
          )
          .groupBy(sql`DATE(${sql.identifier('customers')}.${sql.identifier('createdAt')})`)
          .orderBy(sql`DATE(${sql.identifier('customers')}.${sql.identifier('createdAt')})`);

        return result;
      }),

    employeePerformance: tenantProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, users, services: servicesTable, appointmentServices } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            employeeId: appointments.employeeId,
            employeeName: users.name,
            appointmentCount: sql<number>`COUNT(DISTINCT ${appointments.id})`,
            totalRevenue: sql<string>`COALESCE(SUM(${servicesTable.price}), 0)`,
          })
          .from(appointments)
          .leftJoin(users, eq(appointments.employeeId, users.id))
          .leftJoin(appointmentServices, eq(appointments.id, appointmentServices.appointmentId))
          .leftJoin(servicesTable, eq(appointmentServices.serviceId, servicesTable.id))
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.status, "completed"),
              gte(appointments.appointmentDate, input.startDate),
              lte(appointments.appointmentDate, input.endDate)
            )
          )
          .groupBy(appointments.employeeId, users.name)
          .orderBy(sql`COUNT(DISTINCT ${appointments.id}) DESC`);

        return result;
      }),

    topServices: tenantProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, services: servicesTable, appointmentServices } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            serviceId: servicesTable.id,
            serviceName: servicesTable.name,
            bookingCount: sql<number>`COUNT(*)`,
            totalRevenue: sql<string>`SUM(${servicesTable.price})`,
          })
          .from(appointmentServices)
          .leftJoin(servicesTable, eq(appointmentServices.serviceId, servicesTable.id))
          .leftJoin(appointments, eq(appointmentServices.appointmentId, appointments.id))
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.status, "completed"),
              gte(appointments.appointmentDate, input.startDate),
              lte(appointments.appointmentDate, input.endDate)
            )
          )
          .groupBy(servicesTable.id, servicesTable.name)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(10);

        return result;
      }),

    revenueTrends: tenantProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, services: servicesTable, appointmentServices } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            date: sql<string>`DATE(${sql.identifier('appointments')}.${sql.identifier('appointmentDate')})`,
            revenue: sql<string>`COALESCE(SUM(${servicesTable.price}), 0)`,
          })
          .from(appointments)
          .leftJoin(appointmentServices, eq(appointments.id, appointmentServices.appointmentId))
          .leftJoin(servicesTable, eq(appointmentServices.serviceId, servicesTable.id))
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.status, "completed"),
              gte(appointments.appointmentDate, input.startDate),
              lte(appointments.appointmentDate, input.endDate)
            )
          )
          .groupBy(sql`DATE(${sql.identifier('appointments')}.${sql.identifier('appointmentDate')})`)
          .orderBy(sql`DATE(${sql.identifier('appointments')}.${sql.identifier('appointmentDate')})`);

        return result;
      }),

    appointmentStatusDistribution: tenantProcedure
      .input(z.object({ startDate: z.date(), endDate: z.date() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const result = await dbInstance
          .select({
            status: appointments.status,
            count: sql<number>`COUNT(*)`,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, ctx.tenantId),
              gte(appointments.appointmentDate, input.startDate),
              lte(appointments.appointmentDate, input.endDate)
            )
          )
          .groupBy(appointments.status);

        return result;
      }),
  }),

  // ============================================================================
  // ATTENDANCE REPORTS
  // ============================================================================
  attendance: router({
    getAllTimesheets: adminProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        employeeId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const conditions = [eq(timesheets.tenantId, ctx.tenantId)];
        
        if (input.startDate) {
          conditions.push(sql`${timesheets.workDate} >= ${input.startDate}`);
        }
        if (input.endDate) {
          conditions.push(sql`${timesheets.workDate} <= ${input.endDate}`);
        }
        if (input.employeeId) {
          conditions.push(eq(timesheets.employeeId, input.employeeId));
        }

        const result = await dbInstance
          .select({
            id: timesheets.id,
            employeeId: timesheets.employeeId,
            employeeName: users.name,
            workDate: timesheets.workDate,
            clockIn: timesheets.clockIn,
            clockOut: timesheets.clockOut,
            totalHours: timesheets.totalHours,
          })
          .from(timesheets)
          .leftJoin(users, eq(timesheets.employeeId, users.id))
          .where(and(...conditions))
          .orderBy(desc(timesheets.workDate), desc(timesheets.clockIn));

        return result;
      }),

    getEmployeeTotals: adminProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const conditions = [eq(timesheets.tenantId, ctx.tenantId)];
        
        if (input.startDate) {
          conditions.push(sql`${timesheets.workDate} >= ${input.startDate}`);
        }
        if (input.endDate) {
          conditions.push(sql`${timesheets.workDate} <= ${input.endDate}`);
        }

        const result = await dbInstance
          .select({
            employeeId: timesheets.employeeId,
            employeeName: users.name,
            totalHours: sql<string>`COALESCE(SUM(CAST(${timesheets.totalHours} AS DECIMAL(10,2))), 0)`,
            shiftCount: sql<number>`COUNT(*)`,
          })
          .from(timesheets)
          .leftJoin(users, eq(timesheets.employeeId, users.id))
          .where(and(...conditions))
          .groupBy(timesheets.employeeId, users.name);

        return result;
      }),

    updateTimesheet: adminProcedure
      .input(z.object({
        id: z.number(),
        clockIn: z.string(),
        clockOut: z.string().optional(),
        editReason: z.string().min(1, "Reason is required"),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new Error("Database not available");

        const { timesheets } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Calculate total hours (always positive)
        const clockInDate = new Date(input.clockIn);
        const clockOutDate = input.clockOut ? new Date(input.clockOut) : null;
        let totalHours = "0.00";
        
        if (clockOutDate) {
          const diffMs = clockOutDate.getTime() - clockInDate.getTime();
          const hours = Math.abs(diffMs / (1000 * 60 * 60));
          totalHours = hours.toFixed(2);
        }

        await dbInstance
          .update(timesheets)
          .set({
            clockIn: clockInDate,
            clockOut: clockOutDate,
            totalHours,
            editReason: input.editReason,
            editedBy: ctx.user.id,
            editedAt: new Date(),
          })
          .where(
            and(
              eq(timesheets.id, input.id),
              eq(timesheets.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    deleteTimesheet: adminProcedure
      .input(z.object({
        id: z.number(),
        reason: z.string().min(1, "Reason is required"),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new Error("Database not available");

        const { timesheets } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Soft delete by marking with delete reason
        await dbInstance
          .update(timesheets)
          .set({
            editReason: `DELETED: ${input.reason}`,
            editedBy: ctx.user.id,
            editedAt: new Date(),
          })
          .where(
            and(
              eq(timesheets.id, input.id),
              eq(timesheets.tenantId, ctx.tenantId)
            )
          );

        // Actually delete the record
        await dbInstance
          .delete(timesheets)
          .where(
            and(
              eq(timesheets.id, input.id),
              eq(timesheets.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    // Get weekly summary for all employees
    getWeeklySummary: adminProcedure
      .input(z.object({
        year: z.number(),
        month: z.number(), // 1-12
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");

        // Get first and last day of the month
        const firstDay = new Date(input.year, input.month - 1, 1);
        const lastDay = new Date(input.year, input.month, 0);

        const result = await dbInstance.execute(
          sql`SELECT 
            t.employeeId,
            u.name as employeeName,
            WEEK(t.workDate, 1) as weekNumber,
            MIN(t.workDate) as weekStart,
            MAX(t.workDate) as weekEnd,
            COALESCE(SUM(CAST(t.totalHours AS DECIMAL(10,2))), 0) as totalHours,
            COUNT(*) as shiftCount
          FROM timesheets t
          LEFT JOIN users u ON t.employeeId = u.id
          WHERE t.tenantId = ${ctx.tenantId}
            AND t.workDate >= ${firstDay.toISOString().split('T')[0]}
            AND t.workDate <= ${lastDay.toISOString().split('T')[0]}
          GROUP BY t.employeeId, u.name, WEEK(t.workDate, 1)
          ORDER BY t.employeeId, weekNumber`
        );

        return result as unknown as Array<{
          employeeId: number;
          employeeName: string;
          weekNumber: number;
          weekStart: string;
          weekEnd: string;
          totalHours: string;
          shiftCount: number;
        }>;
      }),

    // Get monthly summary for all employees
    getMonthlySummary: adminProcedure
      .input(z.object({
        year: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");

        const result = await dbInstance.execute(
          sql`SELECT 
            t.employeeId,
            u.name as employeeName,
            MONTH(t.workDate) as month,
            COALESCE(SUM(CAST(t.totalHours AS DECIMAL(10,2))), 0) as totalHours,
            COUNT(*) as shiftCount,
            COUNT(DISTINCT t.workDate) as daysWorked
          FROM timesheets t
          LEFT JOIN users u ON t.employeeId = u.id
          WHERE t.tenantId = ${ctx.tenantId}
            AND YEAR(t.workDate) = ${input.year}
          GROUP BY t.employeeId, u.name, MONTH(t.workDate)
          ORDER BY t.employeeId, month`
        );

        return result as unknown as Array<{
          employeeId: number;
          employeeName: string;
          month: number;
          totalHours: string;
          shiftCount: number;
          daysWorked: number;
        }>;
      }),

    // Get detailed employee work hours report
    getEmployeeWorkReport: adminProcedure
      .input(z.object({
        employeeId: z.number().optional(),
        startDate: z.string(),
        endDate: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return { employees: [], summary: { totalHours: "0", totalShifts: 0, averageHoursPerDay: "0" } };

        const { timesheets, users } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");

        // Build employee filter
        const employeeFilter = input.employeeId 
          ? sql`AND t.employeeId = ${input.employeeId}` 
          : sql``;

        const result = await dbInstance.execute(
          sql`SELECT 
            t.employeeId,
            u.name as employeeName,
            COALESCE(SUM(CAST(t.totalHours AS DECIMAL(10,2))), 0) as totalHours,
            COUNT(*) as shiftCount,
            COUNT(DISTINCT t.workDate) as daysWorked,
            MIN(t.workDate) as firstDay,
            MAX(t.workDate) as lastDay,
            AVG(CAST(t.totalHours AS DECIMAL(10,2))) as avgHoursPerShift
          FROM timesheets t
          LEFT JOIN users u ON t.employeeId = u.id
          WHERE t.tenantId = ${ctx.tenantId}
            AND t.workDate >= ${input.startDate}
            AND t.workDate <= ${input.endDate}
            ${employeeFilter}
          GROUP BY t.employeeId, u.name
          ORDER BY totalHours DESC`
        );

        const employees = result as unknown as Array<{
          employeeId: number;
          employeeName: string;
          totalHours: string;
          shiftCount: number;
          daysWorked: number;
          firstDay: string;
          lastDay: string;
          avgHoursPerShift: string;
        }>;

        // Calculate overall summary
        const totalHours = employees.reduce((sum, e) => sum + parseFloat(e.totalHours || "0"), 0);
        const totalShifts = employees.reduce((sum, e) => sum + e.shiftCount, 0);
        const totalDays = employees.reduce((sum, e) => sum + e.daysWorked, 0);

        return {
          employees,
          summary: {
            totalHours: totalHours.toFixed(2),
            totalShifts,
            averageHoursPerDay: totalDays > 0 ? (totalHours / totalDays).toFixed(2) : "0",
          },
        };
      }),
  }),

  // ============================================================================
  // DASHBOARD
  // ============================================================================
  dashboard: router({
    todayStats: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        return {
          todayAppointments: 0,
          todayRevenue: "0.00",
          pendingAppointments: 0,
          totalCustomers: 0,
        };
      }

      const { appointments, customers } = await import("../drizzle/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      
      const today = new Date().toISOString().split('T')[0];
      
      // Today's appointments
      const todayAppts = await dbInstance.select().from(appointments).where(
        and(
          eq(appointments.tenantId, ctx.tenantId),
          sql`${appointments.appointmentDate} = ${today}`
        )
      );

      // Total customers
      const totalCust = await dbInstance.select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(eq(customers.tenantId, ctx.tenantId));

      return {
        todayAppointments: todayAppts.length,
        todayRevenue: "0.00", // TODO: Calculate from completed appointments
        pendingAppointments: todayAppts.filter(a => a.status === "pending").length,
        completedAppointments: todayAppts.filter(a => a.status === "completed").length,
        totalCustomers: totalCust[0]?.count || 0,
      };
    }),

    // Get appointments over time (last 7 days)
    appointmentsOverTime: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];

      const { appointments } = await import("../drizzle/schema");
      const { eq, and, sql, gte } = await import("drizzle-orm");

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const startDate = sevenDaysAgo.toISOString().split('T')[0];

      const appts = await dbInstance.select({
        date: sql<string>`DATE(appointmentDate)`,
        count: sql<number>`count(*)`
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, ctx.tenantId),
          gte(appointments.appointmentDate, new Date(startDate))
        )
      )
      .groupBy(sql`DATE(appointmentDate)`)
      .orderBy(sql`DATE(appointmentDate)`);

      // Fill in missing dates with 0 count
      const result = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split('T')[0];
        const found = appts.find(a => String(a.date) === dateStr);
        result.push({
          date: dateStr,
          count: found ? Number(found.count) : 0
        });
      }

      return result;
    }),

    // Get appointment status distribution
    statusDistribution: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return { confirmed: 0, pending: 0, cancelled: 0 };

      const { appointments } = await import("../drizzle/schema");
      const { eq, and, sql } = await import("drizzle-orm");

      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().split('T')[0];

      const appts = await dbInstance.select()
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, ctx.tenantId),
            sql`${appointments.appointmentDate} >= ${startDate}`
          )
        );

      return {
        confirmed: appts.filter(a => a.status === 'confirmed').length,
        pending: appts.filter(a => a.status === 'pending').length,
        cancelled: appts.filter(a => a.status === 'canceled').length,
      };
    }),

    // Get badge counts for sidebar
    badgeCounts: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        return {
          pendingAppointments: 0,
          unreadNotifications: 0,
          pendingLeaveApprovals: 0,
        };
      }

      const { appointments, notifications, employeeLeaves } = await import("../drizzle/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      
      const today = new Date().toISOString().split('T')[0];
      
      // Today's pending appointments
      const pendingAppts = await dbInstance.select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, ctx.tenantId),
            eq(appointments.status, "pending"),
            sql`${appointments.appointmentDate} = ${today}`
          )
        );

      // Pending notifications (not yet sent)
      const pendingNotifs = await dbInstance.select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, ctx.tenantId),
            eq(notifications.status, "pending")
          )
        );

      // Pending leave approvals (admin only)
      let pendingLeaves = 0;
      if (ctx.user.role === "owner" || ctx.user.role === "admin") {
        const pendingLeavesResult = await dbInstance.select({ count: sql<number>`count(*)` })
          .from(employeeLeaves)
          .where(
            and(
              eq(employeeLeaves.tenantId, ctx.tenantId),
              eq(employeeLeaves.status, "pending")
            )
          );
        pendingLeaves = pendingLeavesResult[0]?.count || 0;
      }

      return {
        pendingAppointments: pendingAppts[0]?.count || 0,
        unreadNotifications: pendingNotifs[0]?.count || 0,
        pendingLeaveApprovals: pendingLeaves,
      };
    }),
  }),

  // ============================================================================
  // PAYMENTS
  // ============================================================================
  payments: router({
    createCheckoutSession: tenantProcedure
      .input(
        z.object({
          appointmentId: z.number().int().positive(),
          successUrl: z.string().url(),
          cancelUrl: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenantId } = ctx;

        // 1) Load appointment and its services for this tenant
        const { appointments, appointmentServices, services } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, tenantId)));

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        // Load services linked to this appointment
        const rows = await dbInstance
          .select({
            price: appointmentServices.price,
            serviceId: appointmentServices.serviceId,
          })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, appointment.id));

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Appointment has no services to bill",
          });
        }

        // Calculate total amount (in NOK, decimal) and in øre for Stripe
        const totalAmountNok = rows
          .map((r) => Number(r.price))
          .reduce((acc, v) => acc + v, 0);

        if (totalAmountNok <= 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Total amount must be greater than zero",
          });
        }

        const amountInOre = Math.round(totalAmountNok * 100);

        // 2) Create Stripe Checkout Session
        const { stripe } = await import("./stripe");
        if (!stripe) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Stripe is not configured. Please add STRIPE_SECRET_KEY to enable payments.",
          });
        }
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          currency: "nok",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "nok",
                unit_amount: amountInOre,
                product_data: {
                  name: `Timebestilling #${appointment.id}`,
                },
              },
            },
          ],
          success_url: input.successUrl.replace("{APPOINTMENT_ID}", String(appointment.id)),
          cancel_url: input.cancelUrl,
          metadata: {
            tenantId,
            appointmentId: String(appointment.id),
            type: "appointment_payment",
          },
        });

        // 3) Create payment record in DB with status "pending"
        const payment = await db.createPayment({
          tenantId,
          appointmentId: appointment.id,
          orderId: null,
          paymentMethod: "stripe",
          paymentGateway: "stripe",
          amount: totalAmountNok.toFixed(2),
          currency: "NOK",
          status: "pending",
          gatewaySessionId: session.id,
          gatewayPaymentId: null,
          gatewayMetadata: {
            checkoutMode: "payment",
          },
          processedBy: null,
          processedAt: null,
          lastFour: null,
          cardBrand: null,
          errorMessage: null,
        });

        return {
          url: session.url,
          paymentId: payment.id,
          sessionId: session.id,
        };
      }),

    // Vipps payment initiation
    createVippsPayment: tenantProcedure
      .input(
        z.object({
          appointmentId: z.number().int().positive(),
          callbackUrl: z.string().url(),
          fallbackUrl: z.string().url(),
          mobileNumber: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { initiateVippsPayment, isVippsConfigured } = await import("./vipps");

        // Check if Vipps is configured
        if (!isVippsConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Vipps payment gateway is not configured. Please contact support.",
          });
        }

        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenantId } = ctx;

        // 1) Load appointment and its services for this tenant
        const { appointments, appointmentServices } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, tenantId)));

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        // Load services linked to this appointment
        const rows = await dbInstance
          .select({
            price: appointmentServices.price,
          })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, appointment.id));

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Appointment has no services to bill",
          });
        }

        // Calculate total amount in NOK
        const totalAmountNok = rows
          .map((r) => Number(r.price))
          .reduce((acc, v) => acc + v, 0);

        if (totalAmountNok <= 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Total amount must be greater than zero",
          });
        }

        // 2) Generate unique order ID for Vipps
        const vippsOrderId = `apt-${appointment.id}-${nanoid(10)}`;

        // 3) Initiate Vipps payment
        const vippsResponse = await initiateVippsPayment({
          orderId: vippsOrderId,
          amountNOK: totalAmountNok,
          transactionText: `Timebestilling #${appointment.id}`,
          callbackUrl: input.callbackUrl,
          fallbackUrl: input.fallbackUrl,
          mobileNumber: input.mobileNumber,
        });

        // 4) Create payment record in DB with status "pending"
        const payment = await db.createPayment({
          tenantId,
          appointmentId: appointment.id,
          orderId: null,
          paymentMethod: "vipps",
          paymentGateway: "vipps",
          amount: totalAmountNok.toFixed(2),
          currency: "NOK",
          status: "pending",
          gatewaySessionId: vippsOrderId,
          gatewayPaymentId: null,
          gatewayMetadata: {
            vippsOrderId,
            mobileNumber: input.mobileNumber,
          },
          processedBy: null,
          processedAt: null,
          lastFour: null,
          cardBrand: null,
          errorMessage: null,
        });

        return {
          url: vippsResponse.url,
          paymentId: payment.id,
          vippsOrderId: vippsResponse.orderId,
        };
      }),

    // Get Vipps payment status
    getVippsPaymentStatus: tenantProcedure
      .input(z.object({ vippsOrderId: z.string() }))
      .query(async ({ input }) => {
        const { getVippsPaymentDetails, isVippsConfigured } = await import("./vipps");

        if (!isVippsConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Vipps payment gateway is not configured",
          });
        }

        const details = await getVippsPaymentDetails(input.vippsOrderId);
        return details;
      }),

    // Check if Vipps is available
    isVippsAvailable: publicProcedure.query(async () => {
      const { isVippsConfigured } = await import("./vipps");
      return { available: isVippsConfigured() };
    }),
  }),

  // ============================================================================
  // POS (Point of Sale)
  // ============================================================================
  pos: router({
    /**
     * Create an order with items for in-salon sales
     * 
     * Use cases:
     * - Walk-in customer (no appointment)
     * - Existing appointment (link via appointmentId)
     * - Product sales at checkout
     * 
     * Status flow: pending → completed (after payment)
     */
    createOrder: tenantProcedure
      .input(
        z.object({
          appointmentId: z.number().int().optional(),
          customerId: z.number().int().optional(),
          employeeId: z.number().int(),
          items: z.array(
            z.object({
              itemType: z.enum(["service", "product"]),
              itemId: z.number().int(),
              itemName: z.string().optional(), // Optional: will be fetched from DB if not provided
              quantity: z.number().int().positive().default(1),
              unitPrice: z.number().positive(),
              vatRate: z.number().positive(), // e.g. 25 for 25%
            })
          ).min(1, "At least one item is required"),
          orderDate: z.string(), // YYYY-MM-DD
          orderTime: z.string(), // HH:MM
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenantId } = ctx;

        // Fetch item names from database only if not provided in input
        const itemsNeedingNames = input.items.filter(item => !item.itemName);
        const serviceMap = new Map<number, string>();
        const productMap = new Map<number, string>();

        if (itemsNeedingNames.length > 0) {
          const { services, products } = await import("../drizzle/schema");
          const { inArray } = await import("drizzle-orm");

          const serviceIds = itemsNeedingNames.filter(i => i.itemType === "service").map(i => i.itemId);
          const productIds = itemsNeedingNames.filter(i => i.itemType === "product").map(i => i.itemId);

          try {
            if (serviceIds.length > 0) {
              const serviceRecords = await dbInstance.select().from(services).where(
                inArray(services.id, serviceIds)
              );
              serviceRecords.forEach(s => serviceMap.set(s.id, s.name));
            }

            if (productIds.length > 0) {
              const productRecords = await dbInstance.select().from(products).where(
                inArray(products.id, productIds)
              );
              productRecords.forEach(p => productMap.set(p.id, p.name));
            }
          } catch (error) {
            console.error("Error fetching item names:", error);
            // Continue with default names if fetch fails
          }
        }

        // Calculate totals
        let subtotal = 0;
        let vatAmount = 0;

        for (const item of input.items) {
          const itemTotal = item.unitPrice * item.quantity;
          subtotal += itemTotal;
          vatAmount += itemTotal * (item.vatRate / 100);
        }

        const totalAmount = subtotal + vatAmount;

        // Create order with items in transaction
        // Format date as YYYY-MM-DD for MySQL DATE column
        const orderDate = new Date(input.orderDate);
        const formattedDate = orderDate.toISOString().split('T')[0];
        
        const itemsToCreate = input.items.map((item) => {
            // Use provided name or fetch from database
            const itemName = item.itemName || 
              (item.itemType === "service" 
                ? serviceMap.get(item.itemId) || "Unknown Service"
                : productMap.get(item.itemId) || "Unknown Product");
            
            const result = {
              itemType: item.itemType,
              itemId: item.itemId,
              itemName,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
              vatRate: item.vatRate.toFixed(2),
              total: (item.unitPrice * item.quantity).toFixed(2),
            };
            
            return result;
          });

        const { order, items } = await db.createOrderWithItems(
          {
            tenantId,
            appointmentId: input.appointmentId ?? null,
            customerId: input.customerId ?? null,
            employeeId: input.employeeId,
            orderDate: formattedDate,
            orderTime: input.orderTime,
            subtotal: subtotal.toFixed(2),
            vatAmount: vatAmount.toFixed(2),
            total: totalAmount.toFixed(2),
            status: "pending",
          },
          itemsToCreate
        );

        return { order, items };
      }),

    /**
     * Record a cash payment for an order
     * 
     * Marks order as "completed" and creates payment record
     * with status "completed"
     */
    recordCashPayment: tenantProcedure
      .input(
        z.object({
          orderId: z.number().int(),
          amount: z.number().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { tenantId, user } = ctx;
        console.log("[recordCashPayment] tenantId:", tenantId, "type:", typeof tenantId);
        console.log("[recordCashPayment] orderId:", input.orderId, "amount:", input.amount);
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Validate order exists and belongs to tenant
        const [order] = await dbInstance
          .select()
          .from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        // Validate amount matches order total
        const orderTotal = Number(order.total);
        if (Math.abs(input.amount - orderTotal) > 0.01) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Payment amount (${input.amount}) does not match order total (${orderTotal})`,
          });
        }

        // Create payment record
        const payment = await db.createPayment({
          tenantId,
          orderId: order.id,
          appointmentId: order.appointmentId,
          paymentMethod: "cash",
          paymentGateway: null,
          amount: input.amount.toFixed(2),
          currency: "NOK",
          status: "completed",
          gatewaySessionId: null,
          gatewayPaymentId: null,
          gatewayMetadata: null,
          lastFour: null,
          cardBrand: null,
          processedBy: user.id,
          processedAt: new Date(),
          errorMessage: null,
        });

        // Mark order as completed
        const updatedOrder = await db.updateOrderStatus(order.id, "completed");

        return { payment, order: updatedOrder };
      }),

    /**
     * Record a card payment for an order (manual terminal)
     * 
     * For external POS terminals (not Stripe)
     * Marks order as "completed" and creates payment record
     */
    recordCardPayment: tenantProcedure
      .input(
        z.object({
          orderId: z.number().int(),
          amount: z.number().positive(),
          cardBrand: z.string().optional(),
          lastFour: z.string().length(4).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { tenantId, user } = ctx;
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Validate order exists and belongs to tenant
        const [order] = await dbInstance
          .select()
          .from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        // Validate amount matches order total
        const orderTotal = Number(order.total);
        if (Math.abs(input.amount - orderTotal) > 0.01) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Payment amount (${input.amount}) does not match order total (${orderTotal})`,
          });
        }

        // Create payment record
        const payment = await db.createPayment({
          tenantId,
          orderId: order.id,
          appointmentId: order.appointmentId,
          paymentMethod: "card",
          paymentGateway: null, // POS terminal, not Stripe
          amount: input.amount.toFixed(2),
          currency: "NOK",
          status: "completed",
          gatewaySessionId: null,
          gatewayPaymentId: null,
          gatewayMetadata: null,
          lastFour: input.lastFour ?? null,
          cardBrand: input.cardBrand ?? null,
          processedBy: user.id,
          processedAt: new Date(),
          errorMessage: null,
        });

        // Mark order as completed
        const updatedOrder = await db.updateOrderStatus(order.id, "completed");

        return { payment, order: updatedOrder };
      }),

    /**
     * Create a Zettle payment for an order
     * 
     * Initiates payment on connected Zettle reader
     * Returns payment UUID for status tracking
     */
    createZettlePayment: tenantProcedure
      .input(
        z.object({
          orderId: z.number().int(),
          amount: z.number().positive(),
          linkId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { tenantId, user } = ctx;
        const dbInstance = await db.getDb();  
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders, paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { decryptToken } = await import("./services/izettle");
        const { getReaderConnectManager } = await import("./services/reader-connect");

        // Validate order exists and belongs to tenant
        const [order] = await dbInstance
          .select()
          .from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        // Validate amount matches order total
        const orderTotal = Number(order.total);
        if (Math.abs(input.amount - orderTotal) > 0.01) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Payment amount (${input.amount}) does not match order total (${orderTotal})`,
          });
        }

        // Get Zettle provider for this tenant
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, tenantId),
              eq(paymentProviders.providerType, "izettle"),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle er ikke koblet til. Vennligst koble til iZettle i innstillinger.",
          });
        }

        if (!provider.accessToken) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "iZettle access token mangler. Vennligst koble til på nytt.",
          });
        }

        // Decrypt access token
        const accessToken = decryptToken(provider.accessToken);

        // Get or create Reader Connect manager
        // Check if provider has linkId (Reader Connect setup)
        const config = provider.config ? JSON.parse(provider.config as string) : {};
        const readerLinks = config.readerLinks || [];

        if (readerLinks.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Ingen PayPal Reader Links funnet. Vennligst opprett en Reader Link i innstillinger.",
          });
        }

        // Use provided linkId or default to first available
        let linkId: string = input.linkId || readerLinks[0].linkId;

        // Verify linkId exists in config
        const linkExists = readerLinks.some((link: any) => link.linkId === linkId);
        if (!linkExists) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Ugyldig Reader Link ID. Vennligst velg en gyldig Reader Link.",
          });
        }

        // Get Reader Connect manager
        const manager = getReaderConnectManager(tenantId, linkId, accessToken);

        // Ensure WebSocket is connected
        if (!manager.isConnected()) {
          try {
            await manager.connect();
          } catch (error: any) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Kunne ikke koble til PayPal Reader: ${error.message}`,
            });
          }
        }

        // Create pending payment record in our database
        const payment = await db.createPayment({
          tenantId,
          orderId: order.id,
          appointmentId: order.appointmentId,
          paymentMethod: "card",
          paymentGateway: "izettle",
          amount: input.amount.toFixed(2),
          currency: "NOK",
          status: "pending",
          gatewaySessionId: null,
          gatewayPaymentId: null,
          gatewayMetadata: null,
          lastFour: null,
          cardBrand: null,
          processedBy: user.id,
          processedAt: null,
          errorMessage: null,
        });

        // Send payment request to Reader via WebSocket
        try {
          const internalTraceId = await manager.sendPaymentRequest(
            {
              amount: input.amount,
              currency: "NOK",
              reference: `Order #${order.id}`,
            },
            (progress) => {
              // Payment progress callback
              console.log(`[Zettle Payment ${payment.id}] Progress:`, progress.status);
            },
            async (result) => {
              // Payment result callback
              console.log(`[Zettle Payment ${payment.id}] Result:`, result.resultStatus);

              // Update payment record based on result
              if (result.resultStatus === "COMPLETED") {
                await db.updatePayment(payment.id, {
                  status: "completed",
                  processedAt: new Date(),
                  gatewayPaymentId: result.resultPayload?.purchaseUUID || internalTraceId,
                  gatewayMetadata: JSON.stringify(result.resultPayload),
                });
              } else if (result.resultStatus === "FAILED") {
                await db.updatePayment(payment.id, {
                  status: "failed",
                  errorMessage: result.resultErrorMessage || "Payment failed",
                });
              } else if (result.resultStatus === "CANCELED") {
                await db.updatePayment(payment.id, {
                  status: "cancelled",
                  errorMessage: result.resultErrorMessage || "Payment canceled",
                });
              }
            }
          );

          return {
            payment,
            internalTraceId,
            status: "pending",
            message: "Betaling sendt til PayPal Reader. Venter på bekreftelse...",
          };
        } catch (error: any) {
          console.error("[createZettlePayment] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "Kunne ikke opprette betaling på iZettle",
          });
        }
      }),

    /**
     * Check status of a Zettle payment
     * 
     * Polls Zettle API for payment status
     * Updates local payment record when completed
     */
    checkZettlePaymentStatus: tenantProcedure
      .input(
        z.object({
          purchaseUUID: z.string(),
          paymentId: z.number().int(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { tenantId } = ctx;
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders, payments, orders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { getPaymentStatus, decryptToken } = await import("./services/izettle");

        // Get Zettle provider
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, tenantId),
              eq(paymentProviders.providerType, "izettle"),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle tilkobling mangler",
          });
        }

        // Decrypt access token
        const accessToken = decryptToken(provider.accessToken);

        // Check payment status on Zettle
        try {
          const zettleStatus = await getPaymentStatus(accessToken, input.purchaseUUID);

          // Update local payment record if status changed
          const [payment] = await dbInstance
            .select()
            .from(payments)
            .where(eq(payments.id, input.paymentId));

          if (!payment) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
          }

          // If payment completed on Zettle, update our records
          if (zettleStatus.status === "PAID" && payment.status !== "completed") {
            // Update payment status
            await dbInstance
              .update(payments)
              .set({
                status: "completed",
                processedAt: new Date(zettleStatus.timestamp),
                gatewayMetadata: JSON.stringify(zettleStatus),
              })
              .where(eq(payments.id, payment.id));

            // Update order status
            if (payment.orderId) {
              await db.updateOrderStatus(payment.orderId, "completed");
            }
          } else if (zettleStatus.status === "FAILED" && payment.status !== "failed") {
            // Update payment as failed
            await dbInstance
              .update(payments)
              .set({
                status: "failed",
                errorMessage: "Payment failed on Zettle reader",
                gatewayMetadata: JSON.stringify(zettleStatus),
              })
              .where(eq(payments.id, payment.id));
          }

          return {
            status: zettleStatus.status,
            amount: zettleStatus.amount,
            currency: zettleStatus.currency,
            timestamp: zettleStatus.timestamp,
          };
        } catch (error: any) {
          console.error("[checkZettlePaymentStatus] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "Kunne ikke hente betalingsstatus fra iZettle",
          });
        }
      }),

    /**
     * Generate a PDF receipt for an order
     * 
     * Returns a base64-encoded PDF that can be downloaded or printed
     */
    generateReceipt: tenantProcedure
      .input(
        z.object({
          orderId: z.number().int(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { tenantId } = ctx;
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders, orderItems, tenants, users, customers, services, products, salonSettings } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { generateReceipt } = await import("./receipt");
        type PrintSettings = import("./receipt").PrintSettings;

        // Get order with tenant info
        const [order] = await dbInstance
          .select({
            order: orders,
            tenant: tenants,
          })
          .from(orders)
          .leftJoin(tenants, eq(orders.tenantId, tenants.id))
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

        if (!order || !order.tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        // Get order items with service/product names
        const items = await dbInstance
          .select({
            orderItem: orderItems,
            service: services,
            product: products,
          })
          .from(orderItems)
          .leftJoin(services, and(
            eq(orderItems.itemType, "service"),
            eq(orderItems.itemId, services.id)
          ))
          .leftJoin(products, and(
            eq(orderItems.itemType, "product"),
            eq(orderItems.itemId, products.id)
          ))
          .where(eq(orderItems.orderId, input.orderId));

        // Get employee name if available
        let employeeName: string | undefined;
        if (order.order.employeeId) {
          const [employee] = await dbInstance
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, order.order.employeeId));
          employeeName = employee?.name ?? undefined;
        }

        // Get customer name if available
        let customerName: string | undefined;
        if (order.order.customerId) {
          const [customer] = await dbInstance
            .select({ firstName: customers.firstName, lastName: customers.lastName })
            .from(customers)
            .where(eq(customers.id, order.order.customerId));
          if (customer) {
            customerName = `${customer.firstName}${customer.lastName ? ' ' + customer.lastName : ''}`;
          }
        }

        // Get payment method
        const { payments } = await import("../drizzle/schema");
        const [payment] = await dbInstance
          .select()
          .from(payments)
          .where(eq(payments.orderId, input.orderId))
          .limit(1);

        const paymentMethod: "cash" | "card" = payment?.paymentMethod === "cash" ? "cash" : "card";

        // Get print settings
        const [settings] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, tenantId))
          .limit(1);

        const printSettings: PrintSettings = {
          printerType: (settings?.printSettings as any)?.printerType || "thermal_80mm",
          fontSize: settings?.printSettings?.fontSize || "medium",
          showLogo: settings?.printSettings?.showLogo ?? true,
          customFooterText: settings?.printSettings?.customFooterText || "Takk for besøket! Velkommen tilbake!",
        };

        // Prepare receipt data
        // orderDate is already a string in YYYY-MM-DD format
        const orderDateStr = order.order.orderDate;
        const orderTimeStr = order.order.orderTime || "00:00:00";
        const fullDateTimeStr = `${orderDateStr}T${orderTimeStr}`;
        
        const receiptData = {
          orderId: order.order.id,
          orderDate: new Date(fullDateTimeStr),
          salonName: order.tenant.name,
          salonAddress: order.tenant.address ?? undefined,
          salonPhone: order.tenant.phone ?? undefined,
          salonEmail: order.tenant.email ?? undefined,
          salonLogoUrl: order.tenant.logoUrl ?? undefined,
          receiptLogoUrl: settings?.receiptLogoUrl ?? undefined,
          items: items.map((item) => ({
            name: item.service?.name || item.product?.name || "Unknown",
            quantity: item.orderItem.quantity ?? 1,
            unitPrice: Number(item.orderItem.unitPrice),
            total: Number(item.orderItem.total),
          })),
          subtotal: Number(order.order.subtotal),
          vatRate: 0.25, // 25% VAT
          vatAmount: Number(order.order.vatAmount),
          total: Number(order.order.total),
          paymentMethod,
          employeeName,
          customerName,
          printSettings,
        };

        // Generate PDF
        const pdfBuffer = await generateReceipt(receiptData);

        // Return base64-encoded PDF
        return {
          pdf: pdfBuffer.toString("base64"),
          filename: `kvittering-${order.order.id}.pdf`,
        };
      }),

    /**
     * Send receipt via email to customer
     * 
     * Generates PDF receipt and sends it as email attachment
     */
    sendReceiptEmail: tenantProcedure
      .input(
        z.object({
          orderId: z.number().int(),
          customerEmail: z.string().email(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { tenantId } = ctx;
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders, orderItems, tenants, users, customers, services, products, salonSettings } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { generateReceipt } = await import("./receipt");
        type PrintSettings = import("./receipt").PrintSettings;
        const { sendReceiptEmail } = await import("./email");

        // Get order with tenant info
        const [order] = await dbInstance
          .select({
            order: orders,
            tenant: tenants,
          })
          .from(orders)
          .leftJoin(tenants, eq(orders.tenantId, tenants.id))
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

        if (!order || !order.tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        // Get order items with service/product details
        const items = await dbInstance
          .select({
            orderItem: orderItems,
            service: services,
            product: products,
          })
          .from(orderItems)
          .leftJoin(services, and(eq(orderItems.itemType, "service"), eq(orderItems.itemId, services.id)))
          .leftJoin(products, and(eq(orderItems.itemType, "product"), eq(orderItems.itemId, products.id)))
          .where(eq(orderItems.orderId, input.orderId));

        // Get customer info
        let customerName = "Walk-in kunde";
        if (order.order.customerId) {
          const [customer] = await dbInstance
            .select()
            .from(customers)
            .where(eq(customers.id, order.order.customerId))
            .limit(1);
          if (customer) {
            customerName = `${customer.firstName} ${customer.lastName}`;
          }
        }

        // Get employee name
        let employeeName: string | undefined;
        if (order.order.employeeId) {
          const [employee] = await dbInstance
            .select()
            .from(users)
            .where(eq(users.id, order.order.employeeId))
            .limit(1);
          if (employee) {
            employeeName = employee.name ?? undefined;
          }
        }

        // Get print settings for logo
        const [settings] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, tenantId))
          .limit(1);

        const printSettings: PrintSettings = {
          printerType: (settings?.printSettings as any)?.printerType || "thermal_80mm",
          fontSize: settings?.printSettings?.fontSize || "medium",
          showLogo: settings?.printSettings?.showLogo ?? true,
          customFooterText: settings?.printSettings?.customFooterText || "Takk for besøket! Velkommen tilbake!",
        };

        // orderDate is already a string in YYYY-MM-DD format
        const orderDateStr = order.order.orderDate;
        const orderTimeStr = order.order.orderTime || "00:00:00";
        const fullDateTimeStr = `${orderDateStr}T${orderTimeStr}`;
        
        // Prepare receipt data
        const receiptData = {
          orderId: order.order.id,
          orderDate: new Date(fullDateTimeStr),
          salonName: order.tenant.name,
          salonAddress: order.tenant.address ?? undefined,
          salonPhone: order.tenant.phone ?? undefined,
          salonEmail: order.tenant.email ?? undefined,
          salonLogoUrl: order.tenant.logoUrl ?? undefined,
          receiptLogoUrl: settings?.receiptLogoUrl ?? undefined,
          items: items.map((item) => ({
            name: item.service?.name || item.product?.name || "Unknown",
            quantity: item.orderItem.quantity ?? 1,
            unitPrice: Number(item.orderItem.unitPrice),
            total: Number(item.orderItem.total),
          })),
          subtotal: Number(order.order.subtotal),
          vatRate: 0.25, // 25% VAT
          vatAmount: Number(order.order.vatAmount),
          total: Number(order.order.total),
          paymentMethod: "cash" as const, // Will be updated based on payment
          employeeName,
          customerName,
          printSettings,
        };

        // Generate PDF
        const pdfBuffer = await generateReceipt(receiptData);
        const filename = `kvittering-${order.order.id}.pdf`;

        // Send email with PDF attachment
        await sendReceiptEmail({
          to: input.customerEmail,
          salonName: order.tenant.name,
          customerName,
          orderId: order.order.id,
          total: `${order.order.total} kr`,
          pdfBuffer,
          filename,
        });

        return {
          success: true,
          message: "Kvittering sendt på e-post",
        };
      }),

    /**
     * Get all orders with optional filters
     */
    getOrders: tenantProcedure
      .input(
        z.object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          paymentMethod: z.enum(["cash", "card"]).optional(),
          customerId: z.number().int().optional(),
          status: z.enum(["pending", "completed", "refunded", "partially_refunded"]).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { tenantId } = ctx;
        return db.getOrdersWithDetails(tenantId, input);
      }),

    /**
     * Get detailed order information by ID
     */
    getOrderDetails: tenantProcedure
      .input(z.object({ orderId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const order = await db.getOrderById(input.orderId, ctx.tenantId);
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        const items = await db.getOrderItems(input.orderId, ctx.tenantId);
        
        return {
          order,
          items,
        };
      }),

    // Get comprehensive financial reports
    getFinancialReport: tenantProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        employeeId: z.number().optional(),
        paymentMethod: z.enum(["cash", "card", "vipps", "stripe", "split"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { orders, payments, orderItems, services, products, users, refunds, paymentSplits } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sql, desc } = await import("drizzle-orm");

        const conditions = [
          eq(orders.tenantId, ctx.tenantId),
          gte(orders.orderDate, input.startDate),
          lte(orders.orderDate, input.endDate),
        ];

        if (input.employeeId) {
          conditions.push(eq(orders.employeeId, input.employeeId));
        }

        // Get orders with payments
        const ordersWithPayments = await dbInstance
          .select({
            order: orders,
            payment: payments,
            employee: users,
          })
          .from(orders)
          .leftJoin(payments, eq(orders.id, payments.orderId))
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(and(...conditions))
          .orderBy(desc(orders.orderDate));

        // Filter by payment method if specified
        let filteredOrders = ordersWithPayments;
        if (input.paymentMethod) {
          filteredOrders = ordersWithPayments.filter(
            (row) => row.payment?.paymentMethod === input.paymentMethod
          );
        }

        // Calculate summary statistics
        const totalSales = filteredOrders.reduce(
          (sum, row) => sum + parseFloat(row.order.total),
          0
        );

        const orderCount = filteredOrders.length;
        const avgOrderValue = orderCount > 0 ? totalSales / orderCount : 0;

        // Get refunds for the period
        const periodRefunds = await dbInstance
          .select()
          .from(refunds)
          .where(
            and(
              eq(refunds.tenantId, ctx.tenantId),
              gte(refunds.createdAt, new Date(input.startDate)),
              lte(refunds.createdAt, new Date(input.endDate)),
              eq(refunds.status, "completed")
            )
          );

        const totalRefunded = periodRefunds.reduce(
          (sum, r) => sum + parseFloat(r.amount),
          0
        );

        // Sales by employee
        const salesByEmployee = await dbInstance
          .select({
            employeeId: orders.employeeId,
            employeeName: users.name,
            orderCount: sql<number>`COUNT(${orders.id})`,
            totalRevenue: sql<string>`SUM(CAST(${orders.total} AS DECIMAL(10,2)))`,
            avgOrderValue: sql<string>`AVG(CAST(${orders.total} AS DECIMAL(10,2)))`,
          })
          .from(orders)
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(and(...conditions))
          .groupBy(orders.employeeId, users.name)
          .orderBy(desc(sql`SUM(CAST(${orders.total} AS DECIMAL(10,2)))`));

        // Sales by payment method
        const salesByPaymentMethod = await dbInstance
          .select({
            paymentMethod: payments.paymentMethod,
            orderCount: sql<number>`COUNT(DISTINCT ${payments.orderId})`,
            totalAmount: sql<string>`SUM(CAST(${payments.amount} AS DECIMAL(10,2)))`,
          })
          .from(payments)
          .innerJoin(orders, eq(payments.orderId, orders.id))
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              gte(orders.orderDate, input.startDate),
              lte(orders.orderDate, input.endDate)
            )
          )
          .groupBy(payments.paymentMethod);

        // Get split payment details
        const splitPaymentDetails = await dbInstance
          .select({
            orderId: paymentSplits.orderId,
            paymentMethod: paymentSplits.paymentMethod,
            amount: paymentSplits.amount,
          })
          .from(paymentSplits)
          .innerJoin(orders, eq(paymentSplits.orderId, orders.id))
          .where(
            and(
              eq(paymentSplits.tenantId, ctx.tenantId),
              gte(orders.orderDate, input.startDate),
              lte(orders.orderDate, input.endDate)
            )
          );

        // Top selling services
        const topServices = await dbInstance
          .select({
            serviceId: orderItems.itemId,
            serviceName: services.name,
            quantity: sql<number>`SUM(${orderItems.quantity})`,
            totalRevenue: sql<string>`SUM(CAST(${orderItems.total} AS DECIMAL(10,2)))`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .leftJoin(services, eq(orderItems.itemId, services.id))
          .where(
            and(
              eq(orderItems.itemType, "service"),
              eq(orders.tenantId, ctx.tenantId),
              gte(orders.orderDate, input.startDate),
              lte(orders.orderDate, input.endDate)
            )
          )
          .groupBy(orderItems.itemId, services.name)
          .orderBy(desc(sql`SUM(CAST(${orderItems.total} AS DECIMAL(10,2)))`));

        // Top selling products
        const topProducts = await dbInstance
          .select({
            productId: orderItems.itemId,
            productName: products.name,
            quantity: sql<number>`SUM(${orderItems.quantity})`,
            totalRevenue: sql<string>`SUM(CAST(${orderItems.total} AS DECIMAL(10,2)))`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .leftJoin(products, eq(orderItems.itemId, products.id))
          .where(
            and(
              eq(orderItems.itemType, "product"),
              eq(orders.tenantId, ctx.tenantId),
              gte(orders.orderDate, input.startDate),
              lte(orders.orderDate, input.endDate)
            )
          )
          .groupBy(orderItems.itemId, products.name)
          .orderBy(desc(sql`SUM(CAST(${orderItems.total} AS DECIMAL(10,2)))`));

        // Sales by time period (hourly distribution)
        const salesByHour = await dbInstance
          .select({
            hour: sql<string>`HOUR(${orders.orderTime})`,
            orderCount: sql<number>`COUNT(${orders.id})`,
            totalRevenue: sql<string>`SUM(CAST(${orders.total} AS DECIMAL(10,2)))`,
          })
          .from(orders)
          .where(and(...conditions))
          .groupBy(sql`HOUR(${orders.orderTime})`)
          .orderBy(sql`HOUR(${orders.orderTime})`);

        return {
          summary: {
            totalSales,
            orderCount,
            avgOrderValue,
            totalRefunded,
            netRevenue: totalSales - totalRefunded,
          },
          salesByEmployee,
          salesByPaymentMethod,
          splitPaymentDetails,
          topServices: topServices.slice(0, 10),
          topProducts: topProducts.slice(0, 10),
          salesByHour,
        };
      }),
  }),

  // ============================================================================
  // WALK-IN QUEUE MANAGEMENT
  // ============================================================================
  walkInQueue: router({
    /**
     * Add customer to walk-in queue
     */
    addToQueue: tenantProcedure
      .input(z.object({
        customerName: z.string().min(1),
        customerPhone: z.string().optional(),
        serviceId: z.number().int(),
        employeeId: z.number().int().optional(),
        priority: z.enum(["normal", "urgent", "vip"]).default("normal"),
        priorityReason: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { walkInQueue } = await import("../drizzle/schema");

        // Get current queue length to set position
        const currentQueue = await dbInstance
          .select()
          .from(walkInQueue)
          .where(and(
            eq(walkInQueue.tenantId, ctx.user.tenantId),
            eq(walkInQueue.status, "waiting")
          ));

        const position = currentQueue.length + 1;

        // Get service duration for estimated wait time
        const { services } = await import("../drizzle/schema");
        const service = await dbInstance
          .select()
          .from(services)
          .where(eq(services.id, input.serviceId))
          .limit(1);

        const estimatedWait = service[0]?.durationMinutes || 30;

        const [entry] = await dbInstance.insert(walkInQueue).values({
          tenantId: ctx.user.tenantId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          serviceId: input.serviceId,
          employeeId: input.employeeId,
          priority: input.priority,
          priorityReason: input.priorityReason,
          position,
          estimatedWaitMinutes: estimatedWait * position,
          status: "waiting",
          notes: input.notes,
        });

        return { success: true, queueId: entry.insertId, position };
      }),

    /**
     * Get current queue
     */
    getQueue: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { walkInQueue, services } = await import("../drizzle/schema");

      const queue = await dbInstance
        .select({
          id: walkInQueue.id,
          customerName: walkInQueue.customerName,
          customerPhone: walkInQueue.customerPhone,
          serviceId: walkInQueue.serviceId,
          serviceName: services.name,
          employeeId: walkInQueue.employeeId,
          priority: walkInQueue.priority,
          priorityReason: walkInQueue.priorityReason,
          position: walkInQueue.position,
          estimatedWaitMinutes: walkInQueue.estimatedWaitMinutes,
          status: walkInQueue.status,
          addedAt: walkInQueue.addedAt,
          notes: walkInQueue.notes,
        })
        .from(walkInQueue)
        .leftJoin(services, eq(walkInQueue.serviceId, services.id))
        .where(and(
          eq(walkInQueue.tenantId, ctx.user.tenantId),
          or(
            eq(walkInQueue.status, "waiting"),
            eq(walkInQueue.status, "in_service")
          )
        ))
        .orderBy(walkInQueue.position);

      return queue;
    }),

    /**
     * Start service for queue entry
     */
    startService: tenantProcedure
      .input(z.object({ queueId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { walkInQueue, services } = await import("../drizzle/schema");

        // Get queue entry with service details
        const queueEntry = await dbInstance
          .select({
            id: walkInQueue.id,
            customerName: walkInQueue.customerName,
            serviceId: walkInQueue.serviceId,
            serviceName: services.name,
            servicePrice: services.price,
          })
          .from(walkInQueue)
          .leftJoin(services, eq(walkInQueue.serviceId, services.id))
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ))
          .limit(1);

        if (!queueEntry || queueEntry.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Queue entry not found" });
        }

        // Update status to in_service
        await dbInstance
          .update(walkInQueue)
          .set({
            status: "in_service",
            startedAt: new Date(),
          })
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ));

        // Return service details for POS redirect
        return {
          success: true,
          serviceId: queueEntry[0].serviceId,
          servicePrice: queueEntry[0].servicePrice,
          serviceName: queueEntry[0].serviceName,
          customerName: queueEntry[0].customerName,
        };
      }),

    /**
     * Complete service for queue entry
     */
    completeService: tenantProcedure
      .input(z.object({ queueId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { walkInQueue, services } = await import("../drizzle/schema");

        // Get queue entry with service details before updating
        const queueEntry = await dbInstance
          .select({
            id: walkInQueue.id,
            customerName: walkInQueue.customerName,
            customerPhone: walkInQueue.customerPhone,
            serviceId: walkInQueue.serviceId,
            serviceName: services.name,
            servicePrice: services.price,
          })
          .from(walkInQueue)
          .leftJoin(services, eq(walkInQueue.serviceId, services.id))
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ))
          .limit(1);

        if (!queueEntry || queueEntry.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Queue entry not found" });
        }

        // Update status to completed
        await dbInstance
          .update(walkInQueue)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ));

        // Return customer and service data for POS
        return {
          success: true,
          customerName: queueEntry[0].customerName,
          customerPhone: queueEntry[0].customerPhone,
          serviceId: queueEntry[0].serviceId,
          serviceName: queueEntry[0].serviceName,
          servicePrice: queueEntry[0].servicePrice,
        };
      }),

    /**
     * Remove from queue
     */
    removeFromQueue: tenantProcedure
      .input(z.object({ queueId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { walkInQueue } = await import("../drizzle/schema");

        await dbInstance
          .update(walkInQueue)
          .set({ status: "canceled" })
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ));

        return { success: true };
      }),

    /**
     * Get available barbers count
     */
    getAvailableBarbers: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { users, walkInQueue } = await import("../drizzle/schema");

      // Get all active employees
      const allEmployees = await dbInstance
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(
          eq(users.tenantId, ctx.user.tenantId),
          eq(users.isActive, true),
          or(
            eq(users.role, "employee"),
            eq(users.role, "admin"),
            eq(users.role, "owner")
          )
        ));

      // Get employees currently serving
      const busyEmployees = await dbInstance
        .select({ employeeId: walkInQueue.employeeId })
        .from(walkInQueue)
        .where(and(
          eq(walkInQueue.tenantId, ctx.user.tenantId),
          eq(walkInQueue.status, "in_service")
        ));

      const busyIds = busyEmployees.map(e => e.employeeId).filter(Boolean);
      const availableCount = allEmployees.length - busyIds.length;

      return {
        total: allEmployees.length,
        available: Math.max(availableCount, 1), // At least 1 to avoid division by zero
        busy: busyIds.length,
      };
    }),

    /**
     * Calculate intelligent wait times for all customers in queue
     * Takes into account:
     * - Service duration
     * - Number of customers ahead
     * - Available staff count
     * - Current in-service customers' remaining time
     * - Priority levels (VIP gets 0.7x multiplier, Urgent gets 0.85x)
     */
    calculateWaitTimes: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { walkInQueue, services, users } = await import("../drizzle/schema");

      // Get all active employees
      const allEmployees = await dbInstance
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.tenantId, ctx.user.tenantId),
          eq(users.isActive, true),
          or(
            eq(users.role, "employee"),
            eq(users.role, "admin"),
            eq(users.role, "owner")
          )
        ));

      const totalStaff = Math.max(allEmployees.length, 1); // At least 1 to avoid division by zero

      // Get customers currently in service with their service duration and start time
      const inServiceCustomers = await dbInstance
        .select({
          id: walkInQueue.id,
          startedAt: walkInQueue.startedAt,
          durationMinutes: services.durationMinutes,
        })
        .from(walkInQueue)
        .leftJoin(services, eq(walkInQueue.serviceId, services.id))
        .where(and(
          eq(walkInQueue.tenantId, ctx.user.tenantId),
          eq(walkInQueue.status, "in_service")
        ));

      // Calculate average remaining time for in-service customers
      const now = new Date();
      let totalRemainingTime = 0;
      for (const customer of inServiceCustomers) {
        if (customer.startedAt && customer.durationMinutes) {
          const elapsedMinutes = Math.floor((now.getTime() - customer.startedAt.getTime()) / (1000 * 60));
          const remainingMinutes = Math.max(customer.durationMinutes - elapsedMinutes, 0);
          totalRemainingTime += remainingMinutes;
        }
      }
      const avgRemainingTime = inServiceCustomers.length > 0 ? totalRemainingTime / inServiceCustomers.length : 0;

      // Get waiting customers with their service details
      const waitingCustomers = await dbInstance
        .select({
          id: walkInQueue.id,
          position: walkInQueue.position,
          priority: walkInQueue.priority,
          durationMinutes: services.durationMinutes,
          addedAt: walkInQueue.addedAt,
        })
        .from(walkInQueue)
        .leftJoin(services, eq(walkInQueue.serviceId, services.id))
        .where(and(
          eq(walkInQueue.tenantId, ctx.user.tenantId),
          eq(walkInQueue.status, "waiting")
        ))
        .orderBy(walkInQueue.position);

      // Calculate wait time for each customer
      const waitTimes: { queueId: number; estimatedWaitMinutes: number; color: string }[] = [];
      let cumulativeTime = avgRemainingTime; // Start with remaining time of in-service customers

      for (let i = 0; i < waitingCustomers.length; i++) {
        const customer = waitingCustomers[i];
        const serviceDuration = customer.durationMinutes || 30; // Default 30 minutes

        // Calculate base wait time (cumulative time divided by available staff)
        let estimatedWait = Math.ceil(cumulativeTime / totalStaff);

        // Apply priority multipliers
        if (customer.priority === "vip") {
          estimatedWait = Math.ceil(estimatedWait * 0.7); // VIP gets 30% faster service
        } else if (customer.priority === "urgent") {
          estimatedWait = Math.ceil(estimatedWait * 0.85); // Urgent gets 15% faster service
        }

        // Determine color based on wait time
        let color = "green"; // 0-15 minutes
        if (estimatedWait > 45) {
          color = "red"; // 46+ minutes
        } else if (estimatedWait > 30) {
          color = "orange"; // 31-45 minutes
        } else if (estimatedWait > 15) {
          color = "yellow"; // 16-30 minutes
        }

        waitTimes.push({
          queueId: customer.id,
          estimatedWaitMinutes: estimatedWait,
          color,
        });

        // Add this customer's service duration to cumulative time for next customer
        cumulativeTime += serviceDuration;
      }

      return {
        waitTimes,
        totalStaff,
        inServiceCount: inServiceCustomers.length,
        waitingCount: waitingCustomers.length,
      };
    }),

    /**
     * Update customer priority in queue
     */
    updatePriority: adminProcedure
      .input(z.object({
        queueId: z.number().int(),
        priority: z.enum(["normal", "urgent", "vip"]),
        priorityReason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { walkInQueue } = await import("../drizzle/schema");

        await dbInstance
          .update(walkInQueue)
          .set({
            priority: input.priority,
            priorityReason: input.priorityReason,
          })
          .where(and(
            eq(walkInQueue.id, input.queueId),
            eq(walkInQueue.tenantId, ctx.user.tenantId)
          ));

        return { success: true };
      }),
  }),

  // ============================================================================
  // SAAS ADMIN PANEL (Platform Owner Only)
  // ============================================================================
  saasAdmin: router({
    /**
     * Get platform-wide overview stats
     */
    getOverview: platformAdminProcedure.query(async () => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants, appointments, orders } = await import("../drizzle/schema");
      const { eq, and, gte, sql } = await import("drizzle-orm");

      // Calculate date 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      // Count tenants by status
      const tenantStats = await dbInstance
        .select({
          status: tenants.status,
          countVal: sql<number>`COUNT(*)`
        })
        .from(tenants)
        .groupBy(tenants.status);

      const totalTenants = tenantStats.reduce((sum, row) => sum + Number(row.countVal), 0);
      const activeTenants = Number(tenantStats.find(row => row.status === 'active')?.countVal ?? 0);
      const trialTenants = Number(tenantStats.find(row => row.status === 'trial')?.countVal ?? 0);
      const suspendedTenants = Number(tenantStats.find(row => row.status === 'suspended')?.countVal ?? 0);
      const canceledTenants = Number(tenantStats.find(row => row.status === 'canceled')?.countVal ?? 0);

      // Count completed appointments last 30 days
      const [appointmentStats] = await dbInstance
        .select({
          countVal: sql<number>`COUNT(*)`
        })
        .from(appointments)
        .where(
          and(
            sql`${appointments.appointmentDate} >= ${thirtyDaysAgoStr}`,
            eq(appointments.status, 'completed')
          )
        );

      // Count orders and sum revenue last 30 days
      const [orderStats] = await dbInstance
        .select({
          countVal: sql<number>`COUNT(*)`,
          totalRevenue: sql<number>`COALESCE(SUM(${orders.total}), 0)`
        })
        .from(orders)
        .where(sql`${orders.orderDate} >= ${thirtyDaysAgoStr}`);

      return {
        totalTenants,
        activeTenants,
        trialTenants,
        suspendedTenants,
        canceledTenants,
        totalAppointmentsLast30Days: Number(appointmentStats?.countVal ?? 0),
        totalOrdersLast30Days: Number(orderStats?.countVal ?? 0),
        totalRevenueFromOrdersLast30Days: Number(orderStats?.totalRevenue ?? 0),
      };
    }),

    /**
     * List all tenants with filtering, search, and pagination
     */
    listTenants: platformAdminProcedure
      .input(z.object({
        search: z.string().optional(),
        status: z.enum(["all", "trial", "active", "suspended", "canceled"]).default("all"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, tenantSubscriptions, subscriptionPlans, users, customers, appointments, orders } = await import("../drizzle/schema");
        const { eq, and, or, like, gte, sql, desc } = await import("drizzle-orm");

        const { search, status, page, pageSize } = input;
        const offset = (page - 1) * pageSize;

        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

        // Build WHERE conditions
        const conditions = [];
        if (status !== "all") {
          conditions.push(eq(tenants.status, status));
        }
        if (search) {
          conditions.push(
            or(
              like(tenants.name, `%${search}%`),
              like(tenants.subdomain, `%${search}%`),
              like(tenants.orgNumber, `%${search}%`)
            )
          );
        }

        // Get total count
        const [countResult] = await dbInstance
          .select({ countVal: sql<number>`COUNT(*)` })
          .from(tenants)
          .where(conditions.length > 0 ? and(...conditions) : undefined);

        const totalItems = Number(countResult?.countVal ?? 0);
        const totalPages = Math.ceil(totalItems / pageSize);

        // Get tenants with subscriptions
        const tenantsData = await dbInstance
          .select({
            id: tenants.id,
            name: tenants.name,
            subdomain: tenants.subdomain,
            orgNumber: tenants.orgNumber,
            status: tenants.status,
            createdAt: tenants.createdAt,
            trialEndsAt: tenants.trialEndsAt,
            planName: subscriptionPlans.displayNameNo,
            planPriceMonthly: subscriptionPlans.priceMonthly,
            currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
          })
          .from(tenants)
          .leftJoin(tenantSubscriptions, eq(tenants.id, tenantSubscriptions.tenantId))
          .leftJoin(subscriptionPlans, eq(tenantSubscriptions.planId, subscriptionPlans.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(tenants.createdAt))
          .limit(pageSize)
          .offset(offset);

        // Get counts for each tenant (employees, customers, appointments, orders)
        const tenantIds = tenantsData.map(t => t.id);
        
        // Count employees
        const employeeCounts = await dbInstance
          .select({
            tenantId: users.tenantId,
            countVal: sql<number>`COUNT(*)`
          })
          .from(users)
          .where(sql`${users.tenantId} IN (${sql.join(tenantIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(users.tenantId);

        // Count customers
        const customerCounts = await dbInstance
          .select({
            tenantId: customers.tenantId,
            countVal: sql<number>`COUNT(*)`
          })
          .from(customers)
          .where(sql`${customers.tenantId} IN (${sql.join(tenantIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(customers.tenantId);

        // Count appointments last 30 days
        const appointmentCounts = await dbInstance
          .select({
            tenantId: appointments.tenantId,
            countVal: sql<number>`COUNT(*)`
          })
          .from(appointments)
          .where(
            and(
              sql`${appointments.tenantId} IN (${sql.join(tenantIds.map(id => sql`${id}`), sql`, `)})`,
              sql`${appointments.appointmentDate} >= ${thirtyDaysAgoStr}`
            )
          )
          .groupBy(appointments.tenantId);

        // Count orders and sum amounts last 30 days
        const orderStats = tenantIds.length > 0 ? await dbInstance
          .select({
            tenantId: orders.tenantId,
            countVal: sql<number>`COUNT(*)`,
            totalAmount: sql<number>`COALESCE(SUM(${orders.total}), 0)`
          })
          .from(orders)
          .where(
            and(
              sql`${orders.tenantId} IN (${sql.join(tenantIds.map(id => sql`${id}`), sql`, `)})`,
              sql`${orders.orderDate} >= ${thirtyDaysAgoStr}`
            )
          )
          .groupBy(orders.tenantId) : [];

        // Combine all data
        const items = tenantsData.map(tenant => {
          const employeeCount = Number(employeeCounts.find(e => e.tenantId === tenant.id)?.countVal ?? 0);
          const customerCount = Number(customerCounts.find(c => c.tenantId === tenant.id)?.countVal ?? 0);
          const appointmentCountLast30Days = Number(appointmentCounts.find(a => a.tenantId === tenant.id)?.countVal ?? 0);
          const orderCount = Number(orderStats.find(o => o.tenantId === tenant.id)?.countVal ?? 0);
          const orderAmount = Number(orderStats.find(o => o.tenantId === tenant.id)?.totalAmount ?? 0);

          return {
            id: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
            orgNumber: tenant.orgNumber,
            status: tenant.status,
            createdAt: tenant.createdAt.toISOString(),
            trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
            planName: tenant.planName ?? null,
            planPriceMonthly: tenant.planPriceMonthly ?? null,
            currentPeriodEnd: tenant.currentPeriodEnd?.toISOString() ?? null,
            employeeCount,
            customerCount,
            appointmentCountLast30Days,
            orderCountLast30Days: orderCount,
            totalOrderAmountLast30Days: orderAmount,
          };
        });

        return {
          items,
          page,
          pageSize,
          totalItems,
          totalPages,
        };
      }),

    /**
     * Get detailed information for a single tenant
     */
    getTenantDetails: platformAdminProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, tenantSubscriptions, subscriptionPlans, users, customers, appointments, orders } = await import("../drizzle/schema");
        const { eq, and, gte, sql } = await import("drizzle-orm");

        // Get tenant info
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Get subscription info
        const [subscription] = await dbInstance
          .select({
            planId: subscriptionPlans.id,
            planName: subscriptionPlans.displayNameNo,
            status: tenantSubscriptions.status,
            priceMonthly: subscriptionPlans.priceMonthly,
            currentPeriodStart: tenantSubscriptions.currentPeriodStart,
            currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
            stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
          })
          .from(tenantSubscriptions)
          .leftJoin(subscriptionPlans, eq(tenantSubscriptions.planId, subscriptionPlans.id))
          .where(eq(tenantSubscriptions.tenantId, input.tenantId))
          .orderBy(desc(tenantSubscriptions.currentPeriodEnd))
          .limit(1);

        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

        // Get usage stats
        const [customerCount] = await dbInstance
          .select({ countVal: sql<number>`COUNT(*)` })
          .from(customers)
          .where(eq(customers.tenantId, input.tenantId));

        const [employeeCount] = await dbInstance
          .select({ countVal: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.tenantId, input.tenantId));

        const [appointmentStats] = await dbInstance
          .select({
            total: sql<number>`COUNT(*)`,
            completed: sql<number>`SUM(CASE WHEN ${appointments.status} = 'completed' THEN 1 ELSE 0 END)`
          })
          .from(appointments)
          .where(eq(appointments.tenantId, input.tenantId));

        const [appointmentsLast30] = await dbInstance
          .select({ countVal: sql<number>`COUNT(*)` })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              sql`${appointments.appointmentDate} >= ${thirtyDaysAgoStr}`
            )
          );

        const [orderStats] = await dbInstance
          .select({
            total: sql<number>`COUNT(*)`,
            totalAmount: sql<number>`COALESCE(SUM(${orders.total}), 0)`
          })
          .from(orders)
          .where(eq(orders.tenantId, input.tenantId));

        const [ordersLast30] = await dbInstance
          .select({
            countVal: sql<number>`COUNT(*)`,
            totalAmount: sql<number>`COALESCE(SUM(${orders.total}), 0)`
          })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, input.tenantId),
              sql`${orders.orderDate} >= ${thirtyDaysAgoStr}`
            )
          );

        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
            orgNumber: tenant.orgNumber,
            status: tenant.status,
            createdAt: tenant.createdAt.toISOString(),
            trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
          },
          subscription: subscription ? {
            planId: subscription.planId,
            planName: subscription.planName ?? "Unknown",
            status: subscription.status,
            priceMonthly: subscription.priceMonthly ?? 0,
            currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? "",
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? "",
            stripeSubscriptionId: subscription.stripeSubscriptionId,
          } : null,
          usage: {
            totalCustomers: Number(customerCount?.countVal ?? 0),
            totalEmployees: Number(employeeCount?.countVal ?? 0),
            totalAppointments: Number(appointmentStats?.total ?? 0),
            totalCompletedAppointments: Number(appointmentStats?.completed ?? 0),
            totalOrders: Number(orderStats?.total ?? 0),
            totalOrderAmount: Number(orderStats?.totalAmount ?? 0),
            last30DaysAppointments: Number(appointmentsLast30?.countVal ?? 0),
            last30DaysOrders: Number(ordersLast30?.countVal ?? 0),
            last30DaysOrderAmount: Number(ordersLast30?.totalAmount ?? 0),
          },
        };
      }),

    /**
     * Update tenant plan and/or status
     */
    updateTenantPlanAndStatus: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
        status: z.enum(["trial", "active", "suspended", "canceled"]).optional(),
        planId: z.number().int().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, tenantSubscriptions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Update tenant status if provided
        if (input.status) {
          await dbInstance
            .update(tenants)
            .set({ status: input.status })
            .where(eq(tenants.id, input.tenantId));
        }

        // Update or create subscription if planId provided
        if (input.planId !== undefined) {
          // Check if subscription exists
          const [existing] = await dbInstance
            .select()
            .from(tenantSubscriptions)
            .where(eq(tenantSubscriptions.tenantId, input.tenantId))
            .orderBy(desc(tenantSubscriptions.currentPeriodEnd))
            .limit(1);

          if (existing && input.planId !== null) {
            // Update existing subscription
            await dbInstance
              .update(tenantSubscriptions)
              .set({
                planId: input.planId,
                status: "active",
              })
              .where(eq(tenantSubscriptions.id, existing.id));
          } else if (input.planId !== null) {
            // Create new subscription
            const now = new Date();
            const oneMonthLater = new Date(now);
            oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

            await dbInstance
              .insert(tenantSubscriptions)
              .values({
                tenantId: input.tenantId,
                planId: input.planId,
                status: "active",
                currentPeriodStart: now,
                currentPeriodEnd: oneMonthLater,
                stripeSubscriptionId: null,
              });
          }
        }

        // Return updated tenant info
        const [updatedTenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        return {
          success: true,
          tenant: updatedTenant,
        };
      }),

    /**
     * Get list of available subscription plans
     */
    getSubscriptionPlans: platformAdminProcedure.query(async () => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { subscriptionPlans } = await import("../drizzle/schema");

      const plans = await dbInstance
        .select()
        .from(subscriptionPlans);

      return plans;
    }),

    /**
     * Create a new subscription plan
     */
    createSubscriptionPlan: platformAdminProcedure
      .input(z.object({
        name: z.string().min(1),
        displayNameNo: z.string().min(1),
        displayNameEn: z.string().optional(),
        priceMonthly: z.number().min(0),
        priceYearly: z.number().min(0).optional(),
        maxEmployees: z.number().min(0).optional(),
        maxCustomers: z.number().min(0).optional(),
        maxAppointmentsPerMonth: z.number().min(0).optional(),
        features: z.string().optional(),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { subscriptionPlans } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if plan name already exists
        const [existing] = await dbInstance
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.name, input.name));

        if (existing) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Plan name already exists" });
        }

        // Create new plan
        const [newPlan] = await dbInstance
          .insert(subscriptionPlans)
          .values({
            name: input.name,
            displayNameNo: input.displayNameNo,
            priceMonthly: String(input.priceMonthly),
            maxEmployees: input.maxEmployees || null,
            features: input.features ? JSON.parse(`["${input.features.split(',').map((f: string) => f.trim()).join('","')}"]`) : null,
            isActive: input.isActive,
          })
          .$returningId();

        return {
          success: true,
          planId: newPlan.id,
          message: "Plan created successfully",
        };
      }),

    /**
     * Update an existing subscription plan
     */
    updateSubscriptionPlan: platformAdminProcedure
      .input(z.object({
        planId: z.number(),
        name: z.string().min(1).optional(),
        displayNameNo: z.string().min(1).optional(),
        displayNameEn: z.string().optional(),
        priceMonthly: z.number().min(0).optional(),
        priceYearly: z.number().min(0).optional(),
        maxEmployees: z.number().min(0).nullable().optional(),
        maxCustomers: z.number().min(0).nullable().optional(),
        maxAppointmentsPerMonth: z.number().min(0).nullable().optional(),
        features: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { subscriptionPlans } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if plan exists
        const [existing] = await dbInstance
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, input.planId));

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
        }

        // Check if new name conflicts with another plan
        if (input.name && input.name !== existing.name) {
          const [conflict] = await dbInstance
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.name, input.name));

          if (conflict) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Plan name already exists" });
          }
        }

        // Build update object
        const updateData: Record<string, any> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.displayNameNo !== undefined) updateData.displayNameNo = input.displayNameNo;
        if (input.displayNameEn !== undefined) updateData.displayNameEn = input.displayNameEn;
        if (input.priceMonthly !== undefined) updateData.priceMonthly = input.priceMonthly;
        if (input.priceYearly !== undefined) updateData.priceYearly = input.priceYearly;
        if (input.maxEmployees !== undefined) updateData.maxEmployees = input.maxEmployees;
        if (input.maxCustomers !== undefined) updateData.maxCustomers = input.maxCustomers;
        if (input.maxAppointmentsPerMonth !== undefined) updateData.maxAppointmentsPerMonth = input.maxAppointmentsPerMonth;
        if (input.features !== undefined) updateData.features = input.features;
        if (input.isActive !== undefined) updateData.isActive = input.isActive;

        // Update plan
        await dbInstance
          .update(subscriptionPlans)
          .set(updateData)
          .where(eq(subscriptionPlans.id, input.planId));

        return {
          success: true,
          message: "Plan updated successfully",
        };
      }),

    /**
     * Delete a subscription plan (soft delete by setting isActive to false)
     */
    deleteSubscriptionPlan: platformAdminProcedure
      .input(z.object({ planId: z.number() }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { subscriptionPlans, tenantSubscriptions } = await import("../drizzle/schema");
        const { eq, sql } = await import("drizzle-orm");

        // Check if plan exists
        const [existing] = await dbInstance
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, input.planId));

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
        }

        // Check if any tenants are using this plan
        const [activeSubscriptions] = await dbInstance
          .select({ count: sql<number>`COUNT(*)` })
          .from(tenantSubscriptions)
          .where(eq(tenantSubscriptions.planId, input.planId));

        if (Number(activeSubscriptions?.count || 0) > 0) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: `Cannot delete plan. ${activeSubscriptions?.count} tenant(s) are using this plan.` 
          });
        }

        // Soft delete by setting isActive to false
        await dbInstance
          .update(subscriptionPlans)
          .set({ isActive: false })
          .where(eq(subscriptionPlans.id, input.planId));

        return {
          success: true,
          message: "Plan deleted successfully",
        };
      }),

    /**
     * Impersonate a tenant (platform owner only)
     */
    impersonateTenant: platformAdminProcedure
      .input(z.object({ tenantId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Verify tenant exists
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Create new session with impersonation
        const { sdk } = await import("./_core/sdk");
        const { COOKIE_NAME } = await import("@shared/const");
        const { getSessionCookieOptions } = await import("./_core/cookies");
        const { ENV } = await import("./_core/env");

        const newToken = await sdk.signSession({
          openId: ctx.user.openId,
          appId: ENV.appId,
          name: ctx.user.name ?? "",
          impersonatedTenantId: input.tenantId,
        });

        // Set new session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, newToken, cookieOptions);

        return {
          success: true,
          redirectUrl: "/dashboard",
          tenantId: input.tenantId,
          tenantName: tenant.name,
        };
      }),

    /**
     * Clear impersonation and return to platform admin
     */
    clearImpersonation: platformAdminProcedure
      .mutation(async ({ ctx }) => {
        // Clear the current session cookie completely
        const { COOKIE_NAME } = await import("@shared/const");
        const { getSessionCookieOptions } = await import("./_core/cookies");

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

        return {
          success: true,
          redirectUrl: "/",
        };
      }),

    /**
     * Get service templates for onboarding
     */
    getServiceTemplates: platformAdminProcedure
      .input(z.object({
        salonType: z.enum(["frisør", "barber", "skjønnhet"]),
      }))
      .query(async ({ input }) => {
        // Service templates by salon type
        const templates = {
          frisør: [
            { name: "Klipp dame", duration: 60, price: 550 },
            { name: "Klipp herre", duration: 30, price: 350 },
            { name: "Farge", duration: 90, price: 850 },
            { name: "Føning", duration: 45, price: 400 },
            { name: "Permanent", duration: 120, price: 1200 },
            { name: "Høylys", duration: 90, price: 950 },
            { name: "Behandling", duration: 30, price: 250 },
            { name: "Klipp + Føning", duration: 90, price: 850 },
          ],
          barber: [
            { name: "Klipp", duration: 30, price: 350 },
            { name: "Skjegg", duration: 20, price: 200 },
            { name: "Klipp + Skjegg", duration: 45, price: 500 },
            { name: "Fade", duration: 40, price: 400 },
            { name: "Maskin", duration: 20, price: 250 },
            { name: "Barbering", duration: 30, price: 300 },
            { name: "Barn (0-12 år)", duration: 20, price: 250 },
          ],
          skjønnhet: [
            { name: "Ansiktsbehandling", duration: 60, price: 750 },
            { name: "Massasje 60 min", duration: 60, price: 850 },
            { name: "Massasje 30 min", duration: 30, price: 500 },
            { name: "Voksing ansikt", duration: 20, price: 250 },
            { name: "Voksing ben", duration: 30, price: 400 },
            { name: "Manikyr", duration: 45, price: 450 },
            { name: "Pedikyr", duration: 60, price: 550 },
            { name: "Gellack", duration: 45, price: 400 },
            { name: "Vipper og bryn", duration: 30, price: 350 },
          ],
        };

        return templates[input.salonType] || [];
      }),

    /**
     * Check if subdomain is available
     */
    checkSubdomainAvailability: platformAdminProcedure
      .input(z.object({ subdomain: z.string().min(1) }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [existing] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.subdomain, input.subdomain.toLowerCase()));

        return { available: !existing };
      }),

    /**
     * Check if organization number is available
     */
    checkOrgNumberAvailability: platformAdminProcedure
      .input(z.object({ orgNumber: z.string().min(1) }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [existing] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.orgNumber, input.orgNumber));

        return { available: !existing };
      }),

    /**
     * Create tenant with complete onboarding
     */
    createTenantWithOnboarding: platformAdminProcedure
      .input(z.object({
        // Basic info
        name: z.string().min(1),
        subdomain: z.string().min(1),
        orgNumber: z.string().min(1),
        contactEmail: z.string().email(),
        contactPhone: z.string().min(1),
        // Plan
        planId: z.number().int(),
        // Admin user
        adminFirstName: z.string().min(1),
        adminLastName: z.string().min(1),
        adminEmail: z.string().email(),
        adminPhone: z.string().min(1),
        // Services
        salonType: z.enum(["frisør", "barber", "skjønnhet"]),
        services: z.array(z.object({
          name: z.string(),
          duration: z.number(),
          price: z.number(),
        })),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, users, services, tenantSubscriptions, settings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const bcrypt = await import("bcrypt");

        // Check subdomain uniqueness
        const [existingSubdomain] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.subdomain, input.subdomain.toLowerCase()));

        if (existingSubdomain) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Subdomain already exists" });
        }

        // Check org number uniqueness
        const [existingOrgNumber] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.orgNumber, input.orgNumber));

        if (existingOrgNumber) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Organization number already exists" });
        }

        // Generate secure password (8 characters: letters + numbers)
        const generatePassword = () => {
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
          let password = "";
          for (let i = 0; i < 8; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return password;
        };

        const generatedPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        // Generate unique tenant ID
        const tenantId = `tenant-${Date.now()}`;

        try {
          // Start transaction by creating tenant
          await dbInstance.insert(tenants).values({
            id: tenantId,
            name: input.name,
            subdomain: input.subdomain.toLowerCase(),
            orgNumber: input.orgNumber,
            email: input.contactEmail,
            phone: input.contactPhone,
            status: "trial",
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
          });

          // Create admin user
          await dbInstance.insert(users).values({
            tenantId,
            openId: `admin-${tenantId}`,
            name: `${input.adminFirstName} ${input.adminLastName}`,
            email: input.adminEmail,
            phone: input.adminPhone,
            role: "admin",
          });

          // Create subscription
          const now = new Date();
          const oneMonthLater = new Date(now);
          oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

          await dbInstance.insert(tenantSubscriptions).values({
            tenantId,
            planId: input.planId,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: oneMonthLater,
            stripeSubscriptionId: null,
          });

          // Create services
          for (const service of input.services) {
            await dbInstance.insert(services).values({
              tenantId,
              name: service.name,
              durationMinutes: service.duration,
              price: service.price.toString(),
              isActive: true,
            });
          }

          // Create default settings (key-value pairs)
          const defaultSettings = [
            { settingKey: "salonName", settingValue: input.name },
            { settingKey: "salonAddress", settingValue: "" },
            { settingKey: "salonPhone", settingValue: input.contactPhone },
            { settingKey: "salonEmail", settingValue: input.contactEmail },
            { settingKey: "requirePrepayment", settingValue: "false" },
            { settingKey: "cancellationWindowHours", settingValue: "24" },
            { settingKey: "noShowThresholdForPrepayment", settingValue: "2" },
          ];

          for (const setting of defaultSettings) {
            await dbInstance.insert(settings).values({
              tenantId,
              settingKey: setting.settingKey,
              settingValue: setting.settingValue,
            });
          }

          return {
            success: true,
            tenantId,
            subdomain: input.subdomain.toLowerCase(),
            adminEmail: input.adminEmail,
            generatedPassword,
            message: "Tenant created successfully",
          };
        } catch (error) {
          // If any step fails, the database will rollback automatically
          console.error("Error creating tenant:", error);
          throw new TRPCError({ 
            code: "INTERNAL_SERVER_ERROR", 
            message: "Failed to create tenant. Please try again." 
          });
        }
      }),

    /**
     * Suspend a tenant (set status to suspended)
     */
    suspendTenant: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if tenant exists
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Update tenant status to suspended
        await dbInstance
          .update(tenants)
          .set({ status: "suspended" })
          .where(eq(tenants.id, input.tenantId));

        return {
          success: true,
          message: `Tenant "${tenant.name}" has been suspended`,
        };
      }),

    /**
     * Reactivate a suspended tenant
     */
    reactivateTenant: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if tenant exists
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Update tenant status to active
        await dbInstance
          .update(tenants)
          .set({ status: "active" })
          .where(eq(tenants.id, input.tenantId));

        return {
          success: true,
          message: `Tenant "${tenant.name}" has been reactivated`,
        };
      }),

    /**
     * Delete a tenant (soft delete by setting status to canceled)
     */
    deleteTenant: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
        confirmName: z.string(), // User must type tenant name to confirm
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, users, customers, appointments, services } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if tenant exists
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Verify confirmation name matches
        if (input.confirmName !== tenant.name) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "Confirmation name does not match. Please type the exact salon name to confirm deletion." 
          });
        }

        // Soft delete: set status to canceled
        await dbInstance
          .update(tenants)
          .set({ status: "canceled" })
          .where(eq(tenants.id, input.tenantId));

        // Deactivate all users
        await dbInstance
          .update(users)
          .set({ isActive: false })
          .where(eq(users.tenantId, input.tenantId));

        return {
          success: true,
          message: `Tenant "${tenant.name}" has been deleted`,
        };
      }),

    /**
     * Permanently delete a tenant and all its data (hard delete)
     */
    permanentlyDeleteTenant: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
        confirmName: z.string(),
        confirmPermanent: z.literal("DELETE PERMANENTLY"),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants, users, customers, appointments, services, products, orders, payments, notifications, auditLogs, employeeSchedules, timesheets, expenses, loyaltyPoints, loyaltyTransactions, tenantSubscriptions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if tenant exists
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId));

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        }

        // Verify confirmation name matches
        if (input.confirmName !== tenant.name) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "Confirmation name does not match" 
          });
        }

        // Delete all related data in order (respecting foreign keys)
        try {
          // Delete timesheets
          await dbInstance.delete(timesheets).where(eq(timesheets.tenantId, input.tenantId));
          
          // Delete loyalty data
          await dbInstance.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, input.tenantId));
          await dbInstance.delete(loyaltyPoints).where(eq(loyaltyPoints.tenantId, input.tenantId));
          
          // Delete financial data
          await dbInstance.delete(expenses).where(eq(expenses.tenantId, input.tenantId));
          await dbInstance.delete(payments).where(eq(payments.tenantId, input.tenantId));
          await dbInstance.delete(orders).where(eq(orders.tenantId, input.tenantId));
          
          // Delete appointments
          await dbInstance.delete(appointments).where(eq(appointments.tenantId, input.tenantId));
          
          // Delete schedules - employeeSchedules doesn't have tenantId, need to delete via employee IDs
          // This is handled by cascade when users are deleted
          
          // Delete products and services
          await dbInstance.delete(products).where(eq(products.tenantId, input.tenantId));
          await dbInstance.delete(services).where(eq(services.tenantId, input.tenantId));
          
          // Delete customers
          await dbInstance.delete(customers).where(eq(customers.tenantId, input.tenantId));
          
          // Delete notifications and audit logs
          await dbInstance.delete(notifications).where(eq(notifications.tenantId, input.tenantId));
          await dbInstance.delete(auditLogs).where(eq(auditLogs.tenantId, input.tenantId));
          
          // Delete users
          await dbInstance.delete(users).where(eq(users.tenantId, input.tenantId));
          
          // Delete subscription
          await dbInstance.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, input.tenantId));
          
          // Finally delete tenant
          await dbInstance.delete(tenants).where(eq(tenants.id, input.tenantId));

          return {
            success: true,
            message: `Tenant "${tenant.name}" and all its data have been permanently deleted`,
          };
        } catch (error) {
          console.error("Error permanently deleting tenant:", error);
          throw new TRPCError({ 
            code: "INTERNAL_SERVER_ERROR", 
            message: "Failed to delete tenant. Some data may remain." 
          });
        }
      }),

    // Get tenant owner details for editing
    getTenantOwner: platformAdminProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        
        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [owner] = await dbInstance
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            phone: users.phone,
          })
          .from(users)
          .where(and(
            eq(users.tenantId, input.tenantId),
            eq(users.role, "owner")
          ))
          .limit(1);

        if (!owner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant owner not found" });
        }

        return owner;
      }),

    // Update tenant owner credentials
    updateTenantOwnerCredentials: platformAdminProcedure
      .input(z.object({
        tenantId: z.string(),
        email: z.string().email().optional(),
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        newPassword: z.string().min(6).optional(),
      }))
      .mutation(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        
        const { users } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Find the owner
        const [owner] = await dbInstance
          .select()
          .from(users)
          .where(and(
            eq(users.tenantId, input.tenantId),
            eq(users.role, "owner")
          ))
          .limit(1);

        if (!owner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tenant owner not found" });
        }

        // Check if email is being changed and if it's already in use
        if (input.email && input.email !== owner.email) {
          const [existingUser] = await dbInstance
            .select()
            .from(users)
            .where(eq(users.email, input.email))
            .limit(1);

          if (existingUser) {
            throw new TRPCError({ code: "CONFLICT", message: "E-postadressen er allerede i bruk" });
          }
        }

        // Build update object
        const updateData: Record<string, unknown> = {};
        if (input.email) updateData.email = input.email;
        if (input.name) updateData.name = input.name;
        if (input.phone !== undefined) updateData.phone = input.phone;

        // Hash new password if provided
        if (input.newPassword) {
          const bcrypt = await import("bcrypt");
          updateData.passwordHash = await bcrypt.hash(input.newPassword, 10);
        }

        if (Object.keys(updateData).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No changes provided" });
        }

        // Update the owner
        await dbInstance
          .update(users)
          .set(updateData)
          .where(eq(users.id, owner.id));

        return {
          success: true,
          message: "Brukerinformasjon oppdatert",
        };
      }),
  }),

  // ============================================================================
  // UNIMICRO ACCOUNTING INTEGRATION
  // ============================================================================
  unimicro: router({
    // Get Unimicro settings for current tenant
    getSettings: adminProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const { unimicroSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      
      const [settings] = await dbInstance
        .select()
        .from(unimicroSettings)
        .where(eq(unimicroSettings.tenantId, ctx.tenantId))
        .limit(1);
      
      if (!settings) {
        // Return default settings if not configured yet
        return {
          enabled: false,
          syncFrequency: "daily" as const,
          syncHour: 23,
          syncMinute: 0,
          lastSyncAt: null,
          lastSyncStatus: null,
        };
      }
      
      // Don't expose sensitive data to frontend
      return {
        enabled: settings.enabled,
        companyId: settings.companyId,
        syncFrequency: settings.syncFrequency,
        syncDayOfWeek: settings.syncDayOfWeek,
        syncDayOfMonth: settings.syncDayOfMonth,
        syncHour: settings.syncHour,
        syncMinute: settings.syncMinute,
        lastSyncAt: settings.lastSyncAt,
        nextSyncAt: settings.nextSyncAt,
        lastSyncStatus: settings.lastSyncStatus,
        lastSyncErrors: settings.lastSyncErrors,
      };
    }),
    
    // Update Unimicro settings
    updateSettings: adminProcedure
      .input(z.object({
        enabled: z.boolean().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        companyId: z.number().optional(),
        syncFrequency: z.enum(["daily", "weekly", "monthly", "manual", "custom"]).optional(),
        syncDayOfWeek: z.number().min(0).max(6).optional(),
        syncDayOfMonth: z.number().min(-1).max(31).optional(),
        syncHour: z.number().min(0).max(23).optional(),
        syncMinute: z.number().min(0).max(59).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        
        const { unimicroSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        // Check if settings exist
        const [existing] = await dbInstance
          .select()
          .from(unimicroSettings)
          .where(eq(unimicroSettings.tenantId, ctx.tenantId))
          .limit(1);
        
        if (existing) {
          // Update existing settings
          await dbInstance
            .update(unimicroSettings)
            .set(input)
            .where(eq(unimicroSettings.tenantId, ctx.tenantId));
        } else {
          // Create new settings
          await dbInstance.insert(unimicroSettings).values({
            tenantId: ctx.tenantId,
            ...input,
          });
        }
        
        return { success: true };
      }),
    
    // Test connection to Unimicro API
    testConnection: adminProcedure.mutation(async ({ ctx }) => {
      try {
        const { getUnimicroClient } = await import("./unimicro/client");
        const client = await getUnimicroClient(ctx.tenantId);
        const isConnected = await client.testConnection();
        
        return {
          success: isConnected,
          message: isConnected ? "Tilkobling vellykket!" : "Tilkobling mislyktes",
        };
      } catch (error: any) {
        return {
          success: false,
          message: error.message || "Ukjent feil",
        };
      }
    }),
    
    // Get sync logs
    getSyncLogs: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
        operation: z.enum(["invoice_sync", "customer_sync", "payment_sync", "full_sync", "test_connection"]).optional(),
        status: z.enum(["success", "failed", "partial"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        
        const { unimicroSyncLog } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        
        const conditions = [eq(unimicroSyncLog.tenantId, ctx.tenantId)];
        if (input.operation) conditions.push(eq(unimicroSyncLog.operation, input.operation));
        if (input.status) conditions.push(eq(unimicroSyncLog.status, input.status));
        
        const logs = await dbInstance
          .select()
          .from(unimicroSyncLog)
          .where(and(...conditions))
          .orderBy(desc(unimicroSyncLog.createdAt))
          .limit(input.limit);
        
        return logs;
      }),
    
    // Sync single customer to Unimicro
    syncCustomer: adminProcedure
      .input(z.object({ customerId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { syncCustomerToUnimicro } = await import("./unimicro/customers");
        return syncCustomerToUnimicro(ctx.tenantId, input.customerId);
      }),
    
    // Sync multiple customers to Unimicro
    syncCustomers: adminProcedure
      .input(z.object({ customerIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        const { syncCustomersToUnimicro } = await import("./unimicro/customers");
        return syncCustomersToUnimicro(ctx.tenantId, input.customerIds);
      }),
    
    // Get customer sync status
    getCustomerSyncStatus: adminProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCustomerSyncStatus } = await import("./unimicro/customers");
        return getCustomerSyncStatus(ctx.tenantId, input.customerId);
      }),
    
    // Get unsynced customers
    getUnsyncedCustomers: adminProcedure.query(async ({ ctx }) => {
      const { getUnsyncedCustomers } = await import("./unimicro/customers");
      return getUnsyncedCustomers(ctx.tenantId);
    }),
    
    // Sync single order/invoice to Unimicro
    syncOrder: adminProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { syncOrderToUnimicro } = await import("./unimicro/invoices");
        return syncOrderToUnimicro(ctx.tenantId, input.orderId);
      }),
    
    // Sync multiple orders/invoices to Unimicro
    syncOrders: adminProcedure
      .input(z.object({ orderIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        const { syncOrdersToUnimicro } = await import("./unimicro/invoices");
        return syncOrdersToUnimicro(ctx.tenantId, input.orderIds);
      }),
    
    // Get unsynced orders
    getUnsyncedOrders: adminProcedure.query(async ({ ctx }) => {
      const { getUnsyncedOrders } = await import("./unimicro/invoices");
      return getUnsyncedOrders(ctx.tenantId);
    }),
    
    // Sync payment to Unimicro
    syncPayment: adminProcedure
      .input(z.object({ paymentId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { syncPaymentToUnimicro } = await import("./unimicro/payments");
        return syncPaymentToUnimicro(ctx.tenantId, input.paymentId);
      }),
    
    // Sync refund to Unimicro as credit note
    syncRefund: adminProcedure
      .input(z.object({ refundId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { syncRefundToUnimicro } = await import("./unimicro/payments");
        return syncRefundToUnimicro(ctx.tenantId, input.refundId);
      }),
    
    // Update invoice status
    updateInvoiceStatus: adminProcedure
      .input(z.object({ 
        orderId: z.number(),
        status: z.enum(['Draft', 'Invoiced', 'Paid', 'Cancelled']),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateInvoiceStatus } = await import("./unimicro/payments");
        return updateInvoiceStatus(ctx.tenantId, input.orderId, input.status);
      }),
    
    // Manual sync trigger (full sync - customers + orders)
    manualSync: adminProcedure.mutation(async ({ ctx }) => {
      const results = {
        customers: { processed: 0, failed: 0 },
        orders: { processed: 0, failed: 0 },
        errors: [] as Array<{ type: string; id: number; error: string }>,
      };
      
      // 1. Sync customers first
      const { getUnsyncedCustomers, syncCustomersToUnimicro } = await import("./unimicro/customers");
      const unsyncedCustomers = await getUnsyncedCustomers(ctx.tenantId);
      
      if (unsyncedCustomers.length > 0) {
        const customerResult = await syncCustomersToUnimicro(
          ctx.tenantId,
          unsyncedCustomers.map(c => c.id)
        );
        results.customers.processed = customerResult.processed;
        results.customers.failed = customerResult.failed;
        results.errors.push(...customerResult.errors.map(e => ({ type: 'customer', id: e.customerId, error: e.error })));
      }
      
      // 2. Sync orders/invoices
      const { getUnsyncedOrders, syncOrdersToUnimicro } = await import("./unimicro/invoices");
      const unsyncedOrders = await getUnsyncedOrders(ctx.tenantId);
      
      if (unsyncedOrders.length > 0) {
        const orderResult = await syncOrdersToUnimicro(
          ctx.tenantId,
          unsyncedOrders.map(o => o.id)
        );
        results.orders.processed = orderResult.processed;
        results.orders.failed = orderResult.failed;
        results.errors.push(...orderResult.errors.map(e => ({ type: 'order', id: e.orderId, error: e.error })));
      }
      
      const totalProcessed = results.customers.processed + results.orders.processed;
      const totalFailed = results.customers.failed + results.orders.failed;
      
      return {
        success: totalFailed === 0,
        message: `Synkronisert ${results.customers.processed} kunder og ${results.orders.processed} fakturaer. ${totalFailed} feilet.`,
        customers: results.customers,
        orders: results.orders,
        errors: results.errors,
      };
    }),
  }),

  // ============================================================================
  // BACKUPS
  // ============================================================================
  backups: router({
    // Create manual backup
    create: adminProcedure.mutation(async ({ ctx }) => {
      const { createDatabaseBackup } = await import("./backup");
      return createDatabaseBackup(ctx.tenantId, ctx.user.id);
    }),

    // List all backups
    list: adminProcedure.query(async ({ ctx }) => {
      const { listBackups } = await import("./backup");
      return listBackups(ctx.tenantId);
    }),

    // Delete a backup
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteBackup } = await import("./backup");
        return deleteBackup(input.id, ctx.tenantId);
      }),

    // Download backup SQL
    download: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { regenerateBackupSQL } = await import("./backup");
        const sqlContent = await regenerateBackupSQL(input.id, ctx.tenantId);
        return { sqlContent };
      }),
  }),

  // ============================================================================
  // DATA IMPORTS
  // ============================================================================
  imports: router({
    // Import customers from CSV/Excel
    importCustomers: adminProcedure
      .input(z.object({
        fileContent: z.string(), // base64 encoded file
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { importCustomersFromFile } = await import("./import");
        const fileBuffer = Buffer.from(input.fileContent, "base64");
        return importCustomersFromFile(ctx.tenantId, fileBuffer, input.fileName, ctx.user.id);
      }),

    // Import services from CSV/Excel
    importServices: adminProcedure
      .input(z.object({
        fileContent: z.string(),
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { importServicesFromFile } = await import("./import");
        const fileBuffer = Buffer.from(input.fileContent, "base64");
        return importServicesFromFile(ctx.tenantId, fileBuffer, input.fileName, ctx.user.id);
      }),

    // Import products from CSV/Excel
    importProducts: adminProcedure
      .input(z.object({
        fileContent: z.string(),
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { importProductsFromFile } = await import("./import");
        const fileBuffer = Buffer.from(input.fileContent, "base64");
        return importProductsFromFile(ctx.tenantId, fileBuffer, input.fileName, ctx.user.id);
      }),

    // Restore from SQL backup
    restoreSQL: adminProcedure
      .input(z.object({
        fileContent: z.string(),
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { restoreFromSQL } = await import("./import");
        const fileBuffer = Buffer.from(input.fileContent, "base64");
        return restoreFromSQL(ctx.tenantId, fileBuffer, input.fileName, ctx.user.id);
      }),

    // List all imports
    list: adminProcedure.query(async ({ ctx }) => {
      const { listImports } = await import("./import");
      return listImports(ctx.tenantId);
    }),

    // Get import details
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getImportById } = await import("./import");
        return getImportById(input.id, ctx.tenantId);
      }),
  }),

  // ============================================================================
  // ONBOARDING WIZARD
  // ============================================================================
  wizard: router({
    // Get wizard status
    getStatus: wizardProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const [tenant] = await dbInstance
        .select({
          onboardingCompleted: tenants.onboardingCompleted,
          onboardingStep: tenants.onboardingStep,
          onboardingCompletedAt: tenants.onboardingCompletedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }

      return tenant;
    }),

    // Update wizard step
    updateStep: wizardProcedure
      .input(z.object({
        step: z.enum(["welcome", "service", "employee", "hours", "complete"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        await dbInstance
          .update(tenants)
          .set({ onboardingStep: input.step })
          .where(eq(tenants.id, ctx.tenantId));

        return { success: true };
      }),

    // Mark wizard as completed
    complete: wizardProcedure.mutation(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      await dbInstance
        .update(tenants)
        .set({
          onboardingCompleted: true,
          onboardingStep: "complete",
          onboardingCompletedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId));

      return { success: true };
    }),

    // Skip wizard
    skip: wizardProcedure.mutation(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      await dbInstance
        .update(tenants)
        .set({
          onboardingCompleted: true,
          onboardingStep: "complete",
          onboardingCompletedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId));

      return { success: true };
    }),

    // Add first service
    addFirstService: wizardProcedure
      .input(z.object({
        name: z.string().min(1, "Service name is required"),
        duration: z.number().min(5, "Duration must be at least 5 minutes"),
        price: z.number().min(0, "Price must be positive"),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { services } = await import("../drizzle/schema");
        const [service] = await dbInstance
          .insert(services)
          .values({
            tenantId: ctx.tenantId,
            name: input.name,
            durationMinutes: input.duration,
            price: input.price.toString(),
            description: input.description || null,
            isActive: true,
          });

        return { success: true, serviceId: service.insertId };
      }),

    // Add first employee
    addFirstEmployee: wizardProcedure
      .input(z.object({
        name: z.string().min(1, "Employee name is required"),
        email: z.string().email("Invalid email").optional(),
        phone: z.string().optional(),
        commissionRate: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { users } = await import("../drizzle/schema");
        const [employee] = await dbInstance
          .insert(users)
          .values({
            tenantId: ctx.tenantId,
            openId: `employee-${nanoid(12)}`,
            name: input.name,
            email: input.email || null,
            phone: input.phone || null,
            role: "employee",
            commissionType: "percentage",
            commissionRate: input.commissionRate?.toString() || "40.00",
            isActive: true,
          });

        return { success: true, employeeId: employee.insertId };
      }),

    // Set business hours (simplified - just store in settings)
    setBusinessHours: wizardProcedure
      .input(z.object({
        openTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
        closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
        workDays: z.array(z.number().min(0).max(6)), // 0 = Sunday, 6 = Saturday
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { salonSettings } = await import("../drizzle/schema");
        
        // Store business hours as JSON in printSettings
        const businessHours = {
          openTime: input.openTime,
          closeTime: input.closeTime,
          workDays: input.workDays,
        };

        // Check if setting exists
        const [existing] = await dbInstance
          .select()
          .from(salonSettings)
          .where(eq(salonSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          // Update existing printSettings with businessHours
          const currentSettings = existing.printSettings || {};
          await dbInstance
            .update(salonSettings)
            .set({ 
              printSettings: {
                ...currentSettings,
                businessHours: JSON.stringify(businessHours),
              } as any
            })
            .where(eq(salonSettings.id, existing.id));
        } else {
          // Create new settings row
          await dbInstance
            .insert(salonSettings)
            .values({
              tenantId: ctx.tenantId,
              printSettings: {
                fontSize: "medium",
                showLogo: true,
                customFooterText: "Takk for besøket! Velkommen tilbake!",
                businessHours: JSON.stringify(businessHours),
              } as any,
            });
        }

        return { success: true };
      }),

    // Save wizard draft data (auto-save)
    saveDraftData: wizardProcedure
      .input(z.object({
        serviceName: z.string().optional(),
        serviceDuration: z.string().optional(),
        servicePrice: z.string().optional(),
        serviceDescription: z.string().optional(),
        employeeName: z.string().optional(),
        employeeEmail: z.string().optional(),
        employeePhone: z.string().optional(),
        employeeCommission: z.string().optional(),
        skipEmployee: z.boolean().optional(),
        openTime: z.string().optional(),
        closeTime: z.string().optional(),
        workDays: z.array(z.number()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { tenants } = await import("../drizzle/schema");
        await dbInstance
          .update(tenants)
          .set({ wizardDraftData: input as any })
          .where(eq(tenants.id, ctx.tenantId));

        return { success: true };
      }),

    // Get wizard draft data
    getDraftData: wizardProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { tenants } = await import("../drizzle/schema");
      const [tenant] = await dbInstance
        .select({ wizardDraftData: tenants.wizardDraftData })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      return tenant?.wizardDraftData || null;
    }),
  }),

  // ============================================================================
  // PAYMENT TERMINAL SYSTEM
  // ============================================================================
  paymentTerminal: router({
    // List all payment providers for tenant
    listProviders: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { paymentProviders } = await import("../drizzle/schema");
      const providers = await dbInstance
        .select()
        .from(paymentProviders)
        .where(eq(paymentProviders.tenantId, ctx.tenantId));

      return providers;
    }),

    // Add new payment provider
    addProvider: adminProcedure
      .input(z.object({
        providerType: z.enum(["stripe_terminal", "vipps", "nets", "manual_card", "cash", "generic"]),
        providerName: z.string().min(1, "Provider name is required"),
        config: z.any().optional(),
        isDefault: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        
        // If setting as default, unset other defaults of same type
        if (input.isDefault) {
          await dbInstance
            .update(paymentProviders)
            .set({ isDefault: false })
            .where(and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, input.providerType)
            ));
        }

        const [provider] = await dbInstance
          .insert(paymentProviders)
          .values({
            tenantId: ctx.tenantId,
            providerType: input.providerType,
            providerName: input.providerName,
            config: input.config || null,
            isActive: true,
            isDefault: input.isDefault,
            // OAuth fields - empty for non-OAuth providers (cash, manual_card, generic)
            accessToken: "",
            refreshToken: "",
            tokenExpiresAt: new Date(0), // Epoch for non-OAuth providers
          });

        return { success: true, providerId: provider.insertId };
      }),

    // Process payment (universal endpoint)
    processPayment: tenantProcedure
      .input(z.object({
        appointmentId: z.number().optional(),
        customerId: z.number().optional(),
        amount: z.number().min(0.01, "Amount must be positive"),
        paymentMethod: z.enum(["cash", "card", "vipps", "stripe"]),
        paymentProviderId: z.number().optional(),
        metadata: z.any().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { payments } = await import("../drizzle/schema");
        
        const [payment] = await dbInstance
          .insert(payments)
          .values({
            tenantId: ctx.tenantId,
            appointmentId: input.appointmentId || null,
            amount: input.amount.toString(),
            currency: "NOK",
            paymentMethod: input.paymentMethod,
            status: "completed",
            processedBy: ctx.user.id,
            processedAt: new Date(),
            gatewayMetadata: input.metadata || null,
          });

        return { 
          success: true, 
          paymentId: payment.insertId,
          receiptNumber: `RCP-${payment.insertId}` 
        };
      }),

    // Process split payment (cash + card)
    processSplitPayment: tenantProcedure
      .input(z.object({
        orderId: z.number().optional(),
        appointmentId: z.number().optional(),
        customerId: z.number().optional(),
        totalAmount: z.number().min(0.01),
        splits: z.array(z.object({
          amount: z.number().min(0.01),
          paymentMethod: z.enum(["card", "cash", "vipps", "stripe"]),
          paymentProviderId: z.number().optional(),
          transactionId: z.string().optional(),
          cardLast4: z.string().max(4).optional(),
          cardBrand: z.string().max(50).optional(),
        })),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { payments, paymentSplits } = await import("../drizzle/schema");
        
        // Validate split amounts sum to total
        const splitTotal = input.splits.reduce((sum, split) => sum + split.amount, 0);
        if (Math.abs(splitTotal - input.totalAmount) > 0.01) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "Split amounts must sum to total amount" 
          });
        }

        // Create parent payment
        const [payment] = await dbInstance
          .insert(payments)
          .values({
            tenantId: ctx.tenantId,
            orderId: input.orderId || null,
            appointmentId: input.appointmentId || null,
            amount: input.totalAmount.toString(),
            currency: "NOK",
            paymentMethod: "split", // Mark as split
            status: "completed",
            processedBy: ctx.user.id,
            processedAt: new Date(),
          });

        const paymentId = payment.insertId;

        // Create split records
        for (const split of input.splits) {
          await dbInstance
            .insert(paymentSplits)
            .values({
              tenantId: ctx.tenantId,
              orderId: input.orderId || null,
              paymentId,
              amount: split.amount.toString(),
              paymentMethod: split.paymentMethod,
              paymentProviderId: split.paymentProviderId || null,
              cardLast4: split.cardLast4 || null,
              cardBrand: split.cardBrand || null,
              transactionId: split.transactionId || null,
              status: "completed",
              processedBy: ctx.user.id,
            });
        }

        return { 
          success: true, 
          paymentId,
          receiptNumber: `RCP-${paymentId}` 
        };
      }),

    // Get payment history
    getPaymentHistory: tenantProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        customerId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { payments, customers, orders, appointments } = await import("../drizzle/schema");
        
        // Build where conditions
        const conditions = [eq(payments.tenantId, ctx.tenantId)];
        if (input.customerId) {
          // Filter by customer through orders or appointments
          const customerOrders = await dbInstance
            .select({ id: orders.id })
            .from(orders)
            .where(and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.customerId, input.customerId)
            ));
          
          const customerAppointments = await dbInstance
            .select({ id: appointments.id })
            .from(appointments)
            .where(and(
              eq(appointments.tenantId, ctx.tenantId),
              eq(appointments.customerId, input.customerId)
            ));
          
          const orderIds = customerOrders.map(o => o.id);
          const appointmentIds = customerAppointments.map(a => a.id);
          
          if (orderIds.length > 0 || appointmentIds.length > 0) {
            const orConditions: any[] = [];
            if (orderIds.length > 0) {
              orConditions.push(sql`${payments.orderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
            }
            if (appointmentIds.length > 0) {
              orConditions.push(sql`${payments.appointmentId} IN (${sql.join(appointmentIds.map(id => sql`${id}`), sql`, `)})`);
            }
            if (orConditions.length > 0) {
              const orCondition = or(...orConditions);
              if (orCondition) {
                conditions.push(orCondition);
              }
            }
          } else {
            // No orders or appointments for this customer, return empty
            return [];
          }
        }

        const results = await dbInstance
          .select({
            payment: payments,
          })
          .from(payments)
          .where(and(...conditions))
          .orderBy(desc(payments.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        return results;
      }),

    // Update payment provider
    updateProvider: adminProcedure
      .input(z.object({
        providerId: z.number(),
        providerName: z.string().min(1).optional(),
        config: z.any().optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        
        // Verify provider belongs to tenant
        const [existing] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(and(
            eq(paymentProviders.id, input.providerId),
            eq(paymentProviders.tenantId, ctx.tenantId)
          ));

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
        }

        // If setting as default, unset other defaults of same type
        if (input.isDefault) {
          await dbInstance
            .update(paymentProviders)
            .set({ isDefault: false })
            .where(and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, existing.providerType)
            ));
        }

        // Build update object
        const updateData: any = {};
        if (input.providerName !== undefined) updateData.providerName = input.providerName;
        if (input.config !== undefined) updateData.config = input.config;
        if (input.isActive !== undefined) updateData.isActive = input.isActive;
        if (input.isDefault !== undefined) updateData.isDefault = input.isDefault;

        await dbInstance
          .update(paymentProviders)
          .set(updateData)
          .where(eq(paymentProviders.id, input.providerId));

        return { success: true };
      }),

    // Delete payment provider
    deleteProvider: adminProcedure
      .input(z.object({
        providerId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        
        // Verify provider belongs to tenant
        const [existing] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(and(
            eq(paymentProviders.id, input.providerId),
            eq(paymentProviders.tenantId, ctx.tenantId)
          ));

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
        }

        await dbInstance
          .delete(paymentProviders)
          .where(eq(paymentProviders.id, input.providerId));

        return { success: true };
      }),

    // Test connection to payment provider
    testConnection: adminProcedure
      .input(z.object({
        providerType: z.enum(["stripe_terminal", "vipps", "nets", "manual_card", "cash", "generic"]),
        config: z.any(),
      }))
      .mutation(async ({ input }) => {
        // Mock connection test - in production, this would call actual provider APIs
        try {
          // Validate required fields based on provider type
          if (input.providerType === "stripe_terminal") {
            if (!input.config?.apiKey) {
              throw new Error("API Key is required for Stripe Terminal");
            }
          } else if (input.providerType === "vipps") {
            if (!input.config?.merchantSerialNumber || !input.config?.clientId || !input.config?.clientSecret) {
              throw new Error("Merchant Serial Number, Client ID, and Client Secret are required for Vipps");
            }
          } else if (input.providerType === "nets") {
            if (!input.config?.terminalId || !input.config?.merchantId) {
              throw new Error("Terminal ID and Merchant ID are required for Nets/BankAxept");
            }
          }

          // Simulate API call delay
          await new Promise(resolve => setTimeout(resolve, 1000));

          return { 
            success: true, 
            message: "Connection successful! Terminal is ready to use." 
          };
        } catch (error: any) {
          return { 
            success: false, 
            message: error.message || "Connection failed. Please check your configuration." 
          };
        }
      }),
  }),

  // ============================================================================
  // STRIPE TERMINAL SDK
  // ============================================================================
  stripeTerminal: router({
    // Create connection token (required by Stripe Terminal SDK)
    createConnectionToken: tenantProcedure
      .input(z.object({
        providerId: z.number().optional(), // Optional: use specific provider's API key
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let apiKey: string | undefined;
        let connectedAccountId: string | undefined;

        // Check for Stripe Connect first (preferred)
        const { paymentSettings } = await import("../drizzle/schema");
        const [settings] = await dbInstance
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (settings?.stripeConnectedAccountId && settings?.stripeAccountStatus === "connected") {
          // Use Stripe Connect (platform key + connected account)
          connectedAccountId = settings.stripeConnectedAccountId;
          apiKey = ENV.stripeSecretKey; // Platform key
        } else if (input.providerId) {
          // Fallback: Use legacy API key from provider
          const { paymentProviders } = await import("../drizzle/schema");
          const [provider] = await dbInstance
            .select()
            .from(paymentProviders)
            .where(and(
              eq(paymentProviders.id, input.providerId),
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, "stripe_terminal")
            ));

          if (!provider) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Stripe Terminal provider not found" });
          }

          apiKey = (provider.config as any)?.apiKey;
        }

        const { createConnectionToken } = await import("./stripeTerminal");
        const secret = await createConnectionToken(apiKey, connectedAccountId);
        return { secret };
      }),

    // List all readers
    listReaders: tenantProcedure
      .input(z.object({
        providerId: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let apiKey: string | undefined;
        let connectedAccountId: string | undefined;

        // Check for Stripe Connect first (preferred)
        const { paymentSettings } = await import("../drizzle/schema");
        const [settings] = await dbInstance
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (settings?.stripeConnectedAccountId && settings?.stripeAccountStatus === "connected") {
          connectedAccountId = settings.stripeConnectedAccountId;
          apiKey = ENV.stripeSecretKey;
        } else if (input.providerId) {
          const { paymentProviders } = await import("../drizzle/schema");
          const [provider] = await dbInstance
            .select()
            .from(paymentProviders)
            .where(and(
              eq(paymentProviders.id, input.providerId),
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, "stripe_terminal")
            ));

          if (provider) {
            apiKey = (provider.config as any)?.apiKey;
          }
        }

        const { listReaders } = await import("./stripeTerminal");
        const readers = await listReaders(apiKey, connectedAccountId);
        return readers;
      }),

    // Create payment intent for terminal
    createPaymentIntent: tenantProcedure
      .input(z.object({
        amount: z.number().min(0.01),
        currency: z.string().default("nok"),
        providerId: z.number().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let apiKey: string | undefined;
        let connectedAccountId: string | undefined;

        // Check for Stripe Connect first (preferred)
        const { paymentSettings } = await import("../drizzle/schema");
        const [settings] = await dbInstance
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (settings?.stripeConnectedAccountId && settings?.stripeAccountStatus === "connected") {
          connectedAccountId = settings.stripeConnectedAccountId;
          apiKey = ENV.stripeSecretKey;
        } else if (input.providerId) {
          const { paymentProviders } = await import("../drizzle/schema");
          const [provider] = await dbInstance
            .select()
            .from(paymentProviders)
            .where(and(
              eq(paymentProviders.id, input.providerId),
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, "stripe_terminal")
            ));

          if (provider) {
            apiKey = (provider.config as any)?.apiKey;
          }
        }

        const { createTerminalPaymentIntent } = await import("./stripeTerminal");
        const paymentIntent = await createTerminalPaymentIntent(
          input.amount,
          input.currency,
          {
            ...input.metadata,
            tenantId: ctx.tenantId,
            userId: ctx.user.id.toString(),
          },
          apiKey,
          connectedAccountId
        );

        return {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
        };
      }),

    // Cancel payment intent
    cancelPaymentIntent: tenantProcedure
      .input(z.object({
        paymentIntentId: z.string(),
        providerId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let apiKey: string | undefined;

        if (input.providerId) {
          const { paymentProviders } = await import("../drizzle/schema");
          const [provider] = await dbInstance
            .select()
            .from(paymentProviders)
            .where(and(
              eq(paymentProviders.id, input.providerId),
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, "stripe_terminal")
            ));

          if (provider) {
            apiKey = (provider.config as any)?.apiKey;
          }
        }

        const { cancelPaymentIntent } = await import("./stripeTerminal");
        const paymentIntent = await cancelPaymentIntent(input.paymentIntentId, apiKey);
        return { success: true, status: paymentIntent.status };
      }),

    // Process refund
    refundPayment: tenantProcedure
      .input(z.object({
        paymentIntentId: z.string(),
        amount: z.number().optional(),
        providerId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        let apiKey: string | undefined;

        if (input.providerId) {
          const { paymentProviders } = await import("../drizzle/schema");
          const [provider] = await dbInstance
            .select()
            .from(paymentProviders)
            .where(and(
              eq(paymentProviders.id, input.providerId),
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, "stripe_terminal")
            ));

          if (provider) {
            apiKey = (provider.config as any)?.apiKey;
          }
        }

        const { refundTerminalPayment } = await import("./stripeTerminal");
        const refund = await refundTerminalPayment(
          input.paymentIntentId,
          input.amount,
          apiKey
        );

        return {
          id: refund.id,
          amount: refund.amount,
          status: refund.status,
        };
      }),
  }),

  // ============================================================================
  // COMMUNICATIONS
  // ============================================================================
  communications: router({
    // Get communication settings
    getSettings: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return null;

      const { communicationSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [settings] = await dbInstance
        .select()
        .from(communicationSettings)
        .where(eq(communicationSettings.tenantId, ctx.tenantId));

      return settings || null;
    }),

    // Update communication settings
    updateSettings: tenantProcedure
      .input(
        z.object({
          smsProvider: z.string().optional(),
          smsApiKey: z.string().optional(),
          smsApiSecret: z.string().optional(),
          smsSenderName: z.string().max(11).optional(),
          smsEnabled: z.boolean().optional(),
          smtpHost: z.string().optional(),
          smtpPort: z.number().optional(),
          smtpUser: z.string().optional(),
          smtpPassword: z.string().optional(),
          smtpSecure: z.boolean().optional(),
          emailFromAddress: z.string().email().optional(),
          emailFromName: z.string().optional(),
          emailEnabled: z.boolean().optional(),
          autoReminderEnabled: z.boolean().optional(),
          reminderHoursBefore: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { communicationSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if settings exist
        const [existing] = await dbInstance
          .select()
          .from(communicationSettings)
          .where(eq(communicationSettings.tenantId, ctx.tenantId));

        if (existing) {
          // Update existing settings
          await dbInstance
            .update(communicationSettings)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(communicationSettings.tenantId, ctx.tenantId));
        } else {
          // Create new settings
          await dbInstance.insert(communicationSettings).values({
            tenantId: ctx.tenantId,
            ...input,
          });
        }

        return { success: true };
      }),

    // List templates
    listTemplates: tenantProcedure
      .input(
        z.object({
          type: z.enum(["sms", "email"]).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { communicationTemplates } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        let query = dbInstance
          .select()
          .from(communicationTemplates)
          .where(eq(communicationTemplates.tenantId, ctx.tenantId));

        if (input.type) {
          const templates = await dbInstance
            .select()
            .from(communicationTemplates)
            .where(
              and(
                eq(communicationTemplates.tenantId, ctx.tenantId),
                eq(communicationTemplates.type, input.type)
              )
            );
          return templates;
        }

        return await query;
      }),

    // Create template
    createTemplate: tenantProcedure
      .input(
        z.object({
          type: z.enum(["sms", "email"]),
          name: z.string().min(1),
          subject: z.string().optional(),
          content: z.string().min(1),
          variables: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { communicationTemplates } = await import("../drizzle/schema");

        const result = await dbInstance.insert(communicationTemplates).values({
          tenantId: ctx.tenantId,
          type: input.type,
          name: input.name,
          subject: input.subject || null,
          content: input.content,
          variables: input.variables || null,
          isActive: true,
        });

        const insertId = Array.isArray(result) ? result[0]?.insertId : (result as any).insertId;
        return { id: Number(insertId), success: true };
      }),

    // Update template
    updateTemplate: tenantProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          subject: z.string().optional(),
          content: z.string().min(1).optional(),
          variables: z.array(z.string()).optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { communicationTemplates } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const { id, ...updates } = input;

        await dbInstance
          .update(communicationTemplates)
          .set({ ...updates, updatedAt: new Date() })
          .where(
            and(
              eq(communicationTemplates.id, id),
              eq(communicationTemplates.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    // Delete template
    deleteTemplate: tenantProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { communicationTemplates } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        await dbInstance
          .delete(communicationTemplates)
          .where(
            and(
              eq(communicationTemplates.id, input.id),
              eq(communicationTemplates.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    // Get customers for bulk messaging with filters
    getCustomersForBulk: tenantProcedure
      .input(
        z.object({
          filter: z.enum(["all", "recent", "high_value", "inactive"]).optional(),
          lastVisitDays: z.number().optional(),
          minTotalSpent: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { customers } = await import("../drizzle/schema");
        const { eq, and, sql, gte, lte } = await import("drizzle-orm");

        let query = dbInstance
          .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            totalRevenue: customers.totalRevenue,
            lastVisitDate: customers.lastVisitDate,
          })
          .from(customers)
          .where(eq(customers.tenantId, ctx.tenantId));

        // Apply filters
        if (input.filter === "recent" && input.lastVisitDays) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - input.lastVisitDays);
          const results = await dbInstance
            .select({
              id: customers.id,
              firstName: customers.firstName,
            lastName: customers.lastName,
              email: customers.email,
              phone: customers.phone,
              totalRevenue: customers.totalRevenue,
              lastVisitDate: customers.lastVisitDate,
            })
            .from(customers)
            .where(
              and(
                eq(customers.tenantId, ctx.tenantId),
                gte(customers.lastVisitDate, cutoffDate)
              )
            );
          return results;
        }

        if (input.filter === "high_value" && input.minTotalSpent) {
          const results = await dbInstance
            .select({
              id: customers.id,
              firstName: customers.firstName,
            lastName: customers.lastName,
              email: customers.email,
              phone: customers.phone,
              totalRevenue: customers.totalRevenue,
              lastVisitDate: customers.lastVisitDate,
            })
            .from(customers)
            .where(
              and(
                eq(customers.tenantId, ctx.tenantId),
                gte(customers.totalRevenue, input.minTotalSpent.toString())
              )
            );
          return results;
        }

        if (input.filter === "inactive" && input.lastVisitDays) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - input.lastVisitDays);
          const results = await dbInstance
            .select({
              id: customers.id,
              firstName: customers.firstName,
            lastName: customers.lastName,
              email: customers.email,
              phone: customers.phone,
              totalRevenue: customers.totalRevenue,
              lastVisitDate: customers.lastVisitDate,
            })
            .from(customers)
            .where(
              and(
                eq(customers.tenantId, ctx.tenantId),
                lte(customers.lastVisitDate, cutoffDate)
              )
            );
          return results;
        }

        return await query;
      }),

    // Create bulk campaign
    createBulkCampaign: tenantProcedure
      .input(
        z.object({
          name: z.string().min(1),
          type: z.enum(["sms", "email"]),
          templateId: z.number().optional(),
          subject: z.string().optional(),
          content: z.string().min(1),
          customerIds: z.array(z.number()),
          scheduledAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { bulkCampaigns, campaignRecipients, customers } = await import(
          "../drizzle/schema"
        );
        const { eq, inArray } = await import("drizzle-orm");

        // Get customer contact info
        const customerList = await dbInstance
          .select()
          .from(customers)
          .where(
            inArray(customers.id, input.customerIds)
          );

        // Create campaign
        const campaignResult = await dbInstance.insert(bulkCampaigns).values({
          tenantId: ctx.tenantId,
          name: input.name,
          type: input.type,
          templateId: input.templateId || null,
          subject: input.subject || null,
          content: input.content,
          status: input.scheduledAt ? "scheduled" : "draft",
          recipientCount: customerList.length,
          scheduledAt: input.scheduledAt || null,
          createdBy: ctx.user.id,
        });

        const campaignId = Array.isArray(campaignResult)
          ? campaignResult[0]?.insertId
          : (campaignResult as any).insertId;

        // Create campaign recipients
        const recipients = customerList.map((customer) => ({
          campaignId: Number(campaignId),
          customerId: customer.id,
          recipientContact:
            input.type === "sms" ? customer.phone : customer.email || "",
          status: "pending" as const,
        }));

        if (recipients.length > 0) {
          await dbInstance.insert(campaignRecipients).values(recipients);
        }

        return { campaignId: Number(campaignId), success: true };
      }),

    // Get campaign list
    listCampaigns: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];

      const { bulkCampaigns } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");

      const campaigns = await dbInstance
        .select()
        .from(bulkCampaigns)
        .where(eq(bulkCampaigns.tenantId, ctx.tenantId))
        .orderBy(desc(bulkCampaigns.createdAt));

      return campaigns;
    }),

    // Get campaign details with recipients
    getCampaignDetails: tenantProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { bulkCampaigns, campaignRecipients, customers } = await import(
          "../drizzle/schema"
        );
        const { eq, and } = await import("drizzle-orm");

        const [campaign] = await dbInstance
          .select()
          .from(bulkCampaigns)
          .where(
            and(
              eq(bulkCampaigns.id, input.campaignId),
              eq(bulkCampaigns.tenantId, ctx.tenantId)
            )
          );

        if (!campaign) return null;

        const recipients = await dbInstance
          .select({
            id: campaignRecipients.id,
            customerId: campaignRecipients.customerId,
            customerName: customers.firstName,
            recipientContact: campaignRecipients.recipientContact,
            status: campaignRecipients.status,
            sentAt: campaignRecipients.sentAt,
            deliveredAt: campaignRecipients.deliveredAt,
            openedAt: campaignRecipients.openedAt,
            errorMessage: campaignRecipients.errorMessage,
          })
          .from(campaignRecipients)
          .leftJoin(customers, eq(campaignRecipients.customerId, customers.id))
          .where(eq(campaignRecipients.campaignId, input.campaignId));

        return { campaign, recipients };
      }),
  }),

  // ============================================================================
  // CONTACT MESSAGES
  // ============================================================================
  contact: router({
    // Submit contact form (public)
    submit: publicProcedure
      .input(z.object({
        tenantId: z.string(),
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.string().email("Invalid email address"),
        phone: z.string().optional(),
        subject: z.string().optional(),
        message: z.string().min(10, "Message must be at least 10 characters"),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        // Get IP and user agent from request if available
        const ipAddress = ctx.req?.ip || ctx.req?.socket?.remoteAddress || null;
        const userAgent = ctx.req?.headers['user-agent'] || null;

        const [message] = await dbInstance
          .insert(contactMessages)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            email: input.email,
            phone: input.phone || null,
            subject: input.subject || null,
            message: input.message,
            status: "new",
            ipAddress,
            userAgent,
          });

        return { success: true, messageId: message.insertId };
      }),

    // List contact messages (admin only)
    list: adminProcedure
      .input(z.object({
        status: z.enum(["new", "read", "replied", "archived"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const conditions = [eq(contactMessages.tenantId, ctx.tenantId)];
        if (input.status) {
          conditions.push(eq(contactMessages.status, input.status));
        }

        const messages = await dbInstance
          .select()
          .from(contactMessages)
          .where(and(...conditions))
          .orderBy(desc(contactMessages.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        const [countResult] = await dbInstance
          .select({ count: sql<number>`count(*)` })
          .from(contactMessages)
          .where(and(...conditions));

        return {
          messages,
          total: countResult.count,
          hasMore: input.offset + input.limit < countResult.count,
        };
      }),

    // Mark message as read
    markAsRead: adminProcedure
      .input(z.object({ messageId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        await dbInstance
          .update(contactMessages)
          .set({ status: "read", readAt: new Date() })
          .where(
            and(
              eq(contactMessages.id, input.messageId),
              eq(contactMessages.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),

    // Update message status
    updateStatus: adminProcedure
      .input(z.object({
        messageId: z.number(),
        status: z.enum(["new", "read", "replied", "archived"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const updateData: any = { status: input.status };
        if (input.status === "replied") {
          updateData.repliedAt = new Date();
        }

        await dbInstance
          .update(contactMessages)
          .set(updateData)
          .where(
            and(
              eq(contactMessages.id, input.messageId),
              eq(contactMessages.tenantId, ctx.tenantId)
            )
          );

        return { success: true };
      }),
  }),

  // ============================================================================
  // EMAIL TEMPLATES MANAGEMENT
  // ============================================================================
  emailTemplates: router({
    // List all email templates for tenant
    list: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { emailTemplates } = await import("../drizzle/schema");
        
        const templates = await dbInstance
          .select()
          .from(emailTemplates)
          .where(eq(emailTemplates.tenantId, ctx.tenantId))
          .orderBy(emailTemplates.templateType);

        return templates;
      }),

    // Get template by type
    getByType: adminProcedure
      .input(z.object({
        templateType: z.enum(["reminder_24h", "reminder_2h", "booking_confirmation", "booking_cancellation", "booking_update"]),
      }))
      .query(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { emailTemplates } = await import("../drizzle/schema");
        
        const [template] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        return template || null;
      }),

    // Update template
    update: adminProcedure
      .input(z.object({
        templateType: z.enum(["reminder_24h", "reminder_2h", "booking_confirmation", "booking_cancellation", "booking_update"]),
        subject: z.string().min(1).max(500),
        bodyHtml: z.string().min(1),
        logoUrl: z.string().optional(),
        primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { emailTemplates } = await import("../drizzle/schema");
        
        // Check if template exists
        const [existing] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        if (existing) {
          // Update existing template
          await dbInstance
            .update(emailTemplates)
            .set({
              subject: input.subject,
              bodyHtml: input.bodyHtml,
              logoUrl: input.logoUrl || null,
              primaryColor: input.primaryColor || "#8b5cf6",
              secondaryColor: input.secondaryColor || "#6366f1",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(emailTemplates.tenantId, ctx.tenantId),
                eq(emailTemplates.templateType, input.templateType)
              )
            );
        } else {
          // Create new template
          await dbInstance
            .insert(emailTemplates)
            .values({
              tenantId: ctx.tenantId,
              templateType: input.templateType,
              subject: input.subject,
              bodyHtml: input.bodyHtml,
              logoUrl: input.logoUrl || null,
              primaryColor: input.primaryColor || "#8b5cf6",
              secondaryColor: input.secondaryColor || "#6366f1",
              isActive: true,
            });
        }

        // Return the updated/created template
        const [updated] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        return updated;
      }),

    // Upload logo to S3
    uploadLogo: adminProcedure
      .input(z.object({
        fileName: z.string(),
        fileType: z.string(),
        base64Data: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { storagePut } = await import("./storage");
        
        // Convert base64 to buffer
        const buffer = Buffer.from(input.base64Data, "base64");
        
        // Generate unique file key
        const fileKey = `email-logos/${ctx.tenantId}/${nanoid()}-${input.fileName}`;
        
        // Upload to S3
        const { url } = await storagePut(fileKey, buffer, input.fileType);
        
        return { url };
      }),

    // Send test email
    sendTest: adminProcedure
      .input(z.object({
        templateType: z.enum(["reminder_24h", "reminder_2h", "booking_confirmation", "booking_cancellation", "booking_update"]),
        testEmail: z.string().email(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { emailTemplates } = await import("../drizzle/schema");
        const { sendEmailViaSES } = await import("./_core/aws-ses");
        
        // Get template
        const [template] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        }

        // Replace placeholders with test data
        const testData = {
          customerName: "Test Kunde",
          salonName: "Din Salong",
          appointmentDate: "15. desember 2024",
          appointmentTime: "14:00",
          serviceName: "Herreklipp",
          employeeName: "Stylist Test",
        };

        let emailBody = template.bodyHtml;
        Object.entries(testData).forEach(([key, value]) => {
          emailBody = emailBody.replace(new RegExp(`{{${key}}}`, "g"), value);
        });

        // Send email
        const result = await sendEmailViaSES({
          to: [input.testEmail],
          subject: `[TEST] ${template.subject}`,
          htmlBody: emailBody,
        });

        if (!result) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send test email" });
        }

        return { success: true };
      }),

    // Reset template to default
    resetToDefault: adminProcedure
      .input(z.object({
        templateType: z.enum(["reminder_24h", "reminder_2h", "booking_confirmation", "booking_cancellation", "booking_update"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { emailTemplates } = await import("../drizzle/schema");
        
        // Define default templates
        const defaultTemplates: Record<string, { subject: string; bodyHtml: string }> = {
          reminder_24h: {
            subject: "Påminnelse: Din time i morgen",
            bodyHtml: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: {{primaryColor}}; margin-bottom: 20px;">Hei {{customerName}}!</h2>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Dette er en påminnelse om din time hos {{salonName}}.</p>
                  <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Dato:</strong> {{appointmentDate}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tid:</strong> {{appointmentTime}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tjeneste:</strong> {{serviceName}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Frisør:</strong> {{employeeName}}</p>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">Vi gleder oss til å se deg!</p>
                </div>
              </div>
            `,
          },
          reminder_2h: {
            subject: "Påminnelse: Din time om 2 timer",
            bodyHtml: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: {{primaryColor}}; margin-bottom: 20px;">Hei {{customerName}}!</h2>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Din time hos {{salonName}} starter om 2 timer.</p>
                  <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tid:</strong> {{appointmentTime}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tjeneste:</strong> {{serviceName}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Frisør:</strong> {{employeeName}}</p>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">Vi sees snart!</p>
                </div>
              </div>
            `,
          },
          booking_confirmation: {
            subject: "Bekreftelse: Din time er booket",
            bodyHtml: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: {{primaryColor}}; margin-bottom: 20px;">Takk for din booking!</h2>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Din time hos {{salonName}} er bekreftet.</p>
                  <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Dato:</strong> {{appointmentDate}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tid:</strong> {{appointmentTime}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tjeneste:</strong> {{serviceName}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Frisør:</strong> {{employeeName}}</p>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">Vi gleder oss til å se deg!</p>
                </div>
              </div>
            `,
          },
          booking_cancellation: {
            subject: "Din time er kansellert",
            bodyHtml: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: #ef4444; margin-bottom: 20px;">Time kansellert</h2>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Din time hos {{salonName}} er kansellert.</p>
                  <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Dato:</strong> {{appointmentDate}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tid:</strong> {{appointmentTime}}</p>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">Ta kontakt hvis du ønsker å booke en ny time.</p>
                </div>
              </div>
            `,
          },
          booking_update: {
            subject: "Din time er oppdatert",
            bodyHtml: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: {{primaryColor}}; margin-bottom: 20px;">Time oppdatert</h2>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Din time hos {{salonName}} er oppdatert.</p>
                  <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Ny dato:</strong> {{appointmentDate}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Ny tid:</strong> {{appointmentTime}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Tjeneste:</strong> {{serviceName}}</p>
                    <p style="margin: 5px 0; color: #1f2937;"><strong>Frisør:</strong> {{employeeName}}</p>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">Vi gleder oss til å se deg!</p>
                </div>
              </div>
            `,
          },
        };

        const defaultTemplate = defaultTemplates[input.templateType];
        if (!defaultTemplate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid template type" });
        }

        // Check if template exists
        const [existing] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        if (existing) {
          // Update to default
          await dbInstance
            .update(emailTemplates)
            .set({
              subject: defaultTemplate.subject,
              bodyHtml: defaultTemplate.bodyHtml,
              primaryColor: "#8b5cf6",
              secondaryColor: "#6366f1",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(emailTemplates.tenantId, ctx.tenantId),
                eq(emailTemplates.templateType, input.templateType)
              )
            );
        } else {
          // Create with default
          await dbInstance
            .insert(emailTemplates)
            .values({
              tenantId: ctx.tenantId,
              templateType: input.templateType,
              subject: defaultTemplate.subject,
              bodyHtml: defaultTemplate.bodyHtml,
              primaryColor: "#8b5cf6",
              secondaryColor: "#6366f1",
              isActive: true,
            });
        }

        // Return the reset template
        const [reset] = await dbInstance
          .select()
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.tenantId, ctx.tenantId),
              eq(emailTemplates.templateType, input.templateType)
            )
          )
          .limit(1);

        return reset;
      }),
  }),

  // ============================================================================
  // BUSINESS HOURS MANAGEMENT
  // ============================================================================
  businessHours: router({
    // Get all business hours for tenant
    getAll: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { businessHours } = await import("../drizzle/schema");
        
        const hours = await dbInstance
          .select()
          .from(businessHours)
          .where(eq(businessHours.tenantId, ctx.tenantId))
          .orderBy(businessHours.dayOfWeek);

        return hours;
      }),

    // Update business hours for a specific day
    update: adminProcedure
      .input(z.object({
        dayOfWeek: z.number().min(0).max(6), // 0 = Sunday, 6 = Saturday
        isOpen: z.boolean(),
        openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { businessHours } = await import("../drizzle/schema");

        // Validate that if isOpen is true, both times must be provided
        if (input.isOpen && (!input.openTime || !input.closeTime)) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "Open and close times are required when salon is open" 
          });
        }

        // Validate that openTime is before closeTime
        if (input.isOpen && input.openTime && input.closeTime) {
          const [openHour, openMin] = input.openTime.split(':').map(Number);
          const [closeHour, closeMin] = input.closeTime.split(':').map(Number);
          const openMinutes = openHour * 60 + openMin;
          const closeMinutes = closeHour * 60 + closeMin;
          
          if (openMinutes >= closeMinutes) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: "Open time must be before close time" 
            });
          }
        }

        // Check if record exists
        const [existing] = await dbInstance
          .select()
          .from(businessHours)
          .where(
            and(
              eq(businessHours.tenantId, ctx.tenantId),
              eq(businessHours.dayOfWeek, input.dayOfWeek)
            )
          )
          .limit(1);

        if (existing) {
          // Update existing record
          await dbInstance
            .update(businessHours)
            .set({
              isOpen: input.isOpen,
              openTime: input.isOpen ? input.openTime : null,
              closeTime: input.isOpen ? input.closeTime : null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(businessHours.tenantId, ctx.tenantId),
                eq(businessHours.dayOfWeek, input.dayOfWeek)
              )
            );
        } else {
          // Insert new record
          await dbInstance
            .insert(businessHours)
            .values({
              tenantId: ctx.tenantId,
              dayOfWeek: input.dayOfWeek,
              isOpen: input.isOpen,
              openTime: input.isOpen ? input.openTime : null,
              closeTime: input.isOpen ? input.closeTime : null,
            });
        }

        return { success: true };
      }),

    // Bulk update all business hours at once
    updateAll: adminProcedure
      .input(z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        isOpen: z.boolean(),
        openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      })))
      .mutation(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { businessHours } = await import("../drizzle/schema");

        // Validate all entries
        for (const day of input) {
          if (day.isOpen && (!day.openTime || !day.closeTime)) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: `Open and close times are required for day ${day.dayOfWeek}` 
            });
          }

          if (day.isOpen && day.openTime && day.closeTime) {
            const [openHour, openMin] = day.openTime.split(':').map(Number);
            const [closeHour, closeMin] = day.closeTime.split(':').map(Number);
            const openMinutes = openHour * 60 + openMin;
            const closeMinutes = closeHour * 60 + closeMin;
            
            if (openMinutes >= closeMinutes) {
              throw new TRPCError({ 
                code: "BAD_REQUEST", 
                message: `Open time must be before close time for day ${day.dayOfWeek}` 
              });
            }
          }
        }

        // Update all days
        for (const day of input) {
          const [existing] = await dbInstance
            .select()
            .from(businessHours)
            .where(
              and(
                eq(businessHours.tenantId, ctx.tenantId),
                eq(businessHours.dayOfWeek, day.dayOfWeek)
              )
            )
            .limit(1);

          if (existing) {
            await dbInstance
              .update(businessHours)
              .set({
                isOpen: day.isOpen,
                openTime: day.isOpen ? day.openTime : null,
                closeTime: day.isOpen ? day.closeTime : null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(businessHours.tenantId, ctx.tenantId),
                  eq(businessHours.dayOfWeek, day.dayOfWeek)
                )
              );
          } else {
            await dbInstance
              .insert(businessHours)
              .values({
                tenantId: ctx.tenantId,
                dayOfWeek: day.dayOfWeek,
                isOpen: day.isOpen,
                openTime: day.isOpen ? day.openTime : null,
                closeTime: day.isOpen ? day.closeTime : null,
              });
          }
        }

        return { success: true };
      }),
  }),

  // ============================================================================
  // POS REFUNDS MANAGEMENT
  // ============================================================================
  posRefunds: router({
    // List all refunds with filters
    listRefunds: tenantProcedure
      .input(z.object({
        status: z.enum(["pending", "completed", "failed"]).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { refunds, users } = await import("../drizzle/schema");
        const { eq, and, gte, lte, desc } = await import("drizzle-orm");

        const conditions = [eq(refunds.tenantId, ctx.tenantId)];
        if (input.status) conditions.push(eq(refunds.status, input.status));
        if (input.startDate) conditions.push(gte(refunds.createdAt, new Date(input.startDate)));
        if (input.endDate) conditions.push(lte(refunds.createdAt, new Date(input.endDate)));

        const results = await dbInstance
          .select({
            id: refunds.id,
            orderId: refunds.orderId,
            amount: refunds.amount,
            reason: refunds.reason,
            status: refunds.status,
            createdAt: refunds.createdAt,
            completedAt: refunds.processedAt,
            processedBy: users.name,
          })
          .from(refunds)
          .leftJoin(users, eq(refunds.processedBy, users.id))
          .where(and(...conditions))
          .orderBy(desc(refunds.createdAt));

        return results;
      }),

    // Get refund statistics
    getRefundStats: tenantProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return { totalRefunded: 0, totalCount: 0, pendingCount: 0, completedCount: 0 };

        const { refunds } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sum, count } = await import("drizzle-orm");

        const conditions = [eq(refunds.tenantId, ctx.tenantId)];
        if (input.startDate) conditions.push(gte(refunds.createdAt, new Date(input.startDate)));
        if (input.endDate) conditions.push(lte(refunds.createdAt, new Date(input.endDate)));

        const [stats] = await dbInstance
          .select({
            totalRefunded: sum(refunds.amount),
            totalCount: count(),
          })
          .from(refunds)
          .where(and(...conditions));

        const [pendingStats] = await dbInstance
          .select({ count: count() })
          .from(refunds)
          .where(and(...conditions, eq(refunds.status, "pending")));

        const [completedStats] = await dbInstance
          .select({ count: count() })
          .from(refunds)
          .where(and(...conditions, eq(refunds.status, "completed")));

        return {
          totalRefunded: parseFloat(stats?.totalRefunded?.toString() || "0"),
          totalCount: stats?.totalCount || 0,
          pendingCount: pendingStats?.count || 0,
          completedCount: completedStats?.count || 0,
        };
      }),

    // Create new refund
    createRefund: tenantProcedure
      .input(z.object({
        orderId: z.number(),
        amount: z.number().min(0.01),
        reason: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { refunds } = await import("../drizzle/schema");

        // For manual refunds, we need a paymentId. For now, use 0 or find the payment
        // In production, you'd query the payment associated with the order
        await dbInstance.insert(refunds).values({
          tenantId: ctx.tenantId,
          paymentId: 0, // TODO: Query actual payment ID from order
          orderId: input.orderId,
          amount: input.amount.toString(),
          reason: input.notes ? `${input.reason} - ${input.notes}` : input.reason,
          refundMethod: "manual",
          status: "pending",
          processedBy: ctx.user.id,
        });

        return { success: true };
      }),
  }),

  // ============================================================================
  // POS DETAILED FINANCIAL REPORTS
  // ============================================================================
  posReports: router({
    // Get detailed POS financial report
    getDetailedReport: tenantProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        employeeId: z.number().optional(),
        paymentMethod: z.enum(["cash", "card", "vipps", "stripe", "split"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return null;

        const { orders, payments, users, appointmentServices, services, orderItems, products, paymentSplits } = await import("../drizzle/schema");
        const { eq, and, gte, lte, sum, count, desc, sql } = await import("drizzle-orm");

        const startDate = new Date(input.startDate);
        const endDate = new Date(input.endDate);

        // Base conditions
        const orderConditions = [
          eq(orders.tenantId, ctx.tenantId),
          gte(orders.createdAt, startDate),
          lte(orders.createdAt, endDate),
        ];

        if (input.employeeId) {
          orderConditions.push(eq(orders.employeeId, input.employeeId));
        }

        // Summary statistics
        const [summary] = await dbInstance
          .select({
            totalSales: sum(orders.total),
            orderCount: count(),
          })
          .from(orders)
          .where(and(...orderConditions));

        const totalSales = parseFloat(summary?.totalSales?.toString() || "0");
        const orderCount = summary?.orderCount || 0;
        const averageOrderValue = orderCount > 0 ? totalSales / orderCount : 0;

        // Sales by employee
        const salesByEmployee = await dbInstance
          .select({
            employeeId: orders.employeeId,
            employeeName: users.name,
            totalSales: sum(orders.total),
            orderCount: count(),
          })
          .from(orders)
          .leftJoin(users, eq(orders.employeeId, users.id))
          .where(and(...orderConditions))
          .groupBy(orders.employeeId, users.name);

        // Sales by payment method
        const paymentConditions = [
          eq(payments.tenantId, ctx.tenantId),
          gte(payments.processedAt, startDate),
          lte(payments.processedAt, endDate),
        ];

        if (input.paymentMethod) {
          paymentConditions.push(eq(payments.paymentMethod, input.paymentMethod));
        }

        const salesByPaymentMethod = await dbInstance
          .select({
            paymentMethod: payments.paymentMethod,
            totalAmount: sum(payments.amount),
          })
          .from(payments)
          .where(and(...paymentConditions))
          .groupBy(payments.paymentMethod);

        // Hourly sales distribution
        const hourlySales = await dbInstance
          .select({
            hour: sql<number>`HOUR(${orders.createdAt})`,
            totalSales: sum(orders.total),
          })
          .from(orders)
          .where(and(...orderConditions))
          .groupBy(sql`HOUR(${orders.createdAt})`);

        // Top services
        const topServices = await dbInstance
          .select({
            serviceId: appointmentServices.serviceId,
            serviceName: services.name,
            count: count(),
            totalRevenue: sum(appointmentServices.price),
          })
          .from(appointmentServices)
          .leftJoin(services, eq(appointmentServices.serviceId, services.id))
          .groupBy(appointmentServices.serviceId, services.name)
          .orderBy(desc(sum(appointmentServices.price)))
          .limit(10);

        // Top products
        const topProducts = await dbInstance
          .select({
            itemId: orderItems.itemId,
            productName: orderItems.itemName,
            quantity: sum(orderItems.quantity),
            totalRevenue: sum(orderItems.total),
          })
          .from(orderItems)
          .where(and(
            eq(orderItems.itemType, "product"),
            sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderItems.orderId} AND ${orders.tenantId} = ${ctx.tenantId} AND ${orders.createdAt} >= ${startDate} AND ${orders.createdAt} <= ${endDate})`
          ))
          .groupBy(orderItems.itemId, orderItems.itemName)
          .orderBy(desc(sum(orderItems.total)))
          .limit(10);

        // Split payment details
        const splitPaymentDetails = await dbInstance
          .select({
            orderId: paymentSplits.orderId,
            totalAmount: sum(paymentSplits.amount),
            methodsUsed: sql<string>`GROUP_CONCAT(DISTINCT ${paymentSplits.paymentMethod})`,
            createdAt: paymentSplits.createdAt,
          })
          .from(paymentSplits)
          .where(and(
            eq(paymentSplits.tenantId, ctx.tenantId),
            gte(paymentSplits.createdAt, startDate),
            lte(paymentSplits.createdAt, endDate)
          ))
          .groupBy(paymentSplits.orderId, paymentSplits.createdAt);

        return {
          summary: {
            totalSales: totalSales.toString(),
            orderCount,
            averageOrderValue: averageOrderValue.toString(),
            netRevenue: totalSales.toString(), // Can subtract refunds if needed
          },
          salesByEmployee: salesByEmployee.map(e => ({
            ...e,
            totalSales: e.totalSales?.toString() || "0",
          })),
          salesByPaymentMethod: salesByPaymentMethod.map(p => ({
            ...p,
            totalAmount: p.totalAmount?.toString() || "0",
          })),
          hourlySales: hourlySales.map(h => ({
            ...h,
            totalSales: h.totalSales?.toString() || "0",
          })),
          topServices: topServices.map(s => ({
            ...s,
            totalRevenue: s.totalRevenue?.toString() || "0",
          })),
          topProducts: topProducts.map(p => ({
            ...p,
            totalRevenue: p.totalRevenue?.toString() || "0",
          })),
          splitPaymentDetails: splitPaymentDetails.map(s => ({
            ...s,
            totalAmount: s.totalAmount?.toString() || "0",
          })),
        };
      }),
  }),

  // ============================================================================
  // IZETTLE PAYMENT INTEGRATION
  // ============================================================================
  izettle: router({
    // Get authorization URL to connect iZettle account
    getAuthUrl: adminProcedure
      .query(async ({ ctx }) => {
        const { getAuthorizationUrl } = await import('./services/izettle');
        return { url: getAuthorizationUrl(ctx.tenantId) };
      }),

    // Get iZettle connection status for admin
    getStatus: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(eq(paymentProviders.providerType, 'izettle'))
          .limit(1);

        if (!provider) {
        return {
          connected: false,
          email: null,
          accountId: null,
          lastSync: null as string | null,
        };
        }

        return {
          connected: !!provider.accessToken,
          email: provider.providerEmail,
          accountId: provider.providerAccountId,
          lastSync: provider.lastSyncAt ? provider.lastSyncAt.toISOString() : null,
          isActive: provider.isActive,
        };
      }),

    // Disconnect iZettle account
    disconnect: adminProcedure
      .mutation(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        await dbInstance
          .update(paymentProviders)
          .set({
            isActive: false,
            accessToken: undefined,
            refreshToken: undefined,
            tokenExpiresAt: undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          );

        return { success: true };
      }),

    // DEPRECATED: Use pos.createZettlePayment instead (Reader Connect API)
    // This endpoint is kept for backward compatibility but should not be used
    createPayment: protectedProcedure
      .input(z.object({
        amount: z.number().positive(),
        currency: z.string().default('NOK'),
        reference: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: "This endpoint is deprecated. Please use pos.createZettlePayment with PayPal Reader instead.",
        });
      }),

    // Get iZettle connection status (for any authenticated user)
    getConnectionStatus: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          return {
            isConnected: false,
            accountEmail: null,
          };
        }

        return {
          isConnected: true,
          accountEmail: provider.providerEmail || null,
        };
      }),

    // Get linked PayPal Readers
    getLinkedReaders: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          return { readers: [] };
        }

        try {
          const { decryptToken, getReaderLinks } = await import('./services/izettle');
          const accessToken = decryptToken(provider.accessToken);
          const links = await getReaderLinks(accessToken);
          
          return {
            readers: links.map((link: any) => ({
              linkId: link.id || link.linkId,
              deviceName: link.integratorTags?.deviceName || 'PayPal Reader',
              serialNumber: link.readerTags?.serialNumber || 'Unknown',
              model: link.readerTags?.model || 'PayPal Reader',
              status: 'linked',
            })),
          };
        } catch (error: any) {
          console.error('[getLinkedReaders] Error:', error.message);
          return { readers: [], error: error.message };
        }
      }),

    // DEPRECATED: Old implementation removed - use Reader Connect API
    _oldCreatePayment: protectedProcedure
      .input(z.object({
        amount: z.number().positive(),
        currency: z.string().default('NOK'),
        reference: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        if (!ctx.user.tenantId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        // Get iZettle provider
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.user.tenantId),
              eq(paymentProviders.providerType, 'izettle'),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected. Please connect your iZettle account first.",
          });
        }

        const { decryptToken, refreshAccessToken } = await import('./services/izettle');
        
        // This old implementation has been removed
        // Use pos.createZettlePayment with Reader Connect API instead
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: "This endpoint is deprecated. Please upgrade to PayPal Reader and use Reader Connect API.",
        });
      }),

    // ============================================================================
    // READER CONNECT API - Reader Link Management
    // ============================================================================

    // Create a new Reader Link
    createReaderLink: tenantProcedure
      .input(z.object({
        linkName: z.string().default("Stylora POS"),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Get iZettle provider (don't filter by isActive - it might be null/false initially)
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected. Please connect your iZettle account first.",
          });
        }

        const { decryptToken, createReaderLink } = await import('./services/izettle');
        
        // Debug: Check encrypted token before decryption
        console.log('[createReaderLink] Encrypted token from DB length:', provider.accessToken.length);
        console.log('[createReaderLink] Encrypted token preview:', provider.accessToken.substring(0, 50));
        
        const accessToken = decryptToken(provider.accessToken);
        
        // Debug: Check decrypted token
        console.log('[createReaderLink] Decrypted access token length:', accessToken.length);
        console.log('[createReaderLink] Decrypted access token first 30 chars:', accessToken.substring(0, 30));
        console.log('[createReaderLink] Decrypted access token last 20 chars:', accessToken.substring(accessToken.length - 20));
        console.log('[createReaderLink] Token starts with v1:', accessToken.startsWith('v1'));
        console.log('[createReaderLink] Token contains only valid chars:', /^[A-Za-z0-9_\-\.]+$/.test(accessToken));

        try {
          const link = await createReaderLink(accessToken, input.linkName);

          // Store linkId in provider config
          const currentConfig = provider.config ? JSON.parse(provider.config as string) : {};
          const readerLinks = currentConfig.readerLinks || [];
          readerLinks.push({
            linkId: link.linkId,
            linkName: link.linkName,
            createdAt: new Date().toISOString(),
          });

          await dbInstance
            .update(paymentProviders)
            .set({
              config: JSON.stringify({ ...currentConfig, readerLinks }),
              updatedAt: new Date(),
            })
            .where(eq(paymentProviders.id, provider.id));

          return {
            success: true,
            linkId: link.linkId,
            linkName: link.linkName,
          };
        } catch (error: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to create Reader Link: ${error.message}`,
          });
        }
      }),

    // Pair a PayPal Reader using 8-digit code
    pairReader: tenantProcedure
      .input(z.object({
        code: z.string().length(8, "Koden må være 8 tegn"),
        deviceName: z.string().default("Stylora POS"),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Log tenant info for debugging
        console.log('[pairReader] Current tenant:', ctx.tenantId);
        console.log('[pairReader] User info:', { userId: ctx.user.id, email: ctx.user.email });

        // Get iZettle provider (don't filter by isActive - it might be null/false initially)
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          )
          .limit(1);

        console.log('[pairReader] Provider found:', provider ? {
          id: provider.id,
          tenantId: provider.tenantId,
          providerType: provider.providerType,
          isActive: provider.isActive,
          hasAccessToken: !!provider.accessToken,
        } : null);

        if (!provider || !provider.accessToken) {
          console.error('[pairReader] No connected iZettle provider found for tenant:', ctx.tenantId);
          
          // Check if provider exists for ANY tenant (debugging)
          const allProviders = await dbInstance
            .select({ tenantId: paymentProviders.tenantId, providerType: paymentProviders.providerType })
            .from(paymentProviders)
            .where(eq(paymentProviders.providerType, 'izettle'));
          console.log('[pairReader] All iZettle providers in DB:', allProviders);
          
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected. Please connect your iZettle account first.",
          });
        }

        const { decryptToken, pairReaderWithCode } = await import('./services/izettle');
        const accessToken = decryptToken(provider.accessToken);

        try {
          const link = await pairReaderWithCode(accessToken, input.code, input.deviceName);

          // Store linkId in provider config
          const currentConfig = provider.config ? JSON.parse(provider.config as string) : {};
          const readerLinks = currentConfig.readerLinks || [];
          readerLinks.push({
            linkId: link.linkId,
            deviceName: link.deviceName,
            serialNumber: link.serialNumber,
            createdAt: new Date().toISOString(),
          });

          await dbInstance
            .update(paymentProviders)
            .set({
              config: JSON.stringify({ ...currentConfig, readerLinks }),
              updatedAt: new Date(),
            })
            .where(eq(paymentProviders.id, provider.id));

          return {
            success: true,
            linkId: link.linkId,
            deviceName: link.deviceName,
            serialNumber: link.serialNumber,
          };
        } catch (error: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "Failed to pair PayPal Reader",
          });
        }
      }),

    // Get all Reader Links
    getReaderLinks: tenantProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle'),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider) {
          return { links: [] };
        }

        const config = provider.config ? JSON.parse(provider.config as string) : {};
        const readerLinks = config.readerLinks || [];

        // Get status for each link
        const { getReaderConnectManager } = await import('./services/reader-connect');
        const { decryptToken } = await import('./services/izettle');
        const accessToken = provider.accessToken ? decryptToken(provider.accessToken) : null;

        const linksWithStatus = readerLinks.map((link: any) => {
          let connected = false;
          if (accessToken) {
            try {
              const manager = getReaderConnectManager(ctx.tenantId, link.linkId, accessToken);
              connected = manager.isConnected();
            } catch (error) {
              connected = false;
            }
          }
          return {
            ...link,
            connected,
          };
        });

        return { links: linksWithStatus };
      }),

    // Delete a Reader Link
    deleteReaderLink: tenantProcedure
      .input(z.object({
        linkId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle'),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected",
          });
        }

        const { decryptToken, deleteReaderLink } = await import('./services/izettle');
        const { removeReaderConnectManager } = await import('./services/reader-connect');
        const accessToken = decryptToken(provider.accessToken);

        try {
          // Delete from iZettle API
          await deleteReaderLink(accessToken, input.linkId);

          // Remove from local config
          const currentConfig = provider.config ? JSON.parse(provider.config as string) : {};
          const readerLinks = (currentConfig.readerLinks || []).filter(
            (link: any) => link.linkId !== input.linkId
          );

          await dbInstance
            .update(paymentProviders)
            .set({
              config: JSON.stringify({ ...currentConfig, readerLinks }),
              updatedAt: new Date(),
            })
            .where(eq(paymentProviders.id, provider.id));

          // Disconnect WebSocket manager
          removeReaderConnectManager(ctx.tenantId, input.linkId);

          return { success: true };
        } catch (error: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to delete Reader Link: ${error.message}`,
          });
        }
      }),

    // Connect to a Reader Link (establish WebSocket)
    connectReaderLink: tenantProcedure
      .input(z.object({
        linkId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle'),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected",
          });
        }

        const { decryptToken } = await import('./services/izettle');
        const { getReaderConnectManager } = await import('./services/reader-connect');
        const accessToken = decryptToken(provider.accessToken);

        try {
          const manager = getReaderConnectManager(ctx.tenantId, input.linkId, accessToken);
          
          if (!manager.isConnected()) {
            await manager.connect();
          }

          return { success: true, connected: true };
        } catch (error: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to connect to Reader: ${error.message}`,
          });
        }
      }),

    // Get payment history (last 10 payments)
    getPaymentHistory: adminProcedure
      .query(async ({ ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { payments, paymentProviders } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");

        // Get iZettle provider (don't filter by isActive - it might be null/false initially)
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.tenantId),
              eq(paymentProviders.providerType, 'izettle')
            )
          )
          .limit(1);

        if (!provider) {
          return { payments: [] };
        }

        // Get last 10 iZettle payments
        const recentPayments = await dbInstance
          .select({
            id: payments.id,
            amount: payments.amount,
            currency: payments.currency,
            status: payments.status,
            createdAt: payments.createdAt,
            processedAt: payments.processedAt,
            gatewayPaymentId: payments.gatewayPaymentId,
            gatewayMetadata: payments.gatewayMetadata,
          })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, ctx.tenantId),
              eq(payments.paymentGateway, 'izettle')
            )
          )
          .orderBy(desc(payments.createdAt))
          .limit(10);

        // Parse metadata to get Reader Link info
        const config = provider.config ? JSON.parse(provider.config as string) : {};
        const readerLinks = config.readerLinks || [];

        const paymentsWithDetails = recentPayments.map((payment) => {
          let metadata: any = {};
          try {
            metadata = payment.gatewayMetadata ? JSON.parse(payment.gatewayMetadata as string) : {};
          } catch (error) {
            // Ignore parse errors
          }

          // Try to find Reader Link name from metadata
          let readerName = "Unknown Reader";
          if (metadata.linkId) {
            const link = readerLinks.find((l: any) => l.linkId === metadata.linkId);
            if (link) {
              readerName = link.linkName;
            }
          }

          return {
            id: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            createdAt: payment.createdAt,
            processedAt: payment.processedAt,
            purchaseUUID: payment.gatewayPaymentId,
            readerName,
          };
        });

        return { payments: paymentsWithDetails };
      }),

    // ============================================================================
    // DEPRECATED ENDPOINTS
    // ============================================================================

    // Get payment status
    getPaymentStatus: protectedProcedure
      .input(z.object({
        purchaseUUID: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        if (!ctx.user.tenantId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tenant access" });
        }

        const { paymentProviders } = await import("../drizzle/schema");
        const [provider] = await dbInstance
          .select()
          .from(paymentProviders)
          .where(
            and(
              eq(paymentProviders.tenantId, ctx.user.tenantId),
              eq(paymentProviders.providerType, 'izettle'),
              eq(paymentProviders.isActive, true)
            )
          )
          .limit(1);

        if (!provider || !provider.accessToken) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "iZettle not connected",
          });
        }

        const { decryptToken, getPaymentStatus } = await import('./services/izettle');
        const accessToken = decryptToken(provider.accessToken);

        try {
          const status = await getPaymentStatus(accessToken, input.purchaseUUID);
          return status;
        } catch (error: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to get payment status: ${error.message}`,
          });
        }
      }),
  }),

  // ============================================================================
  // PAYMENT SETTINGS (for online booking)
  // ============================================================================
  paymentSettings: router({
    // Get payment settings for tenant
    get: tenantProcedure.query(async ({ ctx }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { paymentSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [settings] = await dbInstance
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.tenantId, ctx.tenantId))
        .limit(1);

      // Return default settings if none exist
      if (!settings) {
        return {
          vippsEnabled: false,
          cardEnabled: false,
          cashEnabled: true,
          payAtSalonEnabled: true,
          vippsTestMode: true,
          stripeTestMode: true,
          defaultPaymentMethod: "pay_at_salon" as const,
        };
      }

      return settings;
    }),

    // Update payment settings
    update: adminProcedure
      .input(
        z.object({
          vippsEnabled: z.boolean().optional(),
          cardEnabled: z.boolean().optional(),
          cashEnabled: z.boolean().optional(),
          payAtSalonEnabled: z.boolean().optional(),
          vippsClientId: z.string().optional(),
          vippsClientSecret: z.string().optional(),
          vippsSubscriptionKey: z.string().optional(),
          vippsMerchantSerialNumber: z.string().optional(),
          vippsTestMode: z.boolean().optional(),
          stripePublishableKey: z.string().optional(),
          stripeSecretKey: z.string().optional(),
          stripeTestMode: z.boolean().optional(),
          defaultPaymentMethod: z.enum(["vipps", "card", "cash", "pay_at_salon"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Check if settings exist
        const [existing] = await dbInstance
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, ctx.tenantId))
          .limit(1);

        if (existing) {
          // Update existing settings
          await dbInstance
            .update(paymentSettings)
            .set({
              ...input,
              updatedAt: new Date(),
            })
            .where(eq(paymentSettings.tenantId, ctx.tenantId));
        } else {
          // Create new settings
          await dbInstance.insert(paymentSettings).values({
            tenantId: ctx.tenantId,
            ...input,
          });
        }

        // Return updated settings
        const [updated] = await dbInstance
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, ctx.tenantId))
          .limit(1);

        return updated;
      }),

    // Get public payment settings (for booking page)
    getPublic: publicProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        }

        const { paymentSettings } = await import("../drizzle/schema");
        const [settings] = await dbInstance
          .select({
            vippsEnabled: paymentSettings.vippsEnabled,
            cardEnabled: paymentSettings.cardEnabled,
            cashEnabled: paymentSettings.cashEnabled,
            payAtSalonEnabled: paymentSettings.payAtSalonEnabled,
            defaultPaymentMethod: paymentSettings.defaultPaymentMethod,
            // Don't expose sensitive keys
          })
          .from(paymentSettings)
          .where(eq(paymentSettings.tenantId, input.tenantId))
          .limit(1);

        // Return default settings if none exist
        if (!settings) {
          return {
            vippsEnabled: false,
            cardEnabled: false,
            cashEnabled: true,
            payAtSalonEnabled: true,
            defaultPaymentMethod: "pay_at_salon" as const,
          };
        }

        return settings;
      }),
  }),

  // ============================================================================
  // MY BOOKINGS (Customer Portal)
  // ============================================================================
  myBookings: router({
    // Get all bookings for the authenticated user (by email)
    list: protectedProcedure
      .input(z.object({
        tenantId: z.string(),
        status: z.enum(["upcoming", "past", "canceled", "all"]).optional().default("all"),
      }))
      .query(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, services, appointmentServices, users } = await import("../drizzle/schema");
        const { eq, and, gte, lt, desc, or } = await import("drizzle-orm");

        // Find customer by user email
        const userEmail = ctx.user.email;
        if (!userEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User email not found" });
        }

        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.email, userEmail)
            )
          )
          .limit(1);

        if (!customer) {
          return []; // No customer found with this email
        }

        // Build status filter
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        let statusConditions = [];
        if (input.status === "upcoming") {
          statusConditions.push(
            and(
              gte(appointments.appointmentDate, today),
              or(
                eq(appointments.status, "pending"),
                eq(appointments.status, "confirmed")
              )
            )
          );
        } else if (input.status === "past") {
          statusConditions.push(
            or(
              lt(appointments.appointmentDate, today),
              eq(appointments.status, "completed")
            )
          );
        } else if (input.status === "canceled") {
          statusConditions.push(eq(appointments.status, "canceled"));
        }

        // Fetch appointments
        const query = dbInstance
          .select({
            id: appointments.id,
            appointmentDate: appointments.appointmentDate,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            status: appointments.status,
            notes: appointments.notes,
            employeeId: appointments.employeeId,
            employeeName: users.name,
            cancellationReason: appointments.cancellationReason,
            canceledAt: appointments.canceledAt,
            canceledBy: appointments.canceledBy,
            managementToken: appointments.managementToken,
            rescheduleCount: appointments.rescheduleCount,
          })
          .from(appointments)
          .leftJoin(users, eq(appointments.employeeId, users.id))
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.customerId, customer.id),
              ...(statusConditions.length > 0 ? statusConditions : [])
            )
          )
          .orderBy(desc(appointments.appointmentDate), desc(appointments.startTime));

        const bookings = await query;

        // Fetch services for each booking
        const bookingsWithServices = await Promise.all(
          bookings.map(async (booking) => {
            const aptServices = await dbInstance
              .select({
                serviceName: services.name,
                servicePrice: appointmentServices.price,
                serviceDuration: services.durationMinutes,
              })
              .from(appointmentServices)
              .leftJoin(services, eq(appointmentServices.serviceId, services.id))
              .where(eq(appointmentServices.appointmentId, booking.id));

            return {
              ...booking,
              services: aptServices,
            };
          })
        );

        return bookingsWithServices;
      }),

    // Cancel a booking by the authenticated user
    cancel: protectedProcedure
      .input(z.object({
        tenantId: z.string(),
        appointmentId: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, tenants } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Find customer by user email
        const userEmail = ctx.user.email;
        if (!userEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User email not found" });
        }

        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.email, userEmail)
            )
          )
          .limit(1);

        if (!customer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }

        // Check if appointment exists and belongs to user's tenant
        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.tenantId, input.tenantId)
            )
          )
          .limit(1);

        if (!appointment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check reschedule limit (max 2 times)
        const MAX_RESCHEDULES = 2;
        if (appointment.rescheduleCount >= MAX_RESCHEDULES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Du har nådd maksimalt antall endringer (${MAX_RESCHEDULES}) for denne bookingen`,
          });
        }

        // Check if already canceled
        if (appointment.status === "canceled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Appointment is already canceled" });
        }

        // Check if already completed
        if (appointment.status === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot cancel a completed appointment" });
        }

        // Get tenant cancellation policy
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);

        const cancellationWindowHours = tenant?.cancellationWindowHours ?? 24;

        // Check if within cancellation window
        const appointmentDateTime = new Date(appointment.appointmentDate);
        const [hours, minutes] = String(appointment.startTime).split(":").map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);

        const cancellationDeadline = new Date(appointmentDateTime);
        cancellationDeadline.setHours(cancellationDeadline.getHours() - cancellationWindowHours);

        const now = new Date();
        const isLateCancellation = now > cancellationDeadline;

        // Update appointment status
        await dbInstance
          .update(appointments)
          .set({
            status: "canceled",
            canceledAt: now,
            canceledBy: "customer",
            cancellationReason: input.reason || "Canceled by customer",
            isLateCancellation,
          })
          .where(eq(appointments.id, input.appointmentId));

        // Send cancellation notification
        const { sendAppointmentCancellationIfPossible } = await import("./notifications-appointments");
        sendAppointmentCancellationIfPossible(input.appointmentId, input.tenantId).catch((err) => {
          console.error("[MyBookings] Failed to send cancellation email:", err);
        });

        return {
          success: true,
          isLateCancellation,
          message: isLateCancellation
            ? `Booking canceled. Note: This is a late cancellation (less than ${cancellationWindowHours} hours notice).`
            : "Booking canceled successfully.",
        };
      }),

    // Get cancellation policy for tenant
    getCancellationPolicy: protectedProcedure
      .input(z.object({ tenantId: z.string() }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { tenants } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [tenant] = await dbInstance
          .select({
            cancellationWindowHours: tenants.cancellationWindowHours,
            requirePrepayment: tenants.requirePrepayment,
          })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);

        return {
          cancellationWindowHours: tenant?.cancellationWindowHours ?? 24,
          requirePrepayment: tenant?.requirePrepayment ?? false,
        };
      }),

    // Get available time slots for rescheduling
    getAvailableTimeSlots: protectedProcedure
      .input(z.object({
        tenantId: z.string(),
        appointmentId: z.number(),
        date: z.string(), // YYYY-MM-DD format
      }))
      .query(async ({ input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) return [];

        const { appointments, services, appointmentServices, employeeSchedules } = await import("../drizzle/schema");
        const { eq, and, or } = await import("drizzle-orm");

        // Get appointment details
        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.tenantId, input.tenantId)
            )
          )
          .limit(1);

        if (!appointment) return [];

        // Get service duration
        const [aptService] = await dbInstance
          .select({ serviceId: appointmentServices.serviceId })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, input.appointmentId))
          .limit(1);

        if (!aptService) return [];

        const [service] = await dbInstance
          .select({ durationMinutes: services.durationMinutes })
          .from(services)
          .where(eq(services.id, aptService.serviceId))
          .limit(1);

        if (!service) return [];

        // Get employee schedule for the selected date
        const selectedDate = new Date(input.date);
        const dayOfWeek = selectedDate.getDay();

        if (!appointment.employeeId) return [];

        const [schedule] = await dbInstance
          .select()
          .from(employeeSchedules)
          .where(
            and(
              eq(employeeSchedules.employeeId, appointment.employeeId),
              eq(employeeSchedules.dayOfWeek, dayOfWeek)
            )
          )
          .limit(1);

        if (!schedule || !schedule.isActive) return [];

        // Parse working hours
        const startHour = parseInt(schedule.startTime.split(":")[0]);
        const startMinute = parseInt(schedule.startTime.split(":")[1]);
        const endHour = parseInt(schedule.endTime.split(":")[0]);
        const endMinute = parseInt(schedule.endTime.split(":")[1]);

        const workStartMinutes = startHour * 60 + startMinute;
        const workEndMinutes = endHour * 60 + endMinute;

        // Get existing appointments for this employee on this date
        const existingAppointments = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.employeeId, appointment.employeeId),
              eq(appointments.appointmentDate, selectedDate),
              or(
                eq(appointments.status, "pending"),
                eq(appointments.status, "confirmed")
              )
            )
          );

        // Generate time slots (every 30 minutes)
        const slots: string[] = [];
        const slotInterval = 30; // minutes

        for (let minutes = workStartMinutes; minutes + service.durationMinutes <= workEndMinutes; minutes += slotInterval) {
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          const timeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

          // Check if this slot conflicts with existing appointments (excluding current appointment)
          const slotEndMinutes = minutes + service.durationMinutes;
          let isAvailable = true;

          for (const apt of existingAppointments) {
            if (apt.id === input.appointmentId) continue; // Skip current appointment

            const aptStartTime = apt.startTime ? apt.startTime.toString() : "00:00:00";
            const aptEndTime = apt.endTime ? apt.endTime.toString() : "23:59:59";
            const [aptStartH, aptStartM] = aptStartTime.split(":").map(Number);
            const [aptEndH, aptEndM] = aptEndTime.split(":").map(Number);
            const aptStartMinutes = aptStartH * 60 + aptStartM;
            const aptEndMinutes = aptEndH * 60 + aptEndM;

            // Check for overlap
            if (
              (minutes >= aptStartMinutes && minutes < aptEndMinutes) ||
              (slotEndMinutes > aptStartMinutes && slotEndMinutes <= aptEndMinutes) ||
              (minutes <= aptStartMinutes && slotEndMinutes >= aptEndMinutes)
            ) {
              isAvailable = false;
              break;
            }
          }

          if (isAvailable) {
            slots.push(timeStr);
          }
        }

        return slots;
      }),

    // Reschedule a booking by the authenticated user
    reschedule: protectedProcedure
      .input(z.object({
        tenantId: z.string(),
        appointmentId: z.number(),
        newDate: z.string(), // YYYY-MM-DD format
        newTime: z.string(), // HH:MM format
      }))
      .mutation(async ({ ctx, input }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers, tenants, services, appointmentServices, employeeSchedules } = await import("../drizzle/schema");
        const { eq, and, gte, lte, or } = await import("drizzle-orm");

        // Find customer by user email
        const userEmail = ctx.user.email;
        if (!userEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User email not found" });
        }

        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.email, userEmail)
            )
          )
          .limit(1);

        if (!customer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }

        // Get appointment
        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.customerId, customer.id)
            )
          )
          .limit(1);

        if (!appointment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
        }

        // Check if already canceled or completed
        if (appointment.status === "canceled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reschedule a canceled appointment" });
        }
        if (appointment.status === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reschedule a completed appointment" });
        }

        // Get tenant reschedule policy (use same window as cancellation)
        const [tenant] = await dbInstance
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);

        const rescheduleWindowHours = tenant?.cancellationWindowHours ?? 24;

        // Check if within reschedule window
        const oldAppointmentDateTime = new Date(appointment.appointmentDate);
        const [oldHours, oldMinutes] = String(appointment.startTime).split(":").map(Number);
        oldAppointmentDateTime.setHours(oldHours, oldMinutes, 0, 0);

        const rescheduleDeadline = new Date(oldAppointmentDateTime);
        rescheduleDeadline.setHours(rescheduleDeadline.getHours() - rescheduleWindowHours);

        const now = new Date();
        if (now > rescheduleDeadline) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot reschedule within ${rescheduleWindowHours} hours of appointment time. Please contact the salon directly.`,
          });
        }

        // Validate new date/time is in the future
        const newAppointmentDateTime = new Date(`${input.newDate}T${input.newTime}:00`);
        if (newAppointmentDateTime <= now) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "New appointment time must be in the future" });
        }

        // Get service duration to calculate end time
        const [aptService] = await dbInstance
          .select({
            serviceId: appointmentServices.serviceId,
          })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, input.appointmentId))
          .limit(1);

        if (!aptService) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found for appointment" });
        }

        const [service] = await dbInstance
          .select({
            durationMinutes: services.durationMinutes,
          })
          .from(services)
          .where(eq(services.id, aptService.serviceId))
          .limit(1);

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service details not found" });
        }

        // Calculate new end time
        const [newHours, newMinutes] = input.newTime.split(":").map(Number);
        const startMinutes = newHours * 60 + newMinutes;
        const endMinutes = startMinutes + service.durationMinutes;
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;
        const newEndTime = `${endHour.toString().padStart(2, "0")}:${endMinute.toString().padStart(2, "0")}:00`;

        // Check if employee is available at new time
        if (appointment.employeeId) {
          // Check employee schedule
          const dayOfWeek = newAppointmentDateTime.getDay();
          const [schedule] = await dbInstance
            .select()
            .from(employeeSchedules)
            .where(
              and(
                eq(employeeSchedules.employeeId, appointment.employeeId),
                eq(employeeSchedules.dayOfWeek, dayOfWeek)
              )
            )
            .limit(1);

          if (!schedule || !schedule.isActive) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Employee is not available on this day" });
          }

          // Check if time is within employee's working hours
          const requestedStartMinutes = newHours * 60 + newMinutes;
          const scheduleStartMinutes = schedule.startTime ? parseInt(schedule.startTime.split(":")[0]) * 60 + parseInt(schedule.startTime.split(":")[1]) : 0;
          const scheduleEndMinutes = schedule.endTime ? parseInt(schedule.endTime.split(":")[0]) * 60 + parseInt(schedule.endTime.split(":")[1]) : 1440;

          if (requestedStartMinutes < scheduleStartMinutes || endMinutes > scheduleEndMinutes) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Requested time is outside employee's working hours" });
          }

          // Check for conflicting appointments
          const conflictingAppointments = await dbInstance
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.tenantId, input.tenantId),
                eq(appointments.employeeId, appointment.employeeId),
                eq(appointments.appointmentDate, new Date(input.newDate)),
                or(
                  eq(appointments.status, "pending"),
                  eq(appointments.status, "confirmed")
                )
              )
            );

          // Check for time overlap (excluding current appointment)
          for (const conflict of conflictingAppointments) {
            if (conflict.id === input.appointmentId) continue; // Skip current appointment

            const conflictStart = conflict.startTime ? conflict.startTime.toString() : "00:00:00";
            const conflictEnd = conflict.endTime ? conflict.endTime.toString() : "23:59:59";
            const [cStartH, cStartM] = conflictStart.split(":").map(Number);
            const [cEndH, cEndM] = conflictEnd.split(":").map(Number);
            const conflictStartMinutes = cStartH * 60 + cStartM;
            const conflictEndMinutes = cEndH * 60 + cEndM;

            // Check if times overlap
            if (
              (requestedStartMinutes >= conflictStartMinutes && requestedStartMinutes < conflictEndMinutes) ||
              (endMinutes > conflictStartMinutes && endMinutes <= conflictEndMinutes) ||
              (requestedStartMinutes <= conflictStartMinutes && endMinutes >= conflictEndMinutes)
            ) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "This time slot is already booked" });
            }
          }
        }

        // Update appointment and increment reschedule counter
        const newAppointmentDate = new Date(input.newDate);
        await dbInstance
          .update(appointments)
          .set({
            appointmentDate: newAppointmentDate,
            startTime: input.newTime,
            endTime: newEndTime,
            rescheduleCount: appointment.rescheduleCount + 1,
            updatedAt: now,
          })
          .where(eq(appointments.id, input.appointmentId));

        // Send reschedule notification
        const { sendAppointmentRescheduleIfPossible } = await import("./notifications-appointments");
        sendAppointmentRescheduleIfPossible(
          input.appointmentId,
          input.tenantId,
          oldAppointmentDateTime.toISOString(),
          newAppointmentDateTime.toISOString()
        ).catch((err: any) => {
          console.error("[MyBookings] Failed to send reschedule email:", err);
        });

        // Log appointment history
        const { appointmentHistory } = await import("../drizzle/schema");
        await dbInstance.insert(appointmentHistory).values({
          tenantId: input.tenantId,
          appointmentId: input.appointmentId,
          changeType: "rescheduled",
          fieldName: "appointmentDate,startTime",
          oldValue: JSON.stringify({
            date: oldAppointmentDateTime.toISOString().split('T')[0],
            time: String(appointment.startTime).slice(0, 5),
          }),
          newValue: JSON.stringify({
            date: input.newDate,
            time: input.newTime,
          }),
          changedBy: "customer",
          changedByEmail: ctx.user.email || undefined,
          notes: "Rescheduled via My Bookings page",
        });

        return {
          success: true,
          message: "Booking rescheduled successfully",
          newDate: input.newDate,
          newTime: input.newTime,
        };
      }),

    // Get appointment history
    getAppointmentHistory: protectedProcedure
      .input(
        z.object({
          tenantId: z.string(),
          appointmentId: z.number(),
        })
      )
      .query(async ({ input, ctx }) => {
        const dbInstance = await db.getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { appointments, customers: customersSchema } = await import("../drizzle/schema");
        const customers = customersSchema;

        // Verify customer owns this appointment
        const [customer] = await dbInstance
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, input.tenantId),
              eq(customers.phone, ctx.user.phone || "")
            )
          )
          .limit(1);

        if (!customer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }

        // Verify appointment belongs to customer
        const [appointment] = await dbInstance
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.tenantId, input.tenantId),
              eq(appointments.customerId, customer.id)
            )
          )
          .limit(1);

        if (!appointment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Fetch history records
        const { appointmentHistory } = await import("../drizzle/schema");
        const history = await dbInstance
          .select()
          .from(appointmentHistory)
          .where(
            and(
              eq(appointmentHistory.appointmentId, input.appointmentId),
              eq(appointmentHistory.tenantId, input.tenantId)
            )
          )
          .orderBy(desc(appointmentHistory.createdAt));

        return history;
      }),
  }),

});

export type AppRouter = typeof appRouter;
