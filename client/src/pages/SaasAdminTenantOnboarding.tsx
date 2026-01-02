import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2, Copy, CheckCircle2, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Default barber services
const DEFAULT_BARBER_SERVICES = [
  {
    name: "Herreklipp",
    duration: 30,
    price: 420,
    category: "Klipp",
    description: "En klassisk herreklipp med maskin og saks. Inkluderer styling.",
  },
  {
    name: "Skin Fade",
    duration: 40,
    price: 500,
    category: "Klipp",
    description: "Presis fade med skarpe linjer. Perfekt for moderne stiler.",
  },
  {
    name: "Barneklipp (0–12 år)",
    duration: 25,
    price: 280,
    category: "Barn",
    description: "Skånsom og rask klipp til barn i trygge omgivelser.",
  },
  {
    name: "Skjeggtrim",
    duration: 20,
    price: 250,
    category: "Skjegg",
    description: "Forming, trimming og linjer for skjegg og bart.",
  },
  {
    name: "Klipp + Skjegg",
    duration: 50,
    price: 700,
    category: "Pakke",
    description: "Komplett pakke: herreklipp med skjeggforming og styling.",
  },
  {
    name: "Barbering (Hot Towel)",
    duration: 35,
    price: 520,
    category: "Barbering",
    description: "Tradisjonell barbering med varme håndklær og kniv.",
  },
  {
    name: "Full Grooming",
    duration: 75,
    price: 990,
    category: "Pakke",
    description: "Premium behandling: klipp, skjegg, barbering og styling.",
  },
  {
    name: "Studentklipp",
    duration: 30,
    price: 330,
    category: "Klipp",
    description: "Rabattert klipp for studenter (gyldig studentbevis kreves).",
  },
  {
    name: "Pensjonistklipp",
    duration: 25,
    price: 280,
    category: "Klipp",
    description: "Rimelig klipp for pensjonister.",
  },
  {
    name: "Vask & Styling",
    duration: 15,
    price: 130,
    category: "Tillegg",
    description: "Hårvask, føn og enkel styling for en frisk look.",
  },
];

type SalonType = "frisør" | "barber" | "skjønnhet";

interface FormData {
  // Step 1: Basic Info
  name: string;
  subdomain: string;
  orgNumber: string;
  contactEmail: string;
  contactPhone: string;
  
  // Step 2: Plan
  planId: number | null;
  
  // Step 3: Admin User
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPhone: string;
  
  // Step 4: Services
  salonType: SalonType;
  selectedServices: Array<{ name: string; duration: number; price: number }>;
}

const initialFormData: FormData = {
  name: "",
  subdomain: "",
  orgNumber: "",
  contactEmail: "",
  contactPhone: "",
  planId: null,
  adminFirstName: "",
  adminLastName: "",
  adminEmail: "",
  adminPhone: "",
  salonType: "frisør",
  selectedServices: [],
};

