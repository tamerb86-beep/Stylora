import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { 
  CheckCircle2, Building2, User, Clock, Users, Scissors, CreditCard, FileCheck,
  Plus, Trash2, Edit2, Check, X
} from "lucide-react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

// Step 1: Salon Information
const salonInfoSchema = z.object({
  salonName: z.string().min(2, "اسم الصالون مطلوب"),
  subdomain: z.string().min(3, "النطاق الفرعي مطلوب").regex(/^[a-z0-9-]+$/, "حروف صغيرة وأرقام فقط"),
  address: z.string().min(5, "العنوان مطلوب"),
  city: z.string().min(2, "المدينة مطلوبة"),
  phone: z.string().min(8, "رقم الهاتف مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح"),
});

// Step 2: Owner Account
const ownerAccountSchema = z.object({
  ownerName: z.string().min(2, "الاسم مطلوب"),
  ownerEmail: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "كلمات المرور غير متطابقة",
  path: ["confirmPassword"],
});

// Step 3: Business Hours
const businessHoursSchema = z.object({
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
});

// Employee type
type Employee = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "employee" | "manager" | "admin";
  permissions: {
    viewAppointments: boolean;
    manageCustomers: boolean;
    accessReports: boolean;
  };
};

// Service type
type Service = {
  id: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  description: string;
  color: string;
};

type OnboardingData = {
  salonInfo: z.infer<typeof salonInfoSchema>;
  ownerAccount: z.infer<typeof ownerAccountSchema>;
  businessHours: z.infer<typeof businessHoursSchema>;
  employees: Employee[];
  services: Service[];
  paymentSettings: { stripeEnabled: boolean; vippsEnabled: boolean };
};

const steps = [
  { id: 1, name: "معلومات الصالون", icon: Building2 },
  { id: 2, name: "حساب المالك", icon: User },
  { id: 3, name: "ساعات العمل", icon: Clock },
  { id: 4, name: "الموظفين", icon: Users },
  { id: 5, name: "الخدمات", icon: Scissors },
  { id: 6, name: "إعدادات الدفع", icon: CreditCard },
  { id: 7, name: "المراجعة", icon: FileCheck },
];

