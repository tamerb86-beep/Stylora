import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, services, serviceCategories, settings } from "../../drizzle/schema";
import { hash } from "bcryptjs";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { sendWelcomeEmail } from "../services/welcomeEmail";

const onboardingSchema = z.object({
  salonInfo: z.object({
    salonName: z.string().min(2),
    subdomain: z.string().min(3).regex(/^[a-z0-9-]+$/),
    address: z.string().min(5),
    city: z.string().min(2),
    phone: z.string().min(8),
    email: z.string().email(),
  }),
  ownerAccount: z.object({
    ownerName: z.string().min(2),
    ownerEmail: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
  }),
  businessHours: z.object({
    mondayOpen: z.string(),
    mondayClose: z.string(),
    tuesdayOpen: z.string(),
    tuesdayClose: z.string(),
    wednesdayOpen: z.string(),
    wednesdayClose: z.string(),
    thursdayOpen: z.string(),
    thursdayClose: z.string(),
    fridayOpen: z.string(),
    fridayClose: z.string(),
    saturdayOpen: z.string(),
    saturdayClose: z.string(),
    sundayClosed: z.boolean(),
  }),
  employees: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      phone: z.string().optional(),
      role: z.enum(["employee", "manager", "admin"]),
      permissions: z.object({
        viewAppointments: z.boolean(),
        manageCustomers: z.boolean(),
        accessReports: z.boolean(),
      }),
    })
  ).optional(),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      duration: z.number(),
      price: z.number(),
      description: z.string().optional(),
      color: z.string(),
    })
  ).optional(),
  paymentSettings: z.object({
    stripeEnabled: z.boolean().optional(),
    vippsEnabled: z.boolean().optional(),
  }).optional(),
});