export default function SaasAdminTenantOnboarding() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [subdomainCheckDebounce, setSubdomainCheckDebounce] = useState<NodeJS.Timeout | null>(null);
  const [createdTenant, setCreatedTenant] = useState<{
    tenantId: string;
    subdomain: string;
    adminEmail: string;
    generatedPassword: string;
  } | null>(null);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);

  const totalSteps = 5;

  // Queries
  const { data: plans } = trpc.saasAdmin.getSubscriptionPlans.useQuery();
  const { data: serviceTemplates } = trpc.saasAdmin.getServiceTemplates.useQuery(
    { salonType: formData.salonType },
    { enabled: currentStep === 4 }
  );

  // Mutations
  const utils = trpc.useUtils();
  const checkSubdomainMutation = trpc.saasAdmin.checkSubdomainAvailability.useQuery(
    { subdomain: formData.subdomain },
    { enabled: false }
  );
  const createTenantMutation = trpc.saasAdmin.createTenantWithOnboarding.useMutation();

  const updateFormData = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubdomainChange = (value: string) => {
    // Clean subdomain (lowercase, no spaces, only alphanumeric and hyphens)
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    updateFormData("subdomain", cleaned);

    // Debounce availability check
    if (subdomainCheckDebounce) {
      clearTimeout(subdomainCheckDebounce);
    }

    if (cleaned.length >= 3) {
      const timeout = setTimeout(() => {
        utils.saasAdmin.checkSubdomainAvailability.fetch({ subdomain: cleaned });
      }, 500);
      setSubdomainCheckDebounce(timeout);
    }
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        if (!formData.name || !formData.subdomain || !formData.orgNumber || 
            !formData.contactEmail || !formData.contactPhone) {
          toast.error("Vennligst fyll ut alle feltene");
          return false;
        }
        if (formData.subdomain.length < 3) {
          toast.error("Subdomain må være minst 3 tegn");
          return false;
        }
        if (formData.orgNumber.length !== 9) {
          toast.error("Organisasjonsnummer må være 9 siffer");
          return false;
        }
        if (checkSubdomainMutation.data && !checkSubdomainMutation.data.available) {
          toast.error("Subdomain er allerede i bruk");
          return false;
        }
        return true;

      case 2:
        if (!formData.planId) {
          toast.error("Vennligst velg en abonnementsplan");
          return false;
        }
        return true;

      case 3:
        if (!formData.adminFirstName || !formData.adminLastName || 
            !formData.adminEmail || !formData.adminPhone) {
          toast.error("Vennligst fyll ut alle feltene");
          return false;
        }
        return true;

      case 4:
        if (formData.selectedServices.length === 0) {
          toast.error("Vennligst velg minst én tjeneste");
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    }
  };

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) return;

    try {
      const result = await createTenantMutation.mutateAsync({
        name: formData.name,
        subdomain: formData.subdomain,
        orgNumber: formData.orgNumber,
        contactEmail: formData.contactEmail,
        contactPhone: formData.contactPhone,
        planId: formData.planId!,
        adminFirstName: formData.adminFirstName,
        adminLastName: formData.adminLastName,
        adminEmail: formData.adminEmail,
        adminPhone: formData.adminPhone,
        salonType: formData.salonType,
        services: formData.selectedServices,
      });

      setCreatedTenant(result);
      setCurrentStep(5); // Success step
      toast.success("Salong opprettet!");
    } catch (error: any) {
      toast.error(error.message || "Kunne ikke opprette salong");
    }
  };

  const handleCopyPassword = () => {
    if (createdTenant) {
      navigator.clipboard.writeText(createdTenant.generatedPassword);
      toast.success("Passord kopiert!");
    }
  };

  const handleLoadDefaultBarberServices = () => {
    if (formData.selectedServices.length > 0) {
      // Show confirmation dialog
      setShowReplaceDialog(true);
    } else {
      // Directly load defaults
      loadDefaultServices();
    }
  };

  const loadDefaultServices = () => {
    updateFormData("selectedServices", DEFAULT_BARBER_SERVICES);
    updateFormData("salonType", "barber");
    toast.success(`${DEFAULT_BARBER_SERVICES.length} standard barber-tjenester lastet inn`);
    setShowReplaceDialog(false);
  };

  const handleSelectAllServices = () => {
    if (serviceTemplates) {
      updateFormData("selectedServices", serviceTemplates);
    }
  };

  const handleDeselectAllServices = () => {
    updateFormData("selectedServices", []);
  };

  const handleToggleService = (service: { name: string; duration: number; price: number }) => {
    const isSelected = formData.selectedServices.some(s => s.name === service.name);
    if (isSelected) {
      updateFormData(
        "selectedServices",
        formData.selectedServices.filter(s => s.name !== service.name)
      );
    } else {
      updateFormData("selectedServices", [...formData.selectedServices, service]);
    }
  };

  // Progress indicator
  const renderProgress = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map(step => (
        <div key={step} className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors ${
              step < currentStep
                ? "bg-primary text-primary-foreground"
                : step === currentStep
                ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {step < currentStep ? <Check className="w-5 h-5" /> : step}
          </div>
          {step < totalSteps && (
            <div
              className={`w-12 h-1 mx-1 transition-colors ${
                step < currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

  // Step 1: Basic Info
  const renderStep1 = () => (
    <Card>
      <CardHeader>
        <CardTitle>Grunnleggende informasjon</CardTitle>
        <CardDescription>Fyll inn salongens basisopplysninger</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="name">Salongnavn *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={e => updateFormData("name", e.target.value)}
            placeholder="Eks: Salong Elegant"
          />
        </div>

        <div>
          <Label htmlFor="subdomain">Subdomain *</Label>
          <Input
            id="subdomain"
            value={formData.subdomain}
            onChange={e => handleSubdomainChange(e.target.value)}
            placeholder="salong-elegant"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Din salong vil være tilgjengelig på: <strong>{formData.subdomain || "subdomain"}.stylora.no</strong>
          </p>
          {checkSubdomainMutation.data && formData.subdomain.length >= 3 && (
            <p className={`text-sm mt-1 ${checkSubdomainMutation.data.available ? "text-green-600" : "text-red-600"}`}>
              {checkSubdomainMutation.data.available ? "✓ Tilgjengelig" : "✗ Allerede i bruk"}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="orgNumber">Organisasjonsnummer *</Label>
          <Input
            id="orgNumber"
            value={formData.orgNumber}
            onChange={e => updateFormData("orgNumber", e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="123456789"
            maxLength={9}
          />
        </div>

        <div>
          <Label htmlFor="contactEmail">Kontakt e-post *</Label>
          <Input
            id="contactEmail"
            type="email"
            value={formData.contactEmail}
            onChange={e => updateFormData("contactEmail", e.target.value)}
            placeholder="kontakt@salong.no"
          />
        </div>

        <div>
          <Label htmlFor="contactPhone">Kontakt telefon *</Label>
          <Input
            id="contactPhone"
            type="tel"
            value={formData.contactPhone}
            onChange={e => updateFormData("contactPhone", e.target.value)}
            placeholder="+47 123 45 678"
          />
        </div>
      </CardContent>
    </Card>
  );

  // Step 2: Plan Selection
  const renderStep2 = () => (
    <Card>
      <CardHeader>
        <CardTitle>Velg abonnementsplan</CardTitle>
        <CardDescription>Velg hvilken plan salongen skal starte med</CardDescription>
      </CardHeader>
      <CardContent>
        {!plans ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <RadioGroup
            value={formData.planId?.toString() || ""}
            onValueChange={value => updateFormData("planId", parseInt(value))}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map(plan => (
                <div
                  key={plan.id}
                  className={`relative border rounded-lg p-4 cursor-pointer transition-all ${
                    formData.planId === plan.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => updateFormData("planId", plan.id)}
                >
                  <RadioGroupItem value={plan.id.toString()} className="absolute top-4 right-4" />
                  <h3 className="font-semibold text-lg mb-2">{plan.displayNameNo}</h3>
                  <p className="text-2xl font-bold mb-4">
                    {plan.priceMonthly} kr<span className="text-sm font-normal text-muted-foreground">/mnd</span>
                  </p>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>✓ {plan.maxEmployees === 999 ? "Ubegrenset" : plan.maxEmployees} ansatte</p>
                    <p>✓ {plan.maxLocations === 999 ? "Ubegrenset" : plan.maxLocations} lokasjon(er)</p>
                    <p>✓ Online booking</p>
                    {plan.id >= 2 && <p>✓ SMS-påminnelser</p>}
                    {plan.id >= 3 && <p>✓ Prioritert support</p>}
                  </div>
                </div>
              ))}
            </div>
          </RadioGroup>
        )}
      </CardContent>
    </Card>
  );

  // Step 3: Admin User
  const renderStep3 = () => (
    <Card>
      <CardHeader>
        <CardTitle>Opprett admin-bruker</CardTitle>
        <CardDescription>
          Denne brukeren vil være salongens eier/administrator
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="adminFirstName">Fornavn *</Label>
            <Input
              id="adminFirstName"
              value={formData.adminFirstName}
              onChange={e => updateFormData("adminFirstName", e.target.value)}
              placeholder="Ola"
            />
          </div>
          <div>
            <Label htmlFor="adminLastName">Etternavn *</Label>
            <Input
              id="adminLastName"
              value={formData.adminLastName}
              onChange={e => updateFormData("adminLastName", e.target.value)}
              placeholder="Nordmann"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="adminEmail">E-post *</Label>
          <Input
            id="adminEmail"
            type="email"
            value={formData.adminEmail}
            onChange={e => updateFormData("adminEmail", e.target.value)}
            placeholder="ola@salong.no"
          />
        </div>

        <div>
          <Label htmlFor="adminPhone">Telefon *</Label>
          <Input
            id="adminPhone"
            type="tel"
            value={formData.adminPhone}
            onChange={e => updateFormData("adminPhone", e.target.value)}
            placeholder="+47 987 65 432"
          />
        </div>

        <div className="bg-muted p-4 rounded-lg space-y-2">
          <p className="text-sm font-medium">ℹ️ Viktig informasjon</p>
          <p className="text-sm text-muted-foreground">
            Et sikkert passord vil bli generert automatisk og vist på neste side.
            Admin-brukeren må endre passordet ved første innlogging.
          </p>
        </div>
      </CardContent>
    </Card>
  );

  // Step 4: Service Templates
  const renderStep4 = () => (
    <Card>
      <CardHeader>
        <CardTitle>Velg tjenester</CardTitle>
        <CardDescription>Velg hvilke tjenester salongen skal tilby</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Salongtype</Label>
          <RadioGroup
            value={formData.salonType}
            onValueChange={value => {
              updateFormData("salonType", value as SalonType);
              updateFormData("selectedServices", []); // Reset services when type changes
            }}
            className="flex gap-4 mt-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="frisør" id="type-frisor" />
              <Label htmlFor="type-frisor" className="cursor-pointer">Frisør</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="barber" id="type-barber" />
              <Label htmlFor="type-barber" className="cursor-pointer">Barber</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="skjønnhet" id="type-skjonnhet" />
              <Label htmlFor="type-skjonnhet" className="cursor-pointer">Skjønnhet</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button 
            type="button" 
            variant="default" 
            size="sm" 
            onClick={handleLoadDefaultBarberServices}
            className="bg-gradient-to-r from-blue-600 to-orange-500"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Bruk standard barber-tjenester
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleSelectAllServices}>
            Velg alle
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleDeselectAllServices}>
            Fjern alle
          </Button>
        </div>

        {/* Selected services - editable */}
        {formData.selectedServices.length > 0 && (
          <div className="space-y-3">
            <Label>Valgte tjenester (kan redigeres)</Label>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {formData.selectedServices.map((service, index) => (
                <div key={index} className="p-3 border rounded-lg bg-primary/5 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`service-name-${index}`} className="text-xs">Navn</Label>
                      <Input
                        id={`service-name-${index}`}
                        value={service.name}
                        onChange={(e) => {
                          const updated = [...formData.selectedServices];
                          updated[index] = { ...updated[index], name: e.target.value };
                          updateFormData("selectedServices", updated);
                        }}
                        className="h-8"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor={`service-duration-${index}`} className="text-xs">Min</Label>
                        <Input
                          id={`service-duration-${index}`}
                          type="number"
                          value={service.duration}
                          onChange={(e) => {
                            const updated = [...formData.selectedServices];
                            updated[index] = { ...updated[index], duration: parseInt(e.target.value) || 0 };
                            updateFormData("selectedServices", updated);
                          }}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`service-price-${index}`} className="text-xs">Kr</Label>
                        <Input
                          id={`service-price-${index}`}
                          type="number"
                          value={service.price}
                          onChange={(e) => {
                            const updated = [...formData.selectedServices];
                            updated[index] = { ...updated[index], price: parseInt(e.target.value) || 0 };
                            updateFormData("selectedServices", updated);
                          }}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      const updated = formData.selectedServices.filter((_, i) => i !== index);
                      updateFormData("selectedServices", updated);
                    }}
                  >
                    Fjern
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available templates - only show if not using default services */}
        {!serviceTemplates ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : formData.selectedServices.length === 0 ? (
          <div className="space-y-2">
            <Label>Tilgjengelige tjenester</Label>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {serviceTemplates.map((service, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors hover:border-primary/50"
                  onClick={() => handleToggleService(service)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox checked={false} />
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {service.duration} min • {service.price} kr
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Valgt: <strong>{formData.selectedServices.length}</strong> tjeneste(r)
        </p>
      </CardContent>
    </Card>
  );

  // Step 5: Success
  const renderStep5 = () => {
    if (!createdTenant) return null;

    return (
      <Card>
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
          </div>
          <CardTitle className="text-center">Salong opprettet!</CardTitle>
          <CardDescription className="text-center">
            {formData.name} er nå klar til bruk
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted p-4 rounded-lg space-y-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Salongnavn</p>
              <p className="font-semibold">{formData.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">URL</p>
              <p className="font-semibold">{createdTenant.subdomain}.stylora.no</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Admin e-post</p>
              <p className="font-semibold">{createdTenant.adminEmail}</p>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-3">
            <p className="text-sm font-medium text-yellow-900">🔐 Midlertidig passord</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white px-3 py-2 rounded border text-lg font-mono">
                {createdTenant.generatedPassword}
              </code>
              <Button type="button" variant="outline" size="icon" onClick={handleCopyPassword}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-sm text-yellow-800">
              ⚠️ <strong>Viktig:</strong> Admin-brukeren må endre passordet ved første innlogging.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => setLocation(`/saas-admin/tenants/${createdTenant.tenantId}`)}
              className="flex-1"
            >
              Vis salongdetaljer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFormData(initialFormData);
                setCreatedTenant(null);
                setCurrentStep(1);
              }}
              className="flex-1"
            >
              Opprett ny salong
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <Button variant="ghost" onClick={() => setLocation("/saas-admin/tenants")}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          Tilbake til salonger
        </Button>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Opprett ny salong</h1>
        <p className="text-muted-foreground">
          Følg trinnene for å sette opp en ny salong i systemet
        </p>
      </div>

      {renderProgress()}

      <div className="mb-8">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}
      </div>

      {currentStep < 5 && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Forrige
          </Button>

          {currentStep < 4 ? (
            <Button onClick={handleNext}>
              Neste
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createTenantMutation.isPending}
            >
              {createTenantMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Oppretter...
                </>
              ) : (
                "Opprett salong"
              )}
            </Button>
          )}
        </div>
      )}

      {/* Confirmation dialog for replacing existing services */}
      <AlertDialog open={showReplaceDialog} onOpenChange={setShowReplaceDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erstatte eksisterende tjenester?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette vil erstatte de {formData.selectedServices.length} eksisterende tjenestene i veiviseren med {DEFAULT_BARBER_SERVICES.length} standard barber-tjenester. Fortsette?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={loadDefaultServices}>
              Ja, erstatt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
