import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Calendar, Clock, User, CreditCard, Phone, Mail, Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function BookingSuccess() {
  const [, setLocation] = useLocation();
  const [bookingId, setBookingId] = useState<number | null>(null);

  useEffect(() => {
    // Get booking ID from URL query parameters
    const params = new URLSearchParams(window.location.search);
    const id = params.get("bookingId");
    if (id) {
      setBookingId(parseInt(id, 10));
    }
  }, []);

  const { data: booking, isLoading, error } = trpc.publicBooking.getBookingDetails.useQuery(
    { bookingId: bookingId! },
    { enabled: !!bookingId }
  );

  const handleAddToCalendar = () => {
    if (!booking) return;

    const startDate = new Date(booking.startTime);
    const endDate = new Date(booking.endTime);

    // Format dates for iCal
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    };

    const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${booking.serviceName} - Stylora
DESCRIPTION:Avtale hos Stylora\\nTjeneste: ${booking.serviceName}\\nFrisør: ${booking.employeeName || "Ingen preferanse"}
LOCATION:Stylora
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icalContent], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "stylora-booking.ics";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="p-8 text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-[#ff6b35] mb-4" />
          <p className="text-gray-600">Laster bookingdetaljer...</p>
        </Card>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">❌</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking ikke funnet</h2>
          <p className="text-gray-600 mb-6">
            Vi kunne ikke finne bookingdetaljene dine. Vennligst kontakt oss hvis du har spørsmål.
          </p>
          <Link href="/">
            <Button className="bg-gradient-to-r from-[#4a90e2] to-[#7b68ee] hover:opacity-90">
              <Home className="w-4 h-4 mr-2" />
              Tilbake til forsiden
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const startDate = new Date(booking.startTime);
  const formattedDate = startDate.toLocaleDateString("nb-NO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = startDate.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full mb-4 animate-bounce">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Betaling vellykket!</h1>
          <p className="text-xl text-gray-600">Din time er bekreftet</p>
        </div>

        {/* Booking Details Card */}
        <Card className="p-6 mb-6 shadow-lg">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-3 border-b">
            Bookingdetaljer
          </h2>

          <div className="space-y-4">
            {/* Booking Reference */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">Referansenummer</p>
              <p className="text-2xl font-bold text-gray-900">#{booking.id}</p>
            </div>

            {/* Service */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#4a90e2] to-[#7b68ee] rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white text-lg">✂️</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">Tjeneste</p>
                <p className="text-lg font-semibold text-gray-900">{booking.serviceName}</p>
              </div>
            </div>

            {/* Date */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#ff6b35] to-[#ff8c42] rounded-lg flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Dato</p>
                <p className="text-lg font-semibold text-gray-900 capitalize">{formattedDate}</p>
              </div>
            </div>

            {/* Time */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#50c878] to-[#3cb371] rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Tid</p>
                <p className="text-lg font-semibold text-gray-900">{formattedTime}</p>
              </div>
            </div>

            {/* Employee */}
            {booking.employeeName && (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-[#9b59b6] to-[#8e44ad] rounded-lg flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Frisør</p>
                  <p className="text-lg font-semibold text-gray-900">{booking.employeeName}</p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Payment Details Card */}
        <Card className="p-6 mb-6 shadow-lg">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-3 border-b">
            Betalingsinformasjon
          </h2>

          <div className="space-y-4">
            {/* Amount */}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Beløp betalt</span>
              <span className="text-2xl font-bold text-[#ff6b35]">
                {Number(booking.totalPrice).toFixed(2)} kr
              </span>
            </div>

            {/* Payment Method */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#4a90e2] to-[#7b68ee] rounded-lg flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Betalingsmetode</p>
                <p className="text-lg font-semibold text-gray-900">
                  {booking.paymentMethod === "stripe" ? "Kort (Stripe)" : "Vipps"}
                </p>
              </div>
            </div>

            {/* Status */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-green-800 font-medium text-center">
                ✓ Betaling bekreftet
              </p>
            </div>
          </div>
        </Card>

        {/* Customer Info Card */}
        <Card className="p-6 mb-6 shadow-lg">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-3 border-b">
            Dine opplysninger
          </h2>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-gray-400" />
              <span className="text-gray-900">{booking.customerName}</span>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-gray-400" />
              <span className="text-gray-900">{booking.customerPhone}</span>
            </div>
            {booking.customerEmail && (
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <span className="text-gray-900">{booking.customerEmail}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Management Link */}
        {booking.managementToken && (
          <Card className="p-6 mb-6 shadow-lg bg-blue-50 border-blue-200">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Administrer din booking
            </h2>
            <p className="text-gray-600 mb-4">
              Du kan endre eller avbestille timen din ved å bruke lenken nedenfor.
            </p>
            <Link href={`/manage-booking/${booking.managementToken}`}>
              <Button className="w-full bg-gradient-to-r from-[#4a90e2] to-[#7b68ee] hover:opacity-90 text-white">
                Administrer booking
              </Button>
            </Link>
          </Card>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Button
            onClick={handleAddToCalendar}
            className="flex-1 bg-gradient-to-r from-[#4a90e2] to-[#7b68ee] hover:opacity-90 text-white py-6 text-lg"
          >
            <Calendar className="w-5 h-5 mr-2" />
            Legg til i kalender
          </Button>
          <Link href="/" className="flex-1">
            <Button
              variant="outline"
              className="w-full border-2 border-[#ff6b35] text-[#ff6b35] hover:bg-[#ff6b35] hover:text-white py-6 text-lg"
            >
              <Home className="w-5 h-5 mr-2" />
              Tilbake til forsiden
            </Button>
          </Link>
        </div>

        {/* Help Text */}
        <div className="mt-8 text-center text-gray-600">
          <p className="mb-2">
            Du vil motta en bekreftelse på e-post og SMS kort tid før timen din.
          </p>
          <p className="text-sm">
            Har du spørsmål? Kontakt oss på{" "}
            <a href="tel:+4712345678" className="text-[#4a90e2] hover:underline">
              +47 123 45 678
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
