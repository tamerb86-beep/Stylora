import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Star, Gift, TrendingUp, Clock, CheckCircle, XCircle, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { toast } from "sonner";

export default function LoyaltyCustomer() {
  const [selectedTab, setSelectedTab] = useState<"rewards" | "history" | "redemptions">("rewards");
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any>(null);

  // Get tenant ID from URL or context
  const tenantId = new URLSearchParams(window.location.search).get("tenantId") || "demo-tenant-stylora";

  // Fetch customer points
  const { data: pointsData, isLoading: pointsLoading, refetch: refetchPoints } = trpc.loyalty.getCustomerPoints.useQuery({
    tenantId,
  });

  // Fetch available rewards
  const { data: rewards = [], isLoading: rewardsLoading } = trpc.loyalty.getAvailableRewards.useQuery({
    tenantId,
  });

  // Fetch transaction history
  const { data: transactions = [], isLoading: transactionsLoading } = trpc.loyalty.getTransactionHistory.useQuery({
    tenantId,
  });

  // Fetch active redemptions
  const { data: redemptions = [], isLoading: redemptionsLoading } = trpc.loyalty.getActiveRedemptions.useQuery({
    tenantId,
  });

  // Redeem reward mutation
  const redeemMutation = trpc.loyalty.redeemReward.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setRedeemDialogOpen(false);
      refetchPoints();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to redeem reward");
    },
  });

  const handleRedeemClick = (reward: any) => {
    setSelectedReward(reward);
    setRedeemDialogOpen(true);
  };

  const handleRedeemConfirm = () => {
    if (selectedReward) {
      redeemMutation.mutate({
        tenantId,
        rewardId: selectedReward.id,
      });
    }
  };

  const currentPoints = pointsData?.currentPoints || 0;
  const lifetimePoints = pointsData?.lifetimePoints || 0;

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header with Points Balance */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Lojalitetsprogram</h1>
        <p className="text-gray-600">Tjen poeng og få eksklusive belønninger</p>
      </div>

      {/* Points Card */}
      <Card className="mb-8 bg-gradient-to-br from-purple-500 to-pink-500 text-white border-0">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm mb-1">Dine poeng</p>
              <h2 className="text-5xl font-bold mb-2">{currentPoints}</h2>
              <p className="text-white/90 text-sm">
                <TrendingUp className="inline h-4 w-4 mr-1" />
                {lifetimePoints} poeng totalt tjent
              </p>
            </div>
            <div className="bg-white/20 p-4 rounded-full">
              <Star className="h-12 w-12" fill="currentColor" />
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/20">
            <p className="text-white/90 text-sm">
              💡 Tjen 1 poeng for hver 100 kr du bruker
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="rewards">
            <Gift className="h-4 w-4 mr-2" />
            Belønninger
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="h-4 w-4 mr-2" />
            Historikk
          </TabsTrigger>
          <TabsTrigger value="redemptions">
            <Sparkles className="h-4 w-4 mr-2" />
            Mine kupongkoder
          </TabsTrigger>
        </TabsList>

        {/* Rewards Tab */}
        <TabsContent value="rewards">
          {rewardsLoading ? (
            <div className="text-center py-12 text-gray-500">Laster belønninger...</div>
          ) : rewards.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Gift className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600">Ingen belønninger tilgjengelig for øyeblikket</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rewards.map((reward: any) => {
                const canAfford = currentPoints >= reward.pointsCost;
                const discountText =
                  reward.discountType === "percentage"
                    ? `${reward.discountValue}% rabatt`
                    : `${reward.discountValue} kr rabatt`;

                return (
                  <Card key={reward.id} className={!canAfford ? "opacity-60" : ""}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">{reward.name}</CardTitle>
                          <CardDescription className="mt-1">{reward.description}</CardDescription>
                        </div>
                        <Badge variant="secondary" className="ml-2">
                          {reward.pointsCost} poeng
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="bg-purple-50 border border-purple-200 rounded-md p-3 text-center">
                          <p className="text-2xl font-bold text-purple-600">{discountText}</p>
                        </div>

                        <Button
                          className="w-full"
                          disabled={!canAfford}
                          onClick={() => handleRedeemClick(reward)}
                        >
                          {canAfford ? "Løs inn" : `Trenger ${reward.pointsCost - currentPoints} poeng til`}
                        </Button>

                        <p className="text-xs text-gray-500 text-center">
                          Gyldig i {reward.validityDays} dager etter innløsning
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          {transactionsLoading ? (
            <div className="text-center py-12 text-gray-500">Laster historikk...</div>
          ) : transactions.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Clock className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600">Ingen transaksjoner ennå</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {transactions.map((transaction: any) => {
                    const isEarn = transaction.type === "earn";
                    const isPositive = transaction.points > 0;

                    return (
                      <div key={transaction.id} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2 rounded-full ${
                                isEarn ? "bg-green-100 text-green-600" : "bg-purple-100 text-purple-600"
                              }`}
                            >
                              {isEarn ? <TrendingUp className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
                            </div>
                            <div>
                              <p className="font-medium">{transaction.reason}</p>
                              <p className="text-sm text-gray-500">
                                {format(new Date(transaction.createdAt), "d. MMM yyyy 'kl.' HH:mm", { locale: nb })}
                              </p>
                            </div>
                          </div>
                          <div className={`text-lg font-semibold ${isPositive ? "text-green-600" : "text-red-600"}`}>
                            {isPositive ? "+" : ""}
                            {transaction.points}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Redemptions Tab */}
        <TabsContent value="redemptions">
          {redemptionsLoading ? (
            <div className="text-center py-12 text-gray-500">Laster kupongkoder...</div>
          ) : redemptions.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Sparkles className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600">Du har ingen aktive kupongkoder</p>
                <p className="text-sm text-gray-500 mt-2">Løs inn belønninger for å få kupongkoder</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {redemptions.map((redemption: any) => {
                const isExpired = new Date(redemption.expiresAt) < new Date();
                const discountText =
                  redemption.discountType === "percentage"
                    ? `${redemption.discountValue}% rabatt`
                    : `${redemption.discountValue} kr rabatt`;

                return (
                  <Card key={redemption.id} className={isExpired ? "opacity-60" : ""}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{redemption.rewardName}</CardTitle>
                          <CardDescription>{redemption.rewardDescription}</CardDescription>
                        </div>
                        <Badge variant={isExpired ? "destructive" : "default"}>
                          {isExpired ? "Utløpt" : "Aktiv"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-md p-4">
                          <p className="text-xs text-gray-600 mb-1">Kupongkode</p>
                          <p className="text-2xl font-mono font-bold text-purple-600 tracking-wider">
                            {redemption.code}
                          </p>
                        </div>

                        <div className="bg-purple-50 border border-purple-200 rounded-md p-3 text-center">
                          <p className="text-xl font-bold text-purple-600">{discountText}</p>
                        </div>

                        <div className="text-sm text-gray-600">
                          <p>
                            <strong>Utløper:</strong>{" "}
                            {format(new Date(redemption.expiresAt), "d. MMM yyyy", { locale: nb })}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Vis denne koden til personalet når du betaler
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Redeem Confirmation Dialog */}
      <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bekreft innløsning</DialogTitle>
            <DialogDescription>
              Er du sikker på at du vil løse inn denne belønningen?
            </DialogDescription>
          </DialogHeader>

          {selectedReward && (
            <div className="space-y-4 py-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">{selectedReward.name}</h3>
                <p className="text-sm text-gray-600 mb-3">{selectedReward.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Kostnad:</span>
                  <Badge variant="secondary">{selectedReward.pointsCost} poeng</Badge>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-gray-600">Dine poeng etter:</span>
                  <span className="font-semibold">{currentPoints - selectedReward.pointsCost} poeng</span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">
                  Du vil motta en unik kupongkode som kan brukes i {selectedReward.validityDays} dager.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeemDialogOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={handleRedeemConfirm} disabled={redeemMutation.isPending}>
              {redeemMutation.isPending ? "Løser inn..." : "Bekreft innløsning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
