import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EmailVerificationRequired() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: tenant } = trpc.tenants.getCurrent.useQuery(undefined, {
    enabled: !!user?.tenantId,
  });
  const utils = trpc.useUtils();

  const resendMutation = trpc.signup.resendVerification.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Kunne ikke sende e-post");
    },
  });

  // Periodically check if email has been verified
  const { refetch } = trpc.tenants.getCurrent.useQuery(undefined, {
    enabled: !!user?.tenantId,
    refetchInterval: 5000, // Check every 5 seconds
  });

  // If email is verified, reload the page to redirect to dashboard
  if (tenant?.emailVerified) {
    window.location.href = "/dashboard";
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <Mail className="h-8 w-8 text-yellow-600" />
          </div>
          <CardTitle className="text-2xl">Bekreft e-postadressen din</CardTitle>
          <CardDescription className="text-base">
            Vi har sendt en bekreftelseslenke til{" "}
            <span className="font-semibold text-foreground">{tenant?.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-2">Hvorfor må jeg bekrefte e-posten min?</p>
                <p>
                  E-postbekreftelse sikrer at du har tilgang til kontoen din og lar oss sende deg viktige
                  varsler om bookinger og betalinger.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <p>Sjekk innboksen din og spam-mappen</p>
            </div>
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <p>Klikk på bekreftelseslenken i e-posten</p>
            </div>
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <p>Du blir automatisk videresendt til dashbordet</p>
            </div>
          </div>

          <div className="pt-4 space-y-3">
            <Button
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending}
            >
              {resendMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sender...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send bekreftelse på nytt
                </>
              )}
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                refetch();
                toast.info("Sjekker status...");
              }}
            >
              Jeg har bekreftet e-posten min
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Trenger du hjelp? Kontakt oss på{" "}
            <a href="mailto:support@stylora.no" className="text-blue-600 hover:underline">
              support@stylora.no
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