export const onboardingRouter = router({
  /**
   * Check if subdomain is available
   */
  checkSubdomain: publicProcedure
    .input(z.object({ subdomain: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const existing = await db
        .select()
        .from(tenants)
        .where(eq(tenants.subdomain, input.subdomain))
        .limit(1);

      return {
        available: existing.length === 0,
      };
    }),

  /**
   * Complete onboarding process
   */
  complete: publicProcedure
    .input(onboardingSchema)
    .mutation(async ({ input }) => {
      const { salonInfo, ownerAccount, businessHours, employees: initialEmployees, services: initialServices, paymentSettings } = input;

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 1. Check subdomain availability
      const existingTenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.subdomain, salonInfo.subdomain))
        .limit(1);

      if (existingTenant.length > 0) {
        throw new Error("النطاق الفرعي غير متاح");
      }

      // 2. Create tenant
      const tenantId = nanoid();
      await db.insert(tenants).values({
        id: tenantId,
        name: salonInfo.salonName,
        subdomain: salonInfo.subdomain,
        address: salonInfo.address,
        phone: salonInfo.phone,
        email: salonInfo.email,
        status: "trial",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 3. Create owner user account
      const hashedPassword = await hash(ownerAccount.password, 10);
      const userId = nanoid();
      
      await db.insert(users).values({
        tenantId,
        openId: `owner-${userId}`,
        name: ownerAccount.ownerName,
        email: ownerAccount.ownerEmail,
        passwordHash: hashedPassword,
        role: "owner",
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      });

      // 4. Create settings with business hours
      const businessHoursJson = {
        monday: { open: businessHours.mondayOpen, close: businessHours.mondayClose },
        tuesday: { open: businessHours.tuesdayOpen, close: businessHours.tuesdayClose },
        wednesday: { open: businessHours.wednesdayOpen, close: businessHours.wednesdayClose },
        thursday: { open: businessHours.thursdayOpen, close: businessHours.thursdayClose },
        friday: { open: businessHours.fridayOpen, close: businessHours.fridayClose },
        saturday: { open: businessHours.saturdayOpen, close: businessHours.saturdayClose },
        sunday: businessHours.sundayClosed ? null : { open: "10:00", close: "16:00" },
      };

      await db.insert(settings).values({
        tenantId,
        settingKey: "business_hours",
        settingValue: JSON.stringify(businessHoursJson),
      });

      // 5. Create default settings
      const defaultSettings = [
        { key: "booking_enabled", value: "true" },
        { key: "booking_advance_days", value: "30" },
        { key: "booking_min_notice_hours", value: "2" },
        { key: "sms_enabled", value: "false" },
        { key: "email_enabled", value: "true" },
        { key: "currency", value: "NOK" },
        { key: "timezone", value: "Europe/Oslo" },
        { key: "language", value: "no" },
      ];

      for (const setting of defaultSettings) {
        await db.insert(settings).values({
          tenantId,
          settingKey: setting.key,
          settingValue: setting.value,
        });
      }

      // 6. Create initial employees (if provided)
      if (initialEmployees && initialEmployees.length > 0) {
        for (const emp of initialEmployees) {
          const empId = nanoid();
          const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit PIN

          await db.insert(users).values({
            tenantId,
            openId: `employee-${empId}`,
            name: emp.name,
            email: emp.email || null,
            phone: emp.phone || null,
            role: emp.role || "employee",
            pin,
            isActive: true,
            deactivatedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          });
        }
      }

      // 7. Create service categories and services
      // serviceCategories.id is autoincrement, so we need to insert and get the ID back
      
      if (initialServices && initialServices.length > 0) {
        // Extract unique categories from services
        const uniqueCategories = [...new Set(initialServices.map(s => s.category))];
        const categoryMap = new Map<string, number>();
        
        // Create categories (id is autoincrement, don't pass it)
        for (let i = 0; i < uniqueCategories.length; i++) {
          const result = await db.insert(serviceCategories).values({
            tenantId,
            name: uniqueCategories[i],
            displayOrder: i + 1,
          });
          // Get the inserted ID
          const insertedId = Number(result[0].insertId);
          categoryMap.set(uniqueCategories[i], insertedId);
        }
        
        // Create services
        for (const svc of initialServices) {
          const categoryId = categoryMap.get(svc.category);
          await db.insert(services).values({
            tenantId,
            categoryId: categoryId || null,
            name: svc.name,
            durationMinutes: svc.duration,
            price: String(svc.price),
            description: svc.description || null,
            isActive: true,
          });
        }
      } else {
        // Create default category (id is autoincrement)
        const result = await db.insert(serviceCategories).values({
          tenantId,
          name: "خدمات عامة",
          displayOrder: 1,
        });
        const categoryId = Number(result[0].insertId);
        
        // Create default services
        const defaultServices = [
          { name: "قص شعر رجالي", duration: 30, price: "250" },
          { name: "حلاقة ذقن", duration: 20, price: "150" },
          { name: "قص شعر + حلاقة", duration: 45, price: "350" },
        ];

        for (const svc of defaultServices) {
          await db.insert(services).values({
            tenantId,
            categoryId,
            name: svc.name,
            durationMinutes: svc.duration,
            price: svc.price,
            isActive: true,
          });
        }
      }

      // 8. Store payment settings (if provided)
      if (paymentSettings) {
        if (paymentSettings.stripeEnabled) {
          await db.insert(settings).values({
            tenantId,
            settingKey: "stripe_enabled",
            settingValue: "true",
          });
        }
        if (paymentSettings.vippsEnabled) {
          await db.insert(settings).values({
            tenantId,
            settingKey: "vipps_enabled",
            settingValue: "true",
          });
        }
      }

      // 9. Send welcome email
      try {
        await sendWelcomeEmail({
          salonName: salonInfo.salonName,
          ownerName: ownerAccount.ownerName,
          ownerEmail: ownerAccount.ownerEmail,
          subdomain: salonInfo.subdomain,
          loginUrl: `https://${salonInfo.subdomain}.stylora.no/login`,
          trialDays: 14,
        });
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
        // Don't fail onboarding if email fails
      }

      return {
        success: true,
        tenantId,
        subdomain: salonInfo.subdomain,
        email: ownerAccount.ownerEmail,
        message: "تم إنشاء حسابك بنجاح! تحقق من بريدك الإلكتروني للحصول على تعليمات تسجيل الدخول.",
      };
    }),

  /**
   * Generate QR code for employee check-in
   */
  generateEmployeeQR: publicProcedure
    .input(z.object({ employeeId: z.string(), tenantId: z.string() }))
    .mutation(async ({ input }) => {
      const qrCodeData = JSON.stringify({
        employeeId: input.employeeId,
        tenantId: input.tenantId,
        type: "checkin",
      });

      const qrCodeUrl = await QRCode.toDataURL(qrCodeData);

      return {
        qrCode: qrCodeUrl,
      };
    }),
});
