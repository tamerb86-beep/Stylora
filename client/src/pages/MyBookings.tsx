import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Calendar, Clock, User, Scissors, XCircle, CheckCircle, AlertCircle, Info, CalendarClock, History } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { toast } from "sonner";

export default function MyBookings() {
  const [selectedTab, setSelectedTab] = useState<"upcoming" | "past" | "canceled" | "all">("upcoming");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<number | null>(null);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [selectedBookingForReschedule, setSelectedBookingForReschedule] = useState<any>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedBookingForHistory, setSelectedBookingForHistory] = useState<number | null>(null);

  // Get tenant ID from URL or context (for now, hardcoded - should come from context)
  const tenantId = new URLSearchParams(window.location.search).get("tenantId") || "demo-tenant-stylora";

  // Fetch bookings
  const { data: bookings = [], isLoading, refetch } = trpc.myBookings.list.useQuery({
    tenantId,
    status: selectedTab,
  });

  // Fetch cancellation policy
  const { data: policy } = trpc.myBookings.getCancellationPolicy.useQuery({ tenantId });

  // Cancel booking mutation
  const cancelMutation = trpc.myBookings.cancel.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      if (data.isLateCancellation) {
        toast.warning("This was a late cancellation. Cancellation fees may apply.");
      }
      refetch();
      setCancelDialogOpen(false);
      setSelectedBooking(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to cancel booking");
    },
  });

  // Reschedule booking mutation
  const rescheduleMutation = trpc.myBookings.reschedule.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
      setRescheduleDialogOpen(false);
      setSelectedBooking(null);
      setSelectedBookingForReschedule(null);
      setNewDate("");
      setNewTime("");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reschedule booking");
    },
  });

  // Fetch available time slots when date changes
  const { data: availableSlots = [], isLoading: slotsLoading } = trpc.myBookings.getAvailableTimeSlots.useQuery(
    {
      tenantId,
      appointmentId: selectedBooking || 0,
      date: newDate,
    },
    {
      enabled: !!selectedBooking && !!newDate,
    }
  );

  // Fetch appointment history
  const { data: appointmentHistory = [], isLoading: historyLoading } = trpc.myBookings.getAppointmentHistory.useQuery(
    {
      tenantId,
      appointmentId: selectedBookingForHistory || 0,
    },
    {
      enabled: !!selectedBookingForHistory && historyDialogOpen,
    }
  );

  const handleCancelClick = (bookingId: number) => {
    setSelectedBooking(bookingId);
    setCancelDialogOpen(true);
  };

  const handleCancelConfirm = () => {
    if (selectedBooking) {
      cancelMutation.mutate({
        tenantId,
        appointmentId: selectedBooking,
        reason: "Canceled by customer via My Bookings page",
      });
    }
  };

  const handleRescheduleClick = (booking: any) => {
    setSelectedBooking(booking.id);
    setSelectedBookingForReschedule(booking);
    // Pre-fill with current date/time
    const currentDate = new Date(booking.appointmentDate);
    setNewDate(currentDate.toISOString().split('T')[0]);
    setNewTime(booking.startTime.slice(0, 5)); // Remove seconds
    setRescheduleDialogOpen(true);
  };

  const handleHistoryClick = (bookingId: number) => {
    setSelectedBookingForHistory(bookingId);
    setHistoryDialogOpen(true);
  };

  const handleRescheduleConfirm = () => {
    if (selectedBooking && newDate && newTime) {
      // Validate that new date/time is in the future
      const newDateTime = new Date(`${newDate}T${newTime}:00`);
      if (newDateTime <= new Date()) {
        toast.error("Ny tid må være i fremtiden");
        return;
      }

      rescheduleMutation.mutate({
        tenantId,
        appointmentId: selectedBooking,
        newDate,
        newTime,
      });
    } else {
      toast.error("Vennligst velg både dato og tid");
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      pending: { variant: "outline", icon: <Clock className="h-3 w-3 mr-1" /> },
      confirmed: { variant: "default", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      completed: { variant: "secondary", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      canceled: { variant: "destructive", icon: <XCircle className="h-3 w-3 mr-1" /> },
      no_show: { variant: "destructive", icon: <AlertCircle className="h-3 w-3 mr-1" /> },
    };

    const config = variants[status] || variants.pending;

    return (
      <Badge variant={config.variant} className="flex items-center w-fit">
        {config.icon}
        {status === "pending" && "Venter"}
        {status === "confirmed" && "Bekreftet"}
        {status === "completed" && "Fullført"}
        {status === "canceled" && "Kansellert"}
        {status === "no_show" && "Ikke møtt"}
      </Badge>
    );
  };

  const canCancel = (booking: any) => {
    if (booking.status === "canceled" || booking.status === "completed" || booking.status === "no_show") {
      return false;
    }

    // Check if appointment is in the future
    const appointmentDateTime = new Date(booking.appointmentDate);
    const [hours, minutes] = String(booking.startTime).split(":").map(Number);
    appointmentDateTime.setHours(hours, minutes, 0, 0);

    return appointmentDateTime > new Date();
  };

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Laster dine bookinger...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          Mine Bookinger
        </h1>
        <p className="text-gray-600">Se og administrer dine avtaler</p>
      </div>

      {/* Cancellation Policy Info */}
      {policy && (
        <Card className="mb-6 border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-700">
                <p className="font-medium mb-1">Kanselleringsregler:</p>
                <p>
                  Du kan kansellere bookingen din gratis frem til <strong>{policy.cancellationWindowHours} timer</strong> før avtalt tid.
                  Kansellering med kortere varsel kan medføre gebyr.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="upcoming">Kommende</TabsTrigger>
          <TabsTrigger value="past">Tidligere</TabsTrigger>
          <TabsTrigger value="canceled">Kansellert</TabsTrigger>
          <TabsTrigger value="all">Alle</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab} className="space-y-4">
          {bookings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 text-lg">Ingen bookinger funnet</p>
                <p className="text-gray-500 text-sm mt-2">
                  {selectedTab === "upcoming" && "Du har ingen kommende avtaler"}
                  {selectedTab === "past" && "Du har ingen tidligere avtaler"}
                  {selectedTab === "canceled" && "Du har ingen kansellerte avtaler"}
                  {selectedTab === "all" && "Du har ingen bookinger ennå"}
                </p>
              </CardContent>
            </Card>
          ) : (
            bookings.map((booking: any) => (
              <Card key={booking.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-xl">
                        {format(new Date(booking.appointmentDate), "EEEE, d. MMMM yyyy", { locale: nb })}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {booking.startTime} - {booking.endTime}
                      </CardDescription>
                    </div>
                    {getStatusBadge(booking.status)}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Employee */}
                  {booking.employeeName && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <User className="h-4 w-4 text-gray-500" />
                      <span className="font-medium">{booking.employeeName}</span>
                    </div>
                  )}

                  {/* Services */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-gray-700 font-medium">
                      <Scissors className="h-4 w-4 text-gray-500" />
                      <span>Tjenester:</span>
                    </div>
                    <div className="ml-6 space-y-1">
                      {booking.services.map((service: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span>{service.serviceName}</span>
                          <div className="flex items-center gap-3 text-gray-600">
                            <span>{service.serviceDuration} min</span>
                            <span className="font-medium">{parseFloat(service.servicePrice).toFixed(0)} kr</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Total Price */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="font-semibold">Totalt:</span>
                    <span className="text-lg font-bold text-blue-600">
                      {booking.services.reduce((sum: number, s: any) => sum + parseFloat(s.servicePrice), 0).toFixed(0)} kr
                    </span>
                  </div>

                  {/* Notes */}
                  {booking.notes && (
                    <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md">
                      <p className="font-medium mb-1">Notater:</p>
                      <p>{booking.notes}</p>
                    </div>
                  )}

                  {/* Cancellation Info */}
                  {booking.status === "canceled" && (
                    <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                      <p className="font-medium mb-1">Kansellert:</p>
                      <p>{booking.cancellationReason}</p>
                      {booking.canceledAt && (
                        <p className="text-xs text-red-500 mt-1">
                          {format(new Date(booking.canceledAt), "d. MMM yyyy 'kl.' HH:mm", { locale: nb })}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Reschedule Limit Warning */}
                  {booking.rescheduleCount > 0 && booking.status !== "canceled" && (
                    <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md flex items-start gap-2">
                      <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Endringer brukt: {booking.rescheduleCount} av 2</p>
                        {booking.rescheduleCount >= 2 && (
                          <p className="text-xs mt-1">Du har nådd maksimalt antall endringer for denne bookingen.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    {canCancel(booking) && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRescheduleClick(booking)}
                          className="w-full sm:w-auto"
                          disabled={booking.rescheduleCount >= 2}
                        >
                          <CalendarClock className="h-4 w-4 mr-2" />
                          Endre tid
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancelClick(booking.id)}
                          className="w-full sm:w-auto"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Kanseller booking
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleHistoryClick(booking.id)}
                      className="w-full sm:w-auto"
                    >
                      <History className="h-4 w-4 mr-2" />
                      Historikk
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kanseller booking?</AlertDialogTitle>
            <AlertDialogDescription>
              Er du sikker på at du vil kansellere denne bookingen? Denne handlingen kan ikke angres.
              {policy && (
                <p className="mt-2 text-amber-600 font-medium">
                  Merk: Kansellering med mindre enn {policy.cancellationWindowHours} timers varsel kan medføre gebyr.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              className="bg-red-600 hover:bg-red-700"
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Kansellerer..." : "Ja, kanseller"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endre tidspunkt</DialogTitle>
            <DialogDescription>
              Velg ny dato og tid for din booking. Vennligst merk at endringer må gjøres minst {policy?.cancellationWindowHours || 24} timer før avtalt tid.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-date">Ny dato</Label>
              <Input
                id="new-date"
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-time">Ny tid</Label>
              {slotsLoading ? (
                <div className="text-sm text-gray-500 py-2">Laster ledige tider...</div>
              ) : availableSlots.length > 0 ? (
                <select
                  id="new-time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Velg et tidspunkt</option>
                  {availableSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              ) : newDate ? (
                <div className="text-sm text-red-600 py-2">
                  Ingen ledige tider tilgjengelig for denne datoen.
                </div>
              ) : (
                <div className="text-sm text-gray-500 py-2">
                  Velg en dato først for å se ledige tider.
                </div>
              )}
            </div>

            {policy && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                <p className="text-sm text-amber-800">
                  <strong>Viktig:</strong> Du kan kun endre tidspunkt frem til {policy.cancellationWindowHours} timer før avtalt tid.
                  Endringer med kortere varsel må gjøres ved å kontakte salongen direkte.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleRescheduleConfirm}
              disabled={rescheduleMutation.isPending || !newDate || !newTime}
            >
              {rescheduleMutation.isPending ? "Endrer..." : "Bekreft endring"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historikk</DialogTitle>
            <DialogDescription>
              Alle endringer som er gjort på denne bookingen
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {historyLoading ? (
              <div className="text-center py-8 text-gray-500">Laster historikk...</div>
            ) : appointmentHistory.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p>Ingen endringer registrert</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

                {/* History items */}
                <div className="space-y-6">
                  {appointmentHistory.map((record: any, idx: number) => {
                    const isFirst = idx === 0;
                    const changeTypeLabels: Record<string, string> = {
                      created: "Opprettet",
                      rescheduled: "Endret tidspunkt",
                      status_changed: "Status endret",
                      service_changed: "Tjeneste endret",
                      employee_changed: "Ansatt endret",
                      canceled: "Kansellert",
                      notes_updated: "Notater oppdatert",
                    };

                    const changeTypeIcons: Record<string, any> = {
                      created: CheckCircle,
                      rescheduled: CalendarClock,
                      status_changed: AlertCircle,
                      service_changed: Scissors,
                      employee_changed: User,
                      canceled: XCircle,
                      notes_updated: Info,
                    };

                    const changeTypeColors: Record<string, string> = {
                      created: "text-green-600 bg-green-50 border-green-200",
                      rescheduled: "text-blue-600 bg-blue-50 border-blue-200",
                      status_changed: "text-amber-600 bg-amber-50 border-amber-200",
                      service_changed: "text-purple-600 bg-purple-50 border-purple-200",
                      employee_changed: "text-indigo-600 bg-indigo-50 border-indigo-200",
                      canceled: "text-red-600 bg-red-50 border-red-200",
                      notes_updated: "text-gray-600 bg-gray-50 border-gray-200",
                    };

                    const IconComponent = changeTypeIcons[record.changeType] || Info;
                    const colorClass = changeTypeColors[record.changeType] || "text-gray-600 bg-gray-50 border-gray-200";

                    let oldValue, newValue;
                    try {
                      oldValue = record.oldValue ? JSON.parse(record.oldValue) : null;
                      newValue = record.newValue ? JSON.parse(record.newValue) : null;
                    } catch {
                      oldValue = record.oldValue;
                      newValue = record.newValue;
                    }

                    return (
                      <div key={record.id} className="relative flex gap-4">
                        {/* Timeline dot */}
                        <div className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 ${colorClass} ${isFirst ? 'ring-4 ring-blue-100' : ''}`}>
                          <IconComponent className="h-4 w-4" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 pb-6">
                          <div className="bg-white border rounded-lg p-4 shadow-sm">
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">
                                {changeTypeLabels[record.changeType] || record.changeType}
                              </h4>
                              <span className="text-xs text-gray-500">
                                {format(new Date(record.createdAt), "d. MMM yyyy 'kl.' HH:mm", { locale: nb })}
                              </span>
                            </div>

                            {/* Change details */}
                            {record.changeType === "rescheduled" && oldValue && newValue && (
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-600">Fra:</span>
                                  <span className="text-gray-900 font-medium">
                                    {oldValue.date} kl. {oldValue.time}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-600">Til:</span>
                                  <span className="text-blue-600 font-medium">
                                    {newValue.date} kl. {newValue.time}
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Changed by */}
                            <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                              <span>
                                Endret av: {record.changedBy === "customer" ? "Kunde" : record.changedBy === "staff" ? "Personale" : "System"}
                              </span>
                              {record.changedByEmail && (
                                <span className="ml-2">({record.changedByEmail})</span>
                              )}
                            </div>

                            {/* Notes */}
                            {record.notes && (
                              <div className="mt-2 text-xs text-gray-600 italic">
                                {record.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
