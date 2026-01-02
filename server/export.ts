import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { expenses, appointments, appointmentServices, services as servicesTable, customers } from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// PDF generation using simple HTML template
async function generateFinancialPDF(data: {
  tenantId: string;
  startDate: string;
  endDate: string;
  summary: { revenue: number; expenses: number; profit: number; profitMargin: number };
  expensesByCategory: Array<{ category: string; total: string }>;
  salonName?: string;
}) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #1e40af; padding-bottom: 20px; }
    .header h1 { margin: 0; color: #1e40af; font-size: 32px; }
    .header p { margin: 5px 0; color: #666; }
    .period { text-align: center; font-size: 14px; color: #666; margin-bottom: 30px; }
    .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 40px; }
    .summary-card { border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; }
    .summary-card h3 { margin: 0 0 10px 0; font-size: 14px; color: #666; text-transform: uppercase; }
    .summary-card .value { font-size: 28px; font-weight: bold; margin: 0; }
    .summary-card .value.positive { color: #16a34a; }
    .summary-card .value.negative { color: #dc2626; }
    .breakdown { margin-top: 40px; }
    .breakdown h2 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 20px; }
    .breakdown-item { display: flex; justify-between; padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .breakdown-item:last-child { border-bottom: none; }
    .breakdown-item .category { font-weight: 500; }
    .breakdown-item .amount { color: #dc2626; font-weight: bold; }
    .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${data.salonName || "Stylora"}</h1>
    <p>Finansiell rapport</p>
  </div>
  
  <div class="period">
    Periode: ${data.startDate} til ${data.endDate}
  </div>
  
  <div class="summary">
    <div class="summary-card">
      <h3>Inntekter</h3>
      <p class="value positive">${formatNOK(data.summary.revenue)}</p>
    </div>
    <div class="summary-card">
      <h3>Utgifter</h3>
      <p class="value negative">${formatNOK(data.summary.expenses)}</p>
    </div>
    <div class="summary-card">
      <h3>Fortjeneste</h3>
      <p class="value ${data.summary.profit >= 0 ? "positive" : "negative"}">${formatNOK(data.summary.profit)}</p>
    </div>
    <div class="summary-card">
      <h3>Margin</h3>
      <p class="value ${data.summary.profitMargin >= 0 ? "positive" : "negative"}">${data.summary.profitMargin.toFixed(1)}%</p>
    </div>
  </div>
  
  <div class="breakdown">
    <h2>Utgifter per kategori</h2>
    ${data.expensesByCategory
      .map(
        (item) => `
      <div class="breakdown-item">
        <span class="category">${getCategoryLabel(item.category)}</span>
        <span class="amount">${formatNOK(parseFloat(item.total))}</span>
      </div>
    `
      )
      .join("")}
  </div>
  
  <div class="footer">
    Generert ${new Date().toLocaleDateString("nb-NO")} kl. ${new Date().toLocaleTimeString("nb-NO")}
  </div>
</body>
</html>
  `;

  return html;
}

function formatNOK(amount: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(amount);
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    rent: "Husleie",
    utilities: "Strøm og vann",
    supplies: "Forsyninger",
    salaries: "Lønninger",
    marketing: "Markedsføring",
    maintenance: "Vedlikehold",
    insurance: "Forsikring",
    taxes: "Skatter",
    other: "Annet",
  };
  return labels[category] || category;
}

// Excel generation using CSV format (compatible with Excel)
async function generateFinancialExcel(data: {
  expenses: Array<{ id: number; category: string; amount: string; description: string | null; expenseDate: Date | null }>;
  startDate: string;
  endDate: string;
}) {
  const headers = ["Dato", "Kategori", "Beløp (NOK)", "Beskrivelse"];
  const rows = data.expenses.map((exp) => [
    exp.expenseDate ? new Date(exp.expenseDate).toLocaleDateString("nb-NO") : "N/A",
    getCategoryLabel(exp.category),
    parseFloat(exp.amount).toFixed(2),
    exp.description || "",
  ]);

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");

  return csv;
}

export const exportRouter = router({
  financialPDF: protectedProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      // Get summary
      const revenueResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${servicesTable.price}), 0)` })
        .from(appointments)
        .leftJoin(appointmentServices, eq(appointments.id, appointmentServices.appointmentId))
        .leftJoin(servicesTable, eq(appointmentServices.serviceId, servicesTable.id))
        .where(
          and(
            eq(appointments.tenantId, ctx.user.tenantId),
            eq(appointments.status, "completed"),
            gte(appointments.appointmentDate, new Date(input.startDate)),
            lte(appointments.appointmentDate, new Date(input.endDate))
          )
        );

      const expensesResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, ctx.user.tenantId),
            gte(expenses.expenseDate, new Date(input.startDate)),
            lte(expenses.expenseDate, new Date(input.endDate))
          )
        );

      const revenue = parseFloat(revenueResult[0]?.total || "0");
      const totalExpenses = parseFloat(expensesResult[0]?.total || "0");
      const profit = revenue - totalExpenses;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

      // Get expenses by category
      const expensesByCategory = await db
        .select({
          category: expenses.category,
          total: sql<string>`SUM(${expenses.amount})`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, ctx.user.tenantId),
            gte(expenses.expenseDate, new Date(input.startDate)),
            lte(expenses.expenseDate, new Date(input.endDate))
          )
        )
        .groupBy(expenses.category)
        .orderBy(desc(sql`SUM(${expenses.amount})`));

      const html = await generateFinancialPDF({
        tenantId: ctx.user.tenantId!,
        startDate: input.startDate,
        endDate: input.endDate,
        summary: {
          revenue,
          expenses: totalExpenses,
          profit,
          profitMargin,
        },
        expensesByCategory,
        salonName: "Stylora", // TODO: Get from tenant settings
      });

      return { html };
    }),

  financialExcel: protectedProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const expensesList = await db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.tenantId, ctx.user.tenantId),
            gte(expenses.expenseDate, new Date(input.startDate)),
            lte(expenses.expenseDate, new Date(input.endDate))
          )
        )
        .orderBy(desc(expenses.expenseDate));

      const csv = await generateFinancialExcel({
        expenses: expensesList,
        startDate: input.startDate,
        endDate: input.endDate,
      });

      return { csv };
    }),
});
