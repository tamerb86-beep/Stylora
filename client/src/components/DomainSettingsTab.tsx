import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Globe, 
  Copy, 
  Check, 
  ExternalLink, 
  QrCode, 
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { toast } from "sonner";

export function DomainSettingsTab() {
  const [isEditing, setIsEditing] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [copied, setCopied] = useState(false);
  const [checkDebounce, setCheckDebounce] = useState<NodeJS.Timeout | null>(null);

  // Queries
  const { data: domainInfo, isLoading, refetch } = trpc.salonSettings.getDomainInfo.useQuery();
  
  const { data: availabilityData, isLoading: isChecking } = trpc.salonSettings.checkSubdomainAvailability.useQuery(
    { subdomain: newSubdomain },
    { 
      enabled: false, // Manual trigger only
    }
  );

  // Mutations
  const utils = trpc.useUtils();
  const updateSubdomainMutation = trpc.salonSettings.updateSubdomain.useMutation({
    onSuccess: () => {
      toast.success("Subdomain oppdatert!");
      setIsEditing(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Kunne ikke oppdatere subdomain");
    },
  });

  const handleCopy = () => {
    if (domainInfo) {
      navigator.clipboard.writeText(domainInfo.bookingUrl);
      setCopied(true);
      toast.success("Lenke kopiert!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubdomainChange = (value: string) => {
    // Clean input (lowercase, no spaces, only alphanumeric and hyphens)
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setNewSubdomain(cleaned);
    
    // Debounce availability check
    if (checkDebounce) {
      clearTimeout(checkDebounce);
    }

    if (cleaned.length >= 3 && cleaned !== domainInfo?.subdomain) {
      const timeout = setTimeout(() => {
        utils.salonSettings.checkSubdomainAvailability.fetch({ subdomain: cleaned });
      }, 500);
      setCheckDebounce(timeout);
    }
  };

  const handleSave = () => {
    if (newSubdomain.length < 3) {
      toast.error("Subdomain må være minst 3 tegn");
      return;
    }
    
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(newSubdomain)) {
      toast.error("Ugyldig format. Bruk kun små bokstaver, tall og bindestreker (ikke i start/slutt)");
      return;
    }

    updateSubdomainMutation.mutate({ subdomain: newSubdomain });
  };

  const handleCancel = () => {
    setNewSubdomain(domainInfo?.subdomain || "");
    setIsEditing(false);
  };

  const handleEdit = () => {
    setNewSubdomain(domainInfo?.subdomain || "");
    setIsEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!domainInfo) {
    return (
      <Alert>
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>
          Kunne ikke laste domeneinformasjon
        </AlertDescription>
      </Alert>
    );
  }

  const isAvailable = availabilityData?.available ?? null;
  const canSave = newSubdomain.length >= 3 && 
                  newSubdomain !== domainInfo.subdomain && 
                  isAvailable === true &&
                  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(newSubdomain);

  return (
    <div className="space-y-6">
      {/* Current Domain Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-600" />
            <CardTitle>Domeneinformasjon</CardTitle>
          </div>
          <CardDescription>
            Ditt subdomene og lenke til bookingside
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Subdomain Display */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Nåværende subdomene</p>
                <p className="text-2xl font-bold text-blue-600">{domainInfo.subdomain}</p>
              </div>
              <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Aktiv
              </Badge>
            </div>
            
            {domainInfo.lastUpdated && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="w-4 h-4" />
                <span>Sist oppdatert: {new Date(domainInfo.lastUpdated).toLocaleDateString('nb-NO')}</span>
              </div>
            )}
          </div>

          {/* Booking URL Section */}
          <div>
            <Label className="text-base font-semibold mb-3 block">Lenke til bookingside</Label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  value={domainInfo.bookingUrl}
                  readOnly
                  className="pr-10 font-mono text-sm bg-slate-50"
                />
                <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Del denne lenken med kundene dine for direkte booking
            </p>
          </div>

          {/* QR Code Section */}
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border">
            <div className="w-24 h-24 bg-white border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center">
              <QrCode className="w-12 h-12 text-slate-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold mb-1">QR-kode for bookingside</p>
              <p className="text-sm text-muted-foreground mb-3">
                La kundene skanne koden for rask tilgang til bookingsiden
              </p>
              <Button variant="outline" size="sm" onClick={() => toast.info("QR-kode funksjon kommer snart!")}>
                <QrCode className="w-4 h-4 mr-2" />
                Last ned QR-kode
              </Button>
            </div>
          </div>

          {/* Edit Button */}
          {!isEditing && (
            <Button 
              onClick={handleEdit}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              <Globe className="w-4 h-4 mr-2" />
              Rediger subdomene
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Edit Subdomain Card (shown when editing) */}
      {isEditing && (
        <Card className="border-2 border-blue-500 shadow-lg">
          <CardHeader>
            <CardTitle className="text-blue-600">Rediger subdomene</CardTitle>
            <CardDescription>
              Velg et nytt subdomene for salonen din (3-63 tegn, små bokstaver, tall og bindestreker)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Warning Alert */}
            <Alert className="bg-yellow-50 border-yellow-300">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                <strong>Advarsel:</strong> Endring av subdomene vil påvirke alle lenker som er delt med kunder. 
                Sørg for å oppdatere lenkene i alt markedsføringsmateriell.
              </AlertDescription>
            </Alert>

            {/* Subdomain Input */}
            <div>
              <Label htmlFor="new-subdomain">Nytt subdomene</Label>
              <div className="flex gap-2 mt-2">
                <div className="flex-1 relative">
                  <Input
                    id="new-subdomain"
                    value={newSubdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    placeholder="min-salong"
                    className="font-mono"
                  />
                  {isChecking && (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-600" />
                  )}
                  {!isChecking && isAvailable === true && newSubdomain !== domainInfo.subdomain && (
                    <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-600" />
                  )}
                  {!isChecking && isAvailable === false && (
                    <XCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-600" />
                  )}
                </div>
                <div className="flex items-center px-3 bg-slate-100 rounded-md border text-sm text-muted-foreground">
                  .stylora.no
                </div>
              </div>
              
              {/* Availability Status */}
              {!isChecking && isAvailable === true && newSubdomain !== domainInfo.subdomain && (
                <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Tilgjengelig! Du kan bruke dette subdomenet
                </p>
              )}
              {!isChecking && isAvailable === false && (
                <p className="text-sm text-red-600 mt-2 flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  Ikke tilgjengelig, subdomenet er allerede i bruk
                </p>
              )}
              {newSubdomain.length > 0 && newSubdomain.length < 3 && (
                <p className="text-sm text-orange-600 mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Må være minst 3 tegn
                </p>
              )}
            </div>

            {/* Preview */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-muted-foreground mb-1">Forhåndsvisning av ny lenke</p>
              <p className="font-mono text-blue-600 font-semibold">
                https://{newSubdomain || "subdomene"}.stylora.no/book
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleSave}
                disabled={!canSave || updateSubdomainMutation.isPending}
                className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {updateSubdomainMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Lagrer...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Lagre endringer
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateSubdomainMutation.isPending}
                className="flex-1"
              >
                Avbryt
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regler for subdomene</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span>Fra 3 til 63 tegn</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span>Kun små bokstaver (a-z)</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span>Tall (0-9) og bindestreker (-)</span>
            </div>
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <span>Kan ikke starte eller slutte med bindestrek</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Viktige tips</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>• Velg et subdomene som er lett å huske og skrive</p>
            <p>• Bruk salongens navn eller lokasjon</p>
            <p>• Unngå for mange tall</p>
            <p>• Oppdater lenkene dine etter endring</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
