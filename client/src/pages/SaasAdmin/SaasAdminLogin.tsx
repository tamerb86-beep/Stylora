import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SaasAdminLogin() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, refetch } = trpc.auth.me.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check if user is platform owner by checking tenantId
  // Platform owner has tenantId = "platform-admin-tenant"
  const isPlatformOwner = user && user.tenantId === "platform-admin-tenant";

  useEffect(() => {
    // If user is logged in and is platform owner, redirect to /saas-admin
    if (user && isPlatformOwner) {
      setLocation("/saas-admin");
    }
  }, [user, setLocation, isPlatformOwner]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error("Vennligst fyll inn e-post og passord");
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success("Innlogget!");
        await refetch();
        // Check if user is platform owner after login
        setTimeout(() => {
          window.location.href = "/saas-admin";
        }, 500);
      } else {
        toast.error(data.error || "Innlogging feilet");
      }
    } catch (error) {
      toast.error("Noe gikk galt. Prøv igjen.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading while checking auth status
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-gray-600">Laster...</p>
        </div>
      </div>
    );
  }

  // If logged in but not platform owner, show access denied
  const showAccessDenied = user && !isPlatformOwner;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo and Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 mb-4 shadow-lg">
            <Shield className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            Stylora
          </h1>
          <p className="text-xl font-semibold text-gray-700">Platform Admin</p>
        </div>

        {/* Login Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-gray-200">
          {showAccessDenied ? (
            // Access Denied Message
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Ingen tilgang
              </h2>
              <p className="text-gray-600 mb-6">
                Du har ikke tillatelse til å få tilgang til Platform Admin-panelet. 
                Dette området er kun for plattformeieren.
              </p>
              <div className="space-y-2">
                <Button
                  onClick={() => setLocation("/")}
                  variant="outline"
                  className="w-full"
                >
                  Gå til hjemmesiden
                </Button>
                <Button
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/saas-admin/login";
                  }}
                  variant="ghost"
                  className="w-full text-gray-600"
                >
                  Logg ut
                </Button>
              </div>
            </div>
          ) : (
            // Login Form
            <form onSubmit={handleLogin} className="space-y-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
                Velkommen tilbake
              </h2>
              <p className="text-gray-600 mb-6 text-center">
                Logg inn for å administrere alle salonger i plattformen
              </p>

              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Passord</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-6 text-lg shadow-lg hover:shadow-xl transition-all duration-200"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Logger inn...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-5 w-5" />
                    Logg inn som plattformeier
                  </>
                )}
              </Button>

              <div className="pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-500 text-center">
                  Kun plattformeieren har tilgang til dette området
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-500">
            Sikker innlogging med kryptert tilkobling
          </p>
        </div>
      </div>
    </div>
  );
}
