import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { CheckCircle2, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function IZettleCallback() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const iZettleStatus = params.get("izettle");
    const errorMessage = params.get("message");

    if (iZettleStatus === "connected") {
      setStatus("success");
      setMessage("Din iZettle-konto er koblet til!");
    } else if (iZettleStatus === "error") {
      setStatus("error");
      setMessage(errorMessage || "Det oppstod en feil ved tilkobling av iZettle-kontoen din.");
    } else {
      // Invalid parameters, redirect to payment providers
      setTimeout(() => {
        setLocation("/payment-providers");
      }, 2000);
    }
  }, [setLocation]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-md">
          <Loader2 className="w-16 h-16 animate-spin mx-auto text-[#4a90e2] mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Behandler tilkobling...</h2>
          <p className="text-gray-600">Vennligst vent mens vi kobler til din iZettle-konto.</p>
        </Card>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-md">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Tilkobling vellykket!</h2>
          <p className="text-lg text-gray-600 mb-6">{message}</p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left">
            <h3 className="font-semibold text-gray-900 mb-2">Hva skjer nå?</h3>
            <ul className="text-sm text-gray-700 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>Din iZettle-konto er nå koblet til systemet</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>Du kan nå ta imot betalinger via iZettle</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>Alle transaksjoner vil bli synkronisert automatisk</span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/payment-providers" className="flex-1">
              <Button className="w-full bg-gradient-to-r from-[#4a90e2] to-[#7b68ee] hover:opacity-90">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Tilbake til betalingsleverandører
              </Button>
            </Link>
            <Link href="/dashboard" className="flex-1">
              <Button variant="outline" className="w-full">
                Gå til dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <Card className="p-8 text-center max-w-md">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-12 h-12 text-red-600" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Tilkobling mislyktes</h2>
        <p className="text-lg text-gray-600 mb-6">{message}</p>
        
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-gray-900 mb-2">Mulige årsaker:</h3>
          <ul className="text-sm text-gray-700 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>Du avbrøt tilkoblingsprosessen</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>iZettle-legitimasjonen er ugyldig</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">•</span>
              <span>Det oppstod et midlertidig problem med iZettle</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/payment-providers" className="flex-1">
            <Button className="w-full bg-gradient-to-r from-[#4a90e2] to-[#7b68ee] hover:opacity-90">
              Prøv igjen
            </Button>
          </Link>
          <Link href="/dashboard" className="flex-1">
            <Button variant="outline" className="w-full">
              Gå til dashboard
            </Button>
          </Link>
        </div>

        <p className="text-sm text-gray-500 mt-6">
          Trenger du hjelp? Kontakt oss på{" "}
          <a href="mailto:support@stylora.no" className="text-[#4a90e2] hover:underline">
            support@stylora.no
          </a>
        </p>
      </Card>
    </div>
  );
}