const serviceColors = [
  { value: "#667eea", label: "بنفسجي" },
  { value: "#f56565", label: "أحمر" },
  { value: "#48bb78", label: "أخضر" },
  { value: "#ed8936", label: "برتقالي" },
  { value: "#4299e1", label: "أزرق" },
  { value: "#9f7aea", label: "أرجواني" },
  { value: "#ed64a6", label: "وردي" },
  { value: "#38b2ac", label: "تركواز" },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(1);
  const [onboardingData, setOnboardingData] = useState<Partial<OnboardingData>>({
    employees: [],
    services: [],
    paymentSettings: { stripeEnabled: false, vippsEnabled: false },
  });
  const [, setLocation] = useLocation();
  
  // Employee form state
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    name: "",
    email: "",
    phone: "",
    role: "employee",
    permissions: {
      viewAppointments: true,
      manageCustomers: false,
      accessReports: false,
    },
  });
  
  // Service form state
  const [newService, setNewService] = useState<Partial<Service>>({
    name: "",
    category: "خدمات عامة",
    duration: 30,
    price: 250,
    description: "",
    color: "#667eea",
  });
  
  const [serviceCategories, setServiceCategories] = useState<string[]>(["خدمات عامة"]);
  const [newCategory, setNewCategory] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const progress = (currentStep / steps.length) * 100;

  // Step 1: Salon Info Form
  const salonInfoForm = useForm<z.infer<typeof salonInfoSchema>>({
    resolver: zodResolver(salonInfoSchema),
    defaultValues: onboardingData.salonInfo,
  });

  // Step 2: Owner Account Form
  const ownerAccountForm = useForm<z.infer<typeof ownerAccountSchema>>({
    resolver: zodResolver(ownerAccountSchema),
    defaultValues: onboardingData.ownerAccount,
  });

  // Step 3: Business Hours Form
  const businessHoursForm = useForm<z.infer<typeof businessHoursSchema>>({
    resolver: zodResolver(businessHoursSchema),
    defaultValues: onboardingData.businessHours || {
      mondayOpen: "09:00",
      mondayClose: "18:00",
      tuesdayOpen: "09:00",
      tuesdayClose: "18:00",
      wednesdayOpen: "09:00",
      wednesdayClose: "18:00",
      thursdayOpen: "09:00",
      thursdayClose: "18:00",
      fridayOpen: "09:00",
      fridayClose: "18:00",
      saturdayOpen: "10:00",
      saturdayClose: "16:00",
      sundayClosed: true,
    },
  });

  const completeOnboarding = trpc.onboarding.complete.useMutation({
    onSuccess: (data) => {
      toast.success("تم إنشاء حسابك بنجاح! 🎉");
      toast.info("تم إرسال بريد إلكتروني ترحيبي إلى " + data.email);
      setTimeout(() => {
        setLocation("/login");
      }, 2000);
    },
    onError: (error) => {
      toast.error("حدث خطأ: " + error.message);
    },
  });

  // Employee functions
  const addEmployee = () => {
    if (!newEmployee.name || !newEmployee.email) {
      toast.error("الاسم والبريد الإلكتروني مطلوبان");
      return;
    }
    
    if (onboardingData.employees && onboardingData.employees.length >= 10) {
      toast.error("الحد الأقصى 10 موظفين");
      return;
    }

    const employee: Employee = {
      id: Math.random().toString(36).substr(2, 9),
      name: newEmployee.name!,
      email: newEmployee.email!,
      phone: newEmployee.phone || "",
      role: newEmployee.role || "employee",
      permissions: newEmployee.permissions || {
        viewAppointments: true,
        manageCustomers: false,
        accessReports: false,
      },
    };

    setOnboardingData((prev) => ({
      ...prev,
      employees: [...(prev.employees || []), employee],
    }));

    setNewEmployee({
      name: "",
      email: "",
      phone: "",
      role: "employee",
      permissions: {
        viewAppointments: true,
        manageCustomers: false,
        accessReports: false,
      },
    });

    toast.success("تم إضافة الموظف");
  };

  const removeEmployee = (id: string) => {
    setOnboardingData((prev) => ({
      ...prev,
      employees: prev.employees?.filter((e) => e.id !== id),
    }));
    toast.success("تم حذف الموظف");
  };

  // Service functions
  const addService = () => {
    if (!newService.name) {
      toast.error("اسم الخدمة مطلوب");
      return;
    }
    
    if (onboardingData.services && onboardingData.services.length >= 20) {
      toast.error("الحد الأقصى 20 خدمة");
      return;
    }

    const service: Service = {
      id: Math.random().toString(36).substr(2, 9),
      name: newService.name!,
      category: newService.category || "خدمات عامة",
      duration: newService.duration || 30,
      price: newService.price || 250,
      description: newService.description || "",
      color: newService.color || "#667eea",
    };

    setOnboardingData((prev) => ({
      ...prev,
      services: [...(prev.services || []), service],
    }));

    setNewService({
      name: "",
      category: "خدمات عامة",
      duration: 30,
      price: 250,
      description: "",
      color: "#667eea",
    });

    toast.success("تم إضافة الخدمة");
  };

  const removeService = (id: string) => {
    setOnboardingData((prev) => ({
      ...prev,
      services: prev.services?.filter((s) => s.id !== id),
    }));
    toast.success("تم حذف الخدمة");
  };

  const addCategory = () => {
    if (!newCategory.trim()) {
      toast.error("اسم الفئة مطلوب");
      return;
    }
    
    if (serviceCategories.includes(newCategory.trim())) {
      toast.error("الفئة موجودة بالفعل");
      return;
    }

    setServiceCategories([...serviceCategories, newCategory.trim()]);
    setNewService({ ...newService, category: newCategory.trim() });
    setNewCategory("");
    toast.success("تم إضافة الفئة");
  };

  const handleNext = () => {
    if (currentStep === 1) {
      salonInfoForm.handleSubmit((data) => {
        setOnboardingData((prev) => ({ ...prev, salonInfo: data }));
        setCurrentStep(2);
      })();
    } else if (currentStep === 2) {
      ownerAccountForm.handleSubmit((data) => {
        setOnboardingData((prev) => ({ ...prev, ownerAccount: data }));
        setCurrentStep(3);
      })();
    } else if (currentStep === 3) {
      businessHoursForm.handleSubmit((data) => {
        setOnboardingData((prev) => ({ ...prev, businessHours: data }));
        setCurrentStep(4);
      })();
    } else if (currentStep === 4) {
      // Employees step - optional, can skip
      if (!onboardingData.employees || onboardingData.employees.length === 0) {
        toast.info("يمكنك إضافة الموظفين لاحقاً من لوحة التحكم");
      }
      setCurrentStep(5);
    } else if (currentStep === 5) {
      // Services step - at least one service required
      if (!onboardingData.services || onboardingData.services.length === 0) {
        toast.error("يجب إضافة خدمة واحدة على الأقل");
        return;
      }
      setCurrentStep(6);
    } else if (currentStep === 6) {
      // Payment settings - optional
      setCurrentStep(7);
    } else if (currentStep === 7) {
      // Final review - submit
      if (!acceptedTerms) {
        toast.error("يجب الموافقة على الشروط والأحكام");
        return;
      }
      completeOnboarding.mutate(onboardingData as OnboardingData);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const goToStep = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-orange-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-orange-500 bg-clip-text text-transparent mb-2">
            مرحباً في Stylora
          </h1>
          <p className="text-gray-600">دعنا نساعدك في إعداد صالونك في دقائق</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-4">
            {steps.map((step) => {
              const Icon = step.icon;
              const isCompleted = step.id < currentStep;
              const isCurrent = step.id === currentStep;
              
              return (
                <div 
                  key={step.id} 
                  className="flex flex-col items-center cursor-pointer"
                  onClick={() => goToStep(step.id)}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isCurrent
                        ? "bg-gradient-to-r from-purple-600 to-orange-500 text-white"
                        : "bg-gray-200 text-gray-400"
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span className={`text-xs hidden md:block ${isCurrent ? "font-semibold" : ""}`}>
                    {step.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{steps[currentStep - 1].name}</CardTitle>
            <CardDescription>
              {currentStep === 1 && "أدخل معلومات الصالون الأساسية"}
              {currentStep === 2 && "أنشئ حساب المالك/المدير"}
              {currentStep === 3 && "حدد ساعات عمل الصالون"}
              {currentStep === 4 && "أضف الموظفين مع أدوارهم وصلاحياتهم (اختياري)"}
              {currentStep === 5 && "أنشئ الخدمات التي يقدمها صالونك"}
              {currentStep === 6 && "قم بإعداد طرق الدفع (اختياري)"}
              {currentStep === 7 && "راجع المعلومات وأكمل التسجيل"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Step 1: Salon Information */}
            {currentStep === 1 && (
              <form className="space-y-4">
                <div>
                  <Label htmlFor="salonName">اسم الصالون *</Label>
                  <Input
                    id="salonName"
                    {...salonInfoForm.register("salonName")}
                    placeholder="صالون الجمال الملكي"
                  />
                  {salonInfoForm.formState.errors.salonName && (
                    <p className="text-sm text-red-500 mt-1">
                      {salonInfoForm.formState.errors.salonName.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="subdomain">النطاق الفرعي *</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="subdomain"
                      {...salonInfoForm.register("subdomain")}
                      placeholder="royal-salon"
                      className="flex-1"
                    />
                    <span className="text-sm text-gray-500">.stylora.no</span>
                  </div>
                  {salonInfoForm.formState.errors.subdomain && (
                    <p className="text-sm text-red-500 mt-1">
                      {salonInfoForm.formState.errors.subdomain.message}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    سيكون رابط صالونك: royal-salon.stylora.no
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="address">العنوان *</Label>
                    <Input
                      id="address"
                      {...salonInfoForm.register("address")}
                      placeholder="شارع الملك فهد"
                    />
                    {salonInfoForm.formState.errors.address && (
                      <p className="text-sm text-red-500 mt-1">
                        {salonInfoForm.formState.errors.address.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="city">المدينة *</Label>
                    <Input
                      id="city"
                      {...salonInfoForm.register("city")}
                      placeholder="أوسلو"
                    />
                    {salonInfoForm.formState.errors.city && (
                      <p className="text-sm text-red-500 mt-1">
                        {salonInfoForm.formState.errors.city.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="phone">رقم الهاتف *</Label>
                    <Input
                      id="phone"
                      {...salonInfoForm.register("phone")}
                      placeholder="+47 123 45 678"
                    />
                    {salonInfoForm.formState.errors.phone && (
                      <p className="text-sm text-red-500 mt-1">
                        {salonInfoForm.formState.errors.phone.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="email">البريد الإلكتروني *</Label>
                    <Input
                      id="email"
                      type="email"
                      {...salonInfoForm.register("email")}
                      placeholder="info@salon.no"
                    />
                    {salonInfoForm.formState.errors.email && (
                      <p className="text-sm text-red-500 mt-1">
                        {salonInfoForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                </div>
              </form>
            )}

            {/* Step 2: Owner Account */}
            {currentStep === 2 && (
              <form className="space-y-4">
                <div>
                  <Label htmlFor="ownerName">الاسم الكامل *</Label>
                  <Input
                    id="ownerName"
                    {...ownerAccountForm.register("ownerName")}
                    placeholder="أحمد محمد"
                  />
                  {ownerAccountForm.formState.errors.ownerName && (
                    <p className="text-sm text-red-500 mt-1">
                      {ownerAccountForm.formState.errors.ownerName.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="ownerEmail">البريد الإلكتروني *</Label>
                  <Input
                    id="ownerEmail"
                    type="email"
                    {...ownerAccountForm.register("ownerEmail")}
                    placeholder="ahmed@example.com"
                  />
                  {ownerAccountForm.formState.errors.ownerEmail && (
                    <p className="text-sm text-red-500 mt-1">
                      {ownerAccountForm.formState.errors.ownerEmail.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="password">كلمة المرور *</Label>
                  <Input
                    id="password"
                    type="password"
                    {...ownerAccountForm.register("password")}
                    placeholder="••••••••"
                  />
                  {ownerAccountForm.formState.errors.password && (
                    <p className="text-sm text-red-500 mt-1">
                      {ownerAccountForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="confirmPassword">تأكيد كلمة المرور *</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    {...ownerAccountForm.register("confirmPassword")}
                    placeholder="••••••••"
                  />
                  {ownerAccountForm.formState.errors.confirmPassword && (
                    <p className="text-sm text-red-500 mt-1">
                      {ownerAccountForm.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>
              </form>
            )}

            {/* Step 3: Business Hours */}
            {currentStep === 3 && (
              <form className="space-y-4">
                <p className="text-sm text-gray-600 mb-4">
                  حدد ساعات عمل الصالون لكل يوم من أيام الأسبوع
                </p>

                {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => {
                  const dayNames: Record<string, string> = {
                    monday: "الاثنين",
                    tuesday: "الثلاثاء",
                    wednesday: "الأربعاء",
                    thursday: "الخميس",
                    friday: "الجمعة",
                    saturday: "السبت",
                  };

                  return (
                    <div key={day} className="grid grid-cols-3 gap-4 items-center">
                      <Label>{dayNames[day]}</Label>
                      <div>
                        <Input
                          type="time"
                          {...businessHoursForm.register(`${day}Open` as any)}
                        />
                      </div>
                      <div>
                        <Input
                          type="time"
                          {...businessHoursForm.register(`${day}Close` as any)}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center gap-2 pt-4 border-t">
                  <input
                    type="checkbox"
                    id="sundayClosed"
                    {...businessHoursForm.register("sundayClosed")}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="sundayClosed">الأحد مغلق</Label>
                </div>
              </form>
            )}

            {/* Step 4: Employees */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    💡 يمكنك إضافة الموظفين الآن أو تخطي هذه الخطوة وإضافتهم لاحقاً من لوحة التحكم
                  </p>
                </div>

                {/* Add Employee Form */}
                <div className="border rounded-lg p-4 space-y-4">
                  <h3 className="font-semibold text-lg">إضافة موظف جديد</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>الاسم *</Label>
                      <Input
                        value={newEmployee.name}
                        onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                        placeholder="محمد أحمد"
                      />
                    </div>
                    <div>
                      <Label>البريد الإلكتروني *</Label>
                      <Input
                        type="email"
                        value={newEmployee.email}
                        onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                        placeholder="mohammed@example.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>رقم الهاتف</Label>
                      <Input
                        value={newEmployee.phone}
                        onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                        placeholder="+47 123 45 678"
                      />
                    </div>
                    <div>
                      <Label>الدور الوظيفي</Label>
                      <Select
                        value={newEmployee.role}
                        onValueChange={(value: any) => setNewEmployee({ ...newEmployee, role: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">موظف</SelectItem>
                          <SelectItem value="manager">مدير</SelectItem>
                          <SelectItem value="admin">مسؤول</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">الصلاحيات</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="viewAppointments"
                          checked={newEmployee.permissions?.viewAppointments}
                          onCheckedChange={(checked) =>
                            setNewEmployee({
                              ...newEmployee,
                              permissions: { ...newEmployee.permissions!, viewAppointments: !!checked },
                            })
                          }
                        />
                        <Label htmlFor="viewAppointments" className="font-normal">
                          عرض المواعيد
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="manageCustomers"
                          checked={newEmployee.permissions?.manageCustomers}
                          onCheckedChange={(checked) =>
                            setNewEmployee({
                              ...newEmployee,
                              permissions: { ...newEmployee.permissions!, manageCustomers: !!checked },
                            })
                          }
                        />
                        <Label htmlFor="manageCustomers" className="font-normal">
                          إدارة العملاء
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="accessReports"
                          checked={newEmployee.permissions?.accessReports}
                          onCheckedChange={(checked) =>
                            setNewEmployee({
                              ...newEmployee,
                              permissions: { ...newEmployee.permissions!, accessReports: !!checked },
                            })
                          }
                        />
                        <Label htmlFor="accessReports" className="font-normal">
                          الوصول إلى التقارير
                        </Label>
                      </div>
                    </div>
                  </div>

                  <Button onClick={addEmployee} className="w-full">
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة موظف
                  </Button>
                </div>

                {/* Employees List */}
                {onboardingData.employees && onboardingData.employees.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">
                      الموظفون ({onboardingData.employees.length}/10)
                    </h3>
                    {onboardingData.employees.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{emp.name}</p>
                          <p className="text-sm text-gray-600">{emp.email}</p>
                          <p className="text-xs text-gray-500">
                            {emp.role === "employee" && "موظف"}
                            {emp.role === "manager" && "مدير"}
                            {emp.role === "admin" && "مسؤول"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEmployee(emp.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 5: Services */}
            {currentStep === 5 && (
              <div className="space-y-6">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    ⚠️ يجب إضافة خدمة واحدة على الأقل للمتابعة
                  </p>
                </div>

                {/* Add Category */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold">إضافة فئة جديدة</h3>
                  <div className="flex gap-2">
                    <Input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="مثال: قص شعر، حلاقة، صبغات"
                      className="flex-1"
                    />
                    <Button onClick={addCategory}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {serviceCategories.map((cat) => (
                      <span
                        key={cat}
                        className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Add Service Form */}
                <div className="border rounded-lg p-4 space-y-4">
                  <h3 className="font-semibold text-lg">إضافة خدمة جديدة</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>اسم الخدمة *</Label>
                      <Input
                        value={newService.name}
                        onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                        placeholder="قص شعر رجالي"
                      />
                    </div>
                    <div>
                      <Label>الفئة</Label>
                      <Select
                        value={newService.category}
                        onValueChange={(value) => setNewService({ ...newService, category: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {serviceCategories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>المدة (دقيقة)</Label>
                      <Input
                        type="number"
                        value={newService.duration}
                        onChange={(e) => setNewService({ ...newService, duration: parseInt(e.target.value) })}
                        min="5"
                        step="5"
                      />
                    </div>
                    <div>
                      <Label>السعر (NOK)</Label>
                      <Input
                        type="number"
                        value={newService.price}
                        onChange={(e) => setNewService({ ...newService, price: parseInt(e.target.value) })}
                        min="0"
                        step="10"
                      />
                    </div>
                    <div>
                      <Label>اللون</Label>
                      <Select
                        value={newService.color}
                        onValueChange={(value) => setNewService({ ...newService, color: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {serviceColors.map((color) => (
                            <SelectItem key={color.value} value={color.value}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-4 h-4 rounded"
                                  style={{ backgroundColor: color.value }}
                                />
                                {color.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>الوصف (اختياري)</Label>
                    <Textarea
                      value={newService.description}
                      onChange={(e) => setNewService({ ...newService, description: e.target.value })}
                      placeholder="وصف مختصر للخدمة"
                      rows={2}
                    />
                  </div>

                  <Button onClick={addService} className="w-full">
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة خدمة
                  </Button>
                </div>

                {/* Services List */}
                {onboardingData.services && onboardingData.services.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">
                      الخدمات ({onboardingData.services.length}/20)
                    </h3>
                    {onboardingData.services.map((svc) => (
                      <div
                        key={svc.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: svc.color }}
                          />
                          <div>
                            <p className="font-medium">{svc.name}</p>
                            <p className="text-sm text-gray-600">
                              {svc.category} • {svc.duration} دقيقة • {svc.price} NOK
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeService(svc.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 6: Payment Settings */}
            {currentStep === 6 && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    💡 يمكنك إعداد طرق الدفع الآن أو تخطي هذه الخطوة وإعدادها لاحقاً
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Stripe */}
                  <div className="border rounded-lg p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">Stripe</h3>
                        <p className="text-sm text-gray-600">
                          قبول المدفوعات عبر البطاقات الائتمانية
                        </p>
                      </div>
                      <Checkbox
                        checked={onboardingData.paymentSettings?.stripeEnabled}
                        onCheckedChange={(checked) =>
                          setOnboardingData({
                            ...onboardingData,
                            paymentSettings: {
                              ...onboardingData.paymentSettings!,
                              stripeEnabled: !!checked,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      <p>✓ Visa, Mastercard, Amex</p>
                      <p>✓ رسوم: 2.9% + 2 NOK لكل معاملة</p>
                      <p>✓ تحويل فوري إلى حسابك</p>
                    </div>
                  </div>

                  {/* Vipps */}
                  <div className="border rounded-lg p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">Vipps</h3>
                        <p className="text-sm text-gray-600">
                          طريقة الدفع الأكثر شعبية في النرويج
                        </p>
                      </div>
                      <Checkbox
                        checked={onboardingData.paymentSettings?.vippsEnabled}
                        onCheckedChange={(checked) =>
                          setOnboardingData({
                            ...onboardingData,
                            paymentSettings: {
                              ...onboardingData.paymentSettings!,
                              vippsEnabled: !!checked,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      <p>✓ دفع سريع عبر الموبايل</p>
                      <p>✓ رسوم: 1% + 1 NOK لكل معاملة</p>
                      <p>✓ موثوق من 4 مليون نرويجي</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    📝 <strong>ملاحظة:</strong> سيتم توجيهك لإكمال إعداد الحساب مع مزود الدفع
                    بعد التسجيل من لوحة التحكم.
                  </p>
                </div>
              </div>
            )}

            {/* Step 7: Final Review */}
            {currentStep === 7 && (
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    ✅ تقريباً انتهينا! راجع المعلومات أدناه قبل إكمال التسجيل
                  </p>
                </div>

                {/* Salon Info Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">معلومات الصالون</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><strong>الاسم:</strong> {onboardingData.salonInfo?.salonName}</p>
                    <p><strong>النطاق:</strong> {onboardingData.salonInfo?.subdomain}.stylora.no</p>
                    <p><strong>العنوان:</strong> {onboardingData.salonInfo?.address}, {onboardingData.salonInfo?.city}</p>
                    <p><strong>الهاتف:</strong> {onboardingData.salonInfo?.phone}</p>
                    <p><strong>البريد:</strong> {onboardingData.salonInfo?.email}</p>
                  </div>
                </div>

                {/* Owner Account Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">حساب المالك</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(2)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><strong>الاسم:</strong> {onboardingData.ownerAccount?.ownerName}</p>
                    <p><strong>البريد:</strong> {onboardingData.ownerAccount?.ownerEmail}</p>
                    <p><strong>كلمة المرور:</strong> ••••••••</p>
                  </div>
                </div>

                {/* Business Hours Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">ساعات العمل</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(3)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-sm">
                    <p>الاثنين - الجمعة: 09:00 - 18:00</p>
                    <p>السبت: 10:00 - 16:00</p>
                    <p>الأحد: مغلق</p>
                  </div>
                </div>

                {/* Employees Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">الموظفون</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(4)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm">
                    {onboardingData.employees && onboardingData.employees.length > 0
                      ? `${onboardingData.employees.length} موظف`
                      : "لم يتم إضافة موظفين"}
                  </p>
                </div>

                {/* Services Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">الخدمات</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(5)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm">
                    {onboardingData.services?.length || 0} خدمة
                  </p>
                </div>

                {/* Payment Settings Summary */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">طرق الدفع</h3>
                    <Button variant="ghost" size="sm" onClick={() => setCurrentStep(6)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p>
                      Stripe: {onboardingData.paymentSettings?.stripeEnabled ? "✓ مفعل" : "✗ غير مفعل"}
                    </p>
                    <p>
                      Vipps: {onboardingData.paymentSettings?.vippsEnabled ? "✓ مفعل" : "✗ غير مفعل"}
                    </p>
                  </div>
                </div>

                {/* Terms & Conditions */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="terms"
                      checked={acceptedTerms}
                      onCheckedChange={(checked) => setAcceptedTerms(!!checked)}
                    />
                    <Label htmlFor="terms" className="text-sm leading-relaxed">
                      أوافق على{" "}
                      <a href="/terms" target="_blank" className="text-purple-600 hover:underline">
                        الشروط والأحكام
                      </a>{" "}
                      و{" "}
                      <a href="/privacy" target="_blank" className="text-purple-600 hover:underline">
                        سياسة الخصوصية
                      </a>
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || completeOnboarding.isPending}
          >
            السابق
          </Button>
          <Button
            onClick={handleNext}
            disabled={completeOnboarding.isPending}
            className="bg-gradient-to-r from-purple-600 to-orange-500 hover:from-purple-700 hover:to-orange-600"
          >
            {completeOnboarding.isPending && "جاري الإنشاء..."}
            {!completeOnboarding.isPending && currentStep === 7 && "إنهاء التسجيل"}
            {!completeOnboarding.isPending && currentStep < 7 && "التالي"}
          </Button>
        </div>
      </div>
    </div>
  );
}
