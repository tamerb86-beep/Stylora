import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { 
  FileText, 
  Download, 
  Calendar, 
  DollarSign, 
  Users, 
  TrendingUp,
  Briefcase,
  Plane,
  AlertCircle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

const MONTHS = [
  { value: "1", label: "Januar" },
  { value: "2", label: "Februar" },
  { value: "3", label: "Mars" },
  { value: "4", label: "April" },
  { value: "5", label: "Mai" },
  { value: "6", label: "Juni" },
  { value: "7", label: "Juli" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "Oktober" },
  { value: "11", label: "November" },
  { value: "12", label: "Desember" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

interface PayslipData {
  employee: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    commissionType: string | null;
    commissionRate: string | null;
  };
  period: {
    month: number;
    year: number;
    startDate: string;
    endDate: string;
  };
  earnings: {
    baseSalary: number;
    serviceCommission: number;
    productCommission: number;
    tips: number;
    bonus: number;
    totalEarnings: number;
  };
  deductions: {
    tax: number;
    insurance: number;
    pension: number;
    unpaidLeave: number;
    other: number;
    totalDeductions: number;
  };
  leaves: {
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    sickLeaveDays: number;
  };
  performance: {
    appointmentsCompleted: number;
    totalServiceRevenue: number;
    totalProductRevenue: number;
  };
  netSalary: number;
}

export default function Payroll() {
  const [selectedMonth] = useState(String(new Date().getMonth() + 1));
  const [selectedYear] = useState(String(currentYear));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [showPayslipDialog, setShowPayslipDialog] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Fetch monthly payroll data
  const { data: payrollData, isLoading: isLoadingPayroll } = trpc.payroll.getMonthlyPayroll.useQuery({
    month: parseInt(selectedMonth),
    year: parseInt(selectedYear),
  });

  // Fetch individual payslip when employee is selected
  const { data: payslipData, isLoading: isLoadingPayslip } = trpc.payroll.getEmployeePayslip.useQuery(
    {
      employeeId: selectedEmployeeId!,
      month: parseInt(selectedMonth),
      year: parseInt(selectedYear),
    },
    { enabled: !!selectedEmployeeId }
  );

  // Calculate totals
  const totals = useMemo(() => {
    if (!payrollData) return { totalEarnings: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0 };
    
    return payrollData.reduce(
      (acc, emp) => ({
        totalEarnings: acc.totalEarnings + emp.totalEarnings,
        totalDeductions: acc.totalDeductions + emp.totalDeductions,
        totalNet: acc.totalNet + emp.netSalary,
        employeeCount: acc.employeeCount + 1,
      }),
      { totalEarnings: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0 }
    );
  }, [payrollData]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const handleViewPayslip = (employeeId: number) => {
    setSelectedEmployeeId(employeeId);
    setShowPayslipDialog(true);
  };

  const generatePayslipPdf = async () => {
    if (!payslipData) return;
    
    setIsGeneratingPdf(true);
    
    try {
      // Generate PDF content
      const pdfContent = generatePayslipHtml(payslipData);
      
      // Create a new window for printing
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(pdfContent);
        printWindow.document.close();
        printWindow.focus();
        
        // Wait for content to load then print
        setTimeout(() => {
          printWindow.print();
        }, 500);
      }
      
      toast.success("Lønnsslipp generert for utskrift");
    } catch (error) {
      toast.error("Kunne ikke generere lønnsslipp");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const generatePayslipHtml = (data: PayslipData) => {
    const monthName = MONTHS.find(m => m.value === String(data.period.month))?.label || "";
    
    return `
      <!DOCTYPE html>
      <html lang="no">
      <head>
        <meta charset="UTF-8">
        <title>Lønnsslipp - ${data.employee.name} - ${monthName} ${data.period.year}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 40px; 
            color: #1a1a1a;
            background: #fff;
          }
          .payslip { max-width: 800px; margin: 0 auto; }
          .header { 
            display: flex; 
            justify-content: space-between; 
            align-items: flex-start;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .company-info h1 { 
            font-size: 28px; 
            color: #2563eb;
            margin-bottom: 5px;
          }
          .company-info p { color: #666; font-size: 14px; }
          .payslip-title {
            text-align: right;
          }
          .payslip-title h2 { 
            font-size: 24px; 
            color: #1a1a1a;
            margin-bottom: 5px;
          }
          .payslip-title p { color: #666; font-size: 14px; }
          .employee-info {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
          }
          .employee-info h3 {
            font-size: 18px;
            margin-bottom: 15px;
            color: #1a1a1a;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
          }
          .info-item label {
            font-size: 12px;
            color: #666;
            display: block;
            margin-bottom: 2px;
          }
          .info-item span {
            font-size: 14px;
            font-weight: 500;
          }
          .section {
            margin-bottom: 25px;
          }
          .section h3 {
            font-size: 16px;
            color: #2563eb;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e2e8f0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
          }
          th {
            background: #f8fafc;
            font-weight: 600;
            font-size: 13px;
            color: #666;
          }
          td { font-size: 14px; }
          .amount { text-align: right; font-family: monospace; }
          .total-row {
            background: #f0f9ff;
            font-weight: 600;
          }
          .total-row td { border-top: 2px solid #2563eb; }
          .net-salary {
            background: #2563eb;
            color: white;
            padding: 20px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 30px;
          }
          .net-salary h3 { font-size: 18px; }
          .net-salary .amount { font-size: 28px; font-weight: bold; }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            font-size: 12px;
            color: #666;
            text-align: center;
          }
          .leave-summary {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-bottom: 20px;
          }
          .leave-item {
            background: #f8fafc;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
          }
          .leave-item .value {
            font-size: 24px;
            font-weight: bold;
            color: #2563eb;
          }
          .leave-item .label {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
          }
          @media print {
            body { padding: 20px; }
            .payslip { max-width: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="payslip">
          <div class="header">
            <div class="company-info">
              <h1>Stylora</h1>
              <p>Profesjonell Salongstyring</p>
            </div>
            <div class="payslip-title">
              <h2>LØNNSSLIPP</h2>
              <p>${monthName} ${data.period.year}</p>
            </div>
          </div>
          
          <div class="employee-info">
            <h3>Ansattinformasjon</h3>
            <div class="info-grid">
              <div class="info-item">
                <label>Navn</label>
                <span>${data.employee.name}</span>
              </div>
              <div class="info-item">
                <label>E-post</label>
                <span>${data.employee.email || "-"}</span>
              </div>
              <div class="info-item">
                <label>Stilling</label>
                <span>${data.employee.role === "employee" ? "Ansatt" : data.employee.role === "admin" ? "Administrator" : "Eier"}</span>
              </div>
              <div class="info-item">
                <label>Provisjonstype</label>
                <span>${data.employee.commissionType === "percentage" ? "Prosent" : data.employee.commissionType === "fixed" ? "Fast" : "-"} ${data.employee.commissionRate ? `(${data.employee.commissionRate}%)` : ""}</span>
              </div>
              <div class="info-item">
                <label>Periode</label>
                <span>${data.period.startDate} - ${data.period.endDate}</span>
              </div>
              <div class="info-item">
                <label>Fullførte avtaler</label>
                <span>${data.performance.appointmentsCompleted}</span>
              </div>
            </div>
          </div>

          <div class="section">
            <h3>Ferieoversikt</h3>
            <div class="leave-summary">
              <div class="leave-item">
                <div class="value">${data.leaves.paidLeaveDays}</div>
                <div class="label">Betalte feriedager</div>
              </div>
              <div class="leave-item">
                <div class="value">${data.leaves.unpaidLeaveDays}</div>
                <div class="label">Ubetalte feriedager</div>
              </div>
              <div class="leave-item">
                <div class="value">${data.leaves.sickLeaveDays}</div>
                <div class="label">Sykedager</div>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h3>Inntekter</h3>
            <table>
              <thead>
                <tr>
                  <th>Beskrivelse</th>
                  <th class="amount">Beløp</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Grunnlønn</td>
                  <td class="amount">${formatCurrency(data.earnings.baseSalary)}</td>
                </tr>
                <tr>
                  <td>Tjenesteprovisjon (${data.employee.commissionRate || 0}%)</td>
                  <td class="amount">${formatCurrency(data.earnings.serviceCommission)}</td>
                </tr>
                <tr>
                  <td>Produktprovisjon</td>
                  <td class="amount">${formatCurrency(data.earnings.productCommission)}</td>
                </tr>
                <tr>
                  <td>Tips</td>
                  <td class="amount">${formatCurrency(data.earnings.tips)}</td>
                </tr>
                <tr>
                  <td>Bonus</td>
                  <td class="amount">${formatCurrency(data.earnings.bonus)}</td>
                </tr>
                <tr class="total-row">
                  <td>Totale inntekter</td>
                  <td class="amount">${formatCurrency(data.earnings.totalEarnings)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h3>Fradrag</h3>
            <table>
              <thead>
                <tr>
                  <th>Beskrivelse</th>
                  <th class="amount">Beløp</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Skatt (30%)</td>
                  <td class="amount">${formatCurrency(data.deductions.tax)}</td>
                </tr>
                <tr>
                  <td>Forsikring</td>
                  <td class="amount">${formatCurrency(data.deductions.insurance)}</td>
                </tr>
                <tr>
                  <td>Pensjon (2%)</td>
                  <td class="amount">${formatCurrency(data.deductions.pension)}</td>
                </tr>
                <tr>
                  <td>Ubetalt ferie (${data.leaves.unpaidLeaveDays} dager)</td>
                  <td class="amount">${formatCurrency(data.deductions.unpaidLeave)}</td>
                </tr>
                <tr>
                  <td>Andre fradrag</td>
                  <td class="amount">${formatCurrency(data.deductions.other)}</td>
                </tr>
                <tr class="total-row">
                  <td>Totale fradrag</td>
                  <td class="amount">${formatCurrency(data.deductions.totalDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="net-salary">
            <h3>Netto lønn</h3>
            <div class="amount">${formatCurrency(data.netSalary)}</div>
          </div>
          
          <div class="footer">
            <p>Dette dokumentet er automatisk generert av Stylora lønnssystem.</p>
            <p>Generert: ${new Date().toLocaleDateString("nb-NO")} kl. ${new Date().toLocaleTimeString("nb-NO")}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Lønnsadministrasjon</h1>
            <p className="text-muted-foreground">
              Administrer lønn, provisjoner og generer lønnsslipp for ansatte
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedMonth} disabled>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Måned" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedYear} disabled>
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="År" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((year) => (
                  <SelectItem key={year.value} value={year.value}>
                    {year.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Totale inntekter</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totals.totalEarnings)}</div>
              <p className="text-xs text-muted-foreground">
                For {totals.employeeCount} ansatte
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Totale fradrag</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{formatCurrency(totals.totalDeductions)}</div>
              <p className="text-xs text-muted-foreground">
                Skatt, forsikring, pensjon
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Netto utbetaling</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(totals.totalNet)}</div>
              <p className="text-xs text-muted-foreground">
                Total til utbetaling
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ansatte</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totals.employeeCount}</div>
              <p className="text-xs text-muted-foreground">
                Aktive denne måneden
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Payroll Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Lønnsoversikt - {MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}
            </CardTitle>
            <CardDescription>
              Klikk på en ansatt for å se detaljert lønnsslipp og generere PDF
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPayroll ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : payrollData && payrollData.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ansatt</TableHead>
                    <TableHead>Stilling</TableHead>
                    <TableHead className="text-right">Avtaler</TableHead>
                    <TableHead className="text-right">Inntekter</TableHead>
                    <TableHead className="text-right">Fradrag</TableHead>
                    <TableHead className="text-right">Ferie</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                    <TableHead className="text-right">Handling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollData.map((employee) => (
                    <TableRow key={employee.employeeId} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">{employee.employeeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {employee.role === "employee" ? "Ansatt" : employee.role === "admin" ? "Admin" : "Eier"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{employee.appointmentsCompleted}</TableCell>
                      <TableCell className="text-right">{formatCurrency(employee.totalEarnings)}</TableCell>
                      <TableCell className="text-right text-orange-600">{formatCurrency(employee.totalDeductions)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Plane className="h-3 w-3 text-muted-foreground" />
                          <span>{employee.leaveDays}d</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {formatCurrency(employee.netSalary)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewPayslip(employee.employeeId)}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Lønnsslipp
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">Ingen lønnsdata</h3>
                <p className="text-muted-foreground">
                  Det er ingen lønnsdata for denne perioden
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payslip Dialog */}
        <Dialog open={showPayslipDialog} onOpenChange={setShowPayslipDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Lønnsslipp
              </DialogTitle>
              <DialogDescription>
                {payslipData && (
                  <>
                    {payslipData.employee.name} - {MONTHS.find(m => m.value === String(payslipData.period.month))?.label} {payslipData.period.year}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {isLoadingPayslip ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : payslipData ? (
              <div className="space-y-6">
                {/* Employee Info */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Navn</p>
                    <p className="font-medium">{payslipData.employee.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">E-post</p>
                    <p className="font-medium">{payslipData.employee.email || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Stilling</p>
                    <p className="font-medium">
                      {payslipData.employee.role === "employee" ? "Ansatt" : payslipData.employee.role === "admin" ? "Administrator" : "Eier"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Provisjon</p>
                    <p className="font-medium">{payslipData.employee.commissionRate || 0}%</p>
                  </div>
                </div>

                {/* Leave Summary */}
                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Plane className="h-4 w-4" />
                    Ferieoversikt
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{payslipData.leaves.paidLeaveDays}</p>
                      <p className="text-xs text-muted-foreground">Betalte dager</p>
                    </div>
                    <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg text-center">
                      <p className="text-2xl font-bold text-orange-600">{payslipData.leaves.unpaidLeaveDays}</p>
                      <p className="text-xs text-muted-foreground">Ubetalte dager</p>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-600">{payslipData.leaves.sickLeaveDays}</p>
                      <p className="text-xs text-muted-foreground">Sykedager</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Earnings */}
                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Inntekter
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grunnlønn</span>
                      <span>{formatCurrency(payslipData.earnings.baseSalary)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tjenesteprovisjon</span>
                      <span>{formatCurrency(payslipData.earnings.serviceCommission)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Produktprovisjon</span>
                      <span>{formatCurrency(payslipData.earnings.productCommission)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tips</span>
                      <span>{formatCurrency(payslipData.earnings.tips)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bonus</span>
                      <span>{formatCurrency(payslipData.earnings.bonus)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Totale inntekter</span>
                      <span>{formatCurrency(payslipData.earnings.totalEarnings)}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Deductions */}
                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Fradrag
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Skatt (30%)</span>
                      <span className="text-orange-600">{formatCurrency(payslipData.deductions.tax)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Forsikring</span>
                      <span className="text-orange-600">{formatCurrency(payslipData.deductions.insurance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pensjon (2%)</span>
                      <span className="text-orange-600">{formatCurrency(payslipData.deductions.pension)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ubetalt ferie</span>
                      <span className="text-orange-600">{formatCurrency(payslipData.deductions.unpaidLeave)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Totale fradrag</span>
                      <span className="text-orange-600">{formatCurrency(payslipData.deductions.totalDeductions)}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Net Salary */}
                <div className="p-4 bg-primary text-primary-foreground rounded-lg">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-semibold">Netto lønn</span>
                    </div>
                    <span className="text-2xl font-bold">{formatCurrency(payslipData.netSalary)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setShowPayslipDialog(false)}>
                    Lukk
                  </Button>
                  <Button onClick={generatePayslipPdf} disabled={isGeneratingPdf}>
                    {isGeneratingPdf ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Last ned PDF
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
