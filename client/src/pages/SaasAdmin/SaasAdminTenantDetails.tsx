import { useState, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ArrowLeft, LogIn, Save, Users, Calendar, ShoppingCart, DollarSign, Pause, Play, Trash2, AlertTriangle, Loader2, Key, Mail, Phone, User, LogOut } from "lucide-react";
import { toast } from "sonner";

export default function SaasAdminTenantDetails() {
  const [match, params] = useRoute("/saas-admin/tenants/:tenantId");
  const [, setLocation] = useLocation();
  const tenantId = params?.tenantId as string;
  
  // Validate tenantId
  const isValidTenantId = tenantId && tenantId !== ":tenantId" && !tenantId.includes(":");

  const [selectedStatus, setSelectedStatus] = useState<"trial" | "active" | "suspended" | "canceled">("active");
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  
  // Dialog states
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPermanentDeleteDialog, setShowPermanentDeleteDialog] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState("");
  
  // Owner credentials state
  const [showEditOwnerDialog, setShowEditOwnerDialog] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerNewPassword, setOwnerNewPassword] = useState("");

  const { data: details, isLoading, refetch } = trpc.saasAdmin.getTenantDetails.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  const { data: plans } = trpc.saasAdmin.getSubscriptionPlans.useQuery();

  const impersonateMutation = trpc.saasAdmin.impersonateTenant.useMutation({
    onSuccess: (result) => {
      setLocation(result.redirectUrl);
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  const updateMutation = trpc.saasAdmin.updateTenantPlanAndStatus.useMutation({
    onSuccess: () => {
      toast.success("Oppdatert!");
      refetch();
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  const suspendMutation = trpc.saasAdmin.suspendTenant.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setShowSuspendDialog(false);
      refetch();
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  const reactivateMutation = trpc.saasAdmin.reactivateTenant.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      refetch();
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  const deleteMutation = trpc.saasAdmin.deleteTenant.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setShowDeleteDialog(false);
      setLocation("/saas-admin/tenants");
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  const permanentDeleteMutation = trpc.saasAdmin.permanentlyDeleteTenant.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setShowPermanentDeleteDialog(false);
      setLocation("/saas-admin/tenants");
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  // Owner credentials queries and mutations
  const { data: ownerData, refetch: refetchOwner } = trpc.saasAdmin.getTenantOwner.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  const updateOwnerMutation = trpc.saasAdmin.updateTenantOwnerCredentials.useMutation({
    onSuccess: () => {
      toast.success("Eierinformasjon oppdatert!");
      setShowEditOwnerDialog(false);
      setOwnerNewPassword("");
      refetchOwner();
    },
    onError: (error) => {
      toast.error(`Feil: ${error.message}`);
    },
  });

  // Initialize owner form when data loads
  useEffect(() => {
    if (ownerData) {
      setOwnerEmail(ownerData.email || "");
      setOwnerName(ownerData.name || "");
      setOwnerPhone(ownerData.phone || "");
    }
  }, [ownerData]);

  const handleUpdateOwner = () => {
    updateOwnerMutation.mutate({
      tenantId,
      email: ownerEmail || undefined,
      name: ownerName || undefined,
      phone: ownerPhone || undefined,
      newPassword: ownerNewPassword || undefined,
    });
  };

  // Initialize form values when data loads
  useEffect(() => {
    if (details) {
      if (details.tenant.status) {
        setSelectedStatus(details.tenant.status);
      }
      setSelectedPlanId(details.subscription?.planId ?? null);
    }
  }, [details]);

  const handleSave = () => {
    updateMutation.mutate({
      tenantId,
      status: selectedStatus,
      planId: selectedPlanId,
    });
  };

  const handleSuspend = () => {
    suspendMutation.mutate({ tenantId });
  };

  const handleReactivate = () => {
    reactivateMutation.mutate({ tenantId });
  };

  const handleDelete = () => {
    if (deleteConfirmName !== details?.tenant.name) {
      toast.error("Navnet stemmer ikke. Skriv inn nøyaktig salongnavn.");
      return;
    }
    deleteMutation.mutate({ tenantId, confirmName: deleteConfirmName });
  };

  const handlePermanentDelete = () => {
    if (deleteConfirmName !== details?.tenant.name) {
      toast.error("Navnet stemmer ikke. Skriv inn nøyaktig salongnavn.");
      return;
    }
    if (permanentDeleteConfirm !== "DELETE PERMANENTLY") {
      toast.error("Skriv 'DELETE PERMANENTLY' for å bekrefte.");
      return;
    }
    permanentDeleteMutation.mutate({ 
      tenantId, 
      confirmName: deleteConfirmName,
      confirmPermanent: "DELETE PERMANENTLY"
    });
  };

  // Show error if tenantId is invalid
  if (!isValidTenantId) {
    return (
      <div className="container py-8">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <div className="text-red-600 text-lg font-semibold">Ugyldig salong-ID</div>
          <div className="text-muted-foreground">URL-en er ikke gyldig. Vennligst gå tilbake til salonglisten.</div>
          <Button onClick={() => setLocation("/saas-admin/tenants")}>Tilbake til salonger</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Laster...</div>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="container py-8">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <div className="text-muted-foreground text-lg">Salong ikke funnet</div>
          <Button onClick={() => setLocation("/saas-admin/tenants")}>Tilbake til salonger</Button>
        </div>
      </div>
    );
  }

  const { tenant, subscription, usage } = details;

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/saas-admin/tenants">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{tenant.name}</h1>
            <p className="text-muted-foreground mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded">
                {tenant.subdomain}.stylora.app
              </code>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => impersonateMutation.mutate({ tenantId })}
            disabled={impersonateMutation.isPending}
            size="lg"
            className="bg-gradient-to-r from-blue-600 to-purple-600"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Logg inn som denne salongen
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="border-red-200 text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logg ut
          </Button>
        </div>
      </div>

      {/* Basic Info */}
      <Card className="p-6 border-0 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Grunnleggende informasjon</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Navn</label>
            <p className="text-lg font-medium mt-1">{tenant.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Subdomene</label>
            <p className="text-lg font-medium mt-1">{tenant.subdomain}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Org.nummer</label>
            <p className="text-lg font-medium mt-1">{tenant.orgNumber || "Ikke angitt"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Opprettet</label>
            <p className="text-lg font-medium mt-1">
              {new Date(tenant.createdAt).toLocaleDateString("no-NO")}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">Status</label>
            <div className="mt-1">
              <Badge
                variant={
                  tenant.status === "active"
                    ? "default"
                    : tenant.status === "trial"
                    ? "secondary"
                    : "destructive"
                }
              >
                {tenant.status === "active"
                  ? "Aktiv"
                  : tenant.status === "trial"
                  ? "Prøve"
                  : tenant.status === "suspended"
                  ? "Suspendert"
                  : "Kansellert"}
              </Badge>
            </div>
          </div>
          {tenant.trialEndsAt && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Prøveperiode slutter
              </label>
              <p className="text-lg font-medium mt-1">
                {new Date(tenant.trialEndsAt).toLocaleDateString("no-NO")}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Owner Credentials */}
      <Card className="p-6 border-0 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Eier innlogging</h2>
          <Button
            variant="outline"
            onClick={() => setShowEditOwnerDialog(true)}
          >
            <Key className="h-4 w-4 mr-2" />
            Rediger innlogging
          </Button>
        </div>
        
        {ownerData ? (
          <div className="grid gap-4 md:grid-cols-2 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              <div>
                <label className="text-sm font-medium text-muted-foreground">Navn</label>
                <p className="font-medium">{ownerData.name || "Ikke angitt"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <label className="text-sm font-medium text-muted-foreground">E-post</label>
                <p className="font-medium">{ownerData.email || "Ikke angitt"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-muted-foreground" />
              <div>
                <label className="text-sm font-medium text-muted-foreground">Telefon</label>
                <p className="font-medium">{ownerData.phone || "Ikke angitt"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Key className="h-5 w-5 text-muted-foreground" />
              <div>
                <label className="text-sm font-medium text-muted-foreground">Passord</label>
                <p className="font-medium text-muted-foreground">••••••••</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Laster eierinformasjon...</p>
        )}
      </Card>

      {/* Subscription Management */}
      <Card className="p-6 border-0 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Abonnement</h2>
        
        {subscription && (
          <div className="grid gap-4 md:grid-cols-2 mb-6 p-4 bg-muted/50 rounded-lg">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Nåværende plan</label>
              <p className="text-lg font-medium mt-1">{subscription.planName}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Pris</label>
              <p className="text-lg font-medium mt-1">{subscription.priceMonthly} kr/mnd</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Abonnementsstatus</label>
              <p className="text-lg font-medium mt-1 capitalize">{subscription.status}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Periode</label>
              <p className="text-lg font-medium mt-1">
                {new Date(subscription.currentPeriodStart).toLocaleDateString("no-NO")} -{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString("no-NO")}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Endre status</label>
            <Select
              value={selectedStatus}
              onValueChange={(value: typeof selectedStatus) => setSelectedStatus(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trial">Prøve</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="suspended">Suspendert</SelectItem>
                <SelectItem value="canceled">Kansellert</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Endre plan</label>
            <Select
              value={selectedPlanId?.toString() || "none"}
              onValueChange={(value) => setSelectedPlanId(value === "none" ? null : parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen plan</SelectItem>
                {plans?.map((plan: any) => (
                  <SelectItem key={plan.id} value={plan.id.toString()}>
                    {plan.displayNameNo} - {plan.priceMonthly} kr/mnd
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600"
          >
            <Save className="h-4 w-4 mr-2" />
            Lagre endringer
          </Button>
        </div>
      </Card>

      {/* Usage Stats */}
      <Card className="p-6 border-0 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Bruksstatistikk</h2>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Kunder</p>
              <p className="text-2xl font-bold">{usage.totalCustomers}</p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ansatte</p>
              <p className="text-2xl font-bold">{usage.totalEmployees}</p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-orange-500 to-red-500">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Timer (totalt)</p>
              <p className="text-2xl font-bold">{usage.totalAppointments}</p>
              <p className="text-xs text-muted-foreground">
                {usage.totalCompletedAppointments} fullført
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
              <ShoppingCart className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ordre (totalt)</p>
              <p className="text-2xl font-bold">{usage.totalOrders}</p>
              <p className="text-xs text-muted-foreground">
                {usage.totalOrderAmount.toLocaleString("no-NO")} kr
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t">
          <h3 className="font-semibold mb-4">Siste 30 dager</h3>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Timer</p>
                <p className="text-2xl font-bold">{usage.last30DaysAppointments}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-gradient-to-br from-yellow-500 to-orange-500">
                <ShoppingCart className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ordre</p>
                <p className="text-2xl font-bold">{usage.last30DaysOrders}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-gradient-to-br from-green-500 to-teal-500">
                <DollarSign className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Omsetning</p>
                <p className="text-2xl font-bold">
                  {usage.last30DaysOrderAmount.toLocaleString("no-NO")} kr
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border-0 shadow-lg border-red-200 bg-red-50/50 dark:bg-red-950/10">
        <h2 className="text-xl font-bold mb-4 text-red-600 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Faresone
        </h2>
        <p className="text-muted-foreground mb-6">
          Disse handlingene kan ikke angres. Vær forsiktig.
        </p>
        
        <div className="space-y-4">
          {/* Suspend/Reactivate */}
          {tenant.status === "suspended" ? (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-900">
              <div>
                <h3 className="font-semibold">Reaktiver salong</h3>
                <p className="text-sm text-muted-foreground">
                  Gjenopprett tilgang for denne salongen
                </p>
              </div>
              <Button
                variant="outline"
                className="border-green-500 text-green-600 hover:bg-green-50"
                onClick={handleReactivate}
                disabled={reactivateMutation.isPending}
              >
                {reactivateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Reaktiver
              </Button>
            </div>
          ) : tenant.status !== "canceled" && (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-900">
              <div>
                <h3 className="font-semibold">Suspender salong</h3>
                <p className="text-sm text-muted-foreground">
                  Midlertidig deaktiver tilgang for denne salongen
                </p>
              </div>
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50"
                onClick={() => setShowSuspendDialog(true)}
              >
                <Pause className="h-4 w-4 mr-2" />
                Suspender
              </Button>
            </div>
          )}

          {/* Soft Delete */}
          {tenant.status !== "canceled" && (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-gray-900">
              <div>
                <h3 className="font-semibold">Slett salong</h3>
                <p className="text-sm text-muted-foreground">
                  Deaktiver salongen og alle brukere. Data beholdes.
                </p>
              </div>
              <Button
                variant="outline"
                className="border-red-500 text-red-600 hover:bg-red-50"
                onClick={() => {
                  setDeleteConfirmName("");
                  setShowDeleteDialog(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Slett
              </Button>
            </div>
          )}

          {/* Permanent Delete */}
          <div className="flex items-center justify-between p-4 border-2 border-red-300 rounded-lg bg-white dark:bg-gray-900">
            <div>
              <h3 className="font-semibold text-red-600">Slett permanent</h3>
              <p className="text-sm text-muted-foreground">
                Slett salongen og ALL data permanent. Kan ikke angres!
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteConfirmName("");
                setPermanentDeleteConfirm("");
                setShowPermanentDeleteDialog(true);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Slett permanent
            </Button>
          </div>
        </div>
      </Card>

      {/* Suspend Dialog */}
      <AlertDialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspender salong?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette vil midlertidig deaktivere tilgang for "{tenant.name}". 
              Alle brukere vil bli logget ut og kan ikke logge inn igjen før salongen reaktiveres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuspend}
              className="bg-orange-600 hover:bg-orange-700"
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Suspender
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Slett salong</DialogTitle>
            <DialogDescription>
              Dette vil deaktivere salongen "{tenant.name}" og alle brukere. 
              Data vil bli bevart, men salongen kan ikke brukes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="confirmName">
                Skriv inn salongnavnet for å bekrefte: <strong>{tenant.name}</strong>
              </Label>
              <Input
                id="confirmName"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder="Skriv salongnavnet her"
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending || deleteConfirmName !== tenant.name}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Slett salong
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Owner Credentials Dialog */}
      <Dialog open={showEditOwnerDialog} onOpenChange={setShowEditOwnerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rediger eier innlogging</DialogTitle>
            <DialogDescription>
              Oppdater innloggingsinformasjon for salongeier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="ownerName">Navn</Label>
              <Input
                id="ownerName"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Fullt navn"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="ownerEmail">E-post</Label>
              <Input
                id="ownerEmail"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="epost@eksempel.no"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="ownerPhone">Telefon</Label>
              <Input
                id="ownerPhone"
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="+47 xxx xx xxx"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="ownerPassword">Nytt passord (valgfritt)</Label>
              <Input
                id="ownerPassword"
                type="password"
                value={ownerNewPassword}
                onChange={(e) => setOwnerNewPassword(e.target.value)}
                placeholder="La stå tom for å beholde nåværende"
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Fyll kun inn hvis du vil endre passordet
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditOwnerDialog(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleUpdateOwner}
              disabled={updateOwnerMutation.isPending}
              className="bg-gradient-to-r from-blue-600 to-purple-600"
            >
              {updateOwnerMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Lagre endringer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Dialog */}
      <Dialog open={showPermanentDeleteDialog} onOpenChange={setShowPermanentDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Permanent sletting
            </DialogTitle>
            <DialogDescription>
              <strong className="text-red-600">ADVARSEL:</strong> Dette vil permanent slette salongen "{tenant.name}" 
              og ALL tilknyttet data inkludert kunder, ansatte, timer, ordre, og betalinger. 
              Denne handlingen kan IKKE angres!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="confirmNamePerm">
                Skriv inn salongnavnet: <strong>{tenant.name}</strong>
              </Label>
              <Input
                id="confirmNamePerm"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder="Skriv salongnavnet her"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="confirmPerm">
                Skriv <strong>DELETE PERMANENTLY</strong> for å bekrefte:
              </Label>
              <Input
                id="confirmPerm"
                value={permanentDeleteConfirm}
                onChange={(e) => setPermanentDeleteConfirm(e.target.value)}
                placeholder="DELETE PERMANENTLY"
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPermanentDeleteDialog(false)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={handlePermanentDelete}
              disabled={
                permanentDeleteMutation.isPending || 
                deleteConfirmName !== tenant.name || 
                permanentDeleteConfirm !== "DELETE PERMANENTLY"
              }
            >
              {permanentDeleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Slett permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
