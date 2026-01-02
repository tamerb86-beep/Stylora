import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

// This is a MOCKUP/PREVIEW component to show the proposed UI design
export default function DomainSettingsMockup() {
  const [subdomain, setSubdomain] = useState("elegant-salon");
  const [isEditing, setIsEditing] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState("elegant-salon");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const bookingUrl = `https://${subdomain}.stylora.no/book`;

  const handleCopy = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubdomainChange = (value: string) => {
    // Clean input (lowercase, no spaces, only alphanumeric and hyphens)
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setNewSubdomain(cleaned);
    
    // Simulate availability check
    if (cleaned.length >= 3 && cleaned !== subdomain) {
      setChecking(true);
      setTimeout(() => {
        setChecking(false);
        setAvailable(Math.random() > 0.3); // Random for demo
      }, 500);
    } else {
      setAvailable(null);
    }
  };

  const handleSave = () => {
    // Simulate save
    setSubdomain(newSubdomain);
    setIsEditing(false);
    setAvailable(null);
  };

  const handleCancel = () => {
    setNewSubdomain(subdomain);
    setIsEditing(false);
    setAvailable(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            تصميم واجهة إعدادات الدومين
          </h1>
          <p className="text-muted-foreground">
            معاينة تبويب "الدومين" في صفحة الإعدادات
          </p>
          <Badge variant="outline" className="mt-2">
            <Globe className="w-3 h-3 mr-1" />
            Mockup / Preview
          </Badge>
        </div>

        {/* Current Domain Info Card */}
        <Card className="border-2 shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              <CardTitle>معلومات الدومين الحالي</CardTitle>
            </div>
            <CardDescription>
              الدومين الفرعي الخاص بصالونك ورابط صفحة الحجز
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Subdomain Display */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">الدومين الفرعي الحالي</p>
                  <p className="text-2xl font-bold text-blue-600">{subdomain}</p>
                </div>
                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  نشط
                </Badge>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="w-4 h-4" />
                <span>آخر تحديث: منذ 3 أيام</span>
              </div>
            </div>

            {/* Booking URL Section */}
            <div>
              <Label className="text-base font-semibold mb-3 block">رابط صفحة الحجز</Label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    value={bookingUrl}
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
                شارك هذا الرابط مع عملائك للحجز المباشر
              </p>
            </div>

            {/* QR Code Section */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border">
              <div className="w-24 h-24 bg-white border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center">
                <QrCode className="w-12 h-12 text-slate-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold mb-1">رمز QR لصفحة الحجز</p>
                <p className="text-sm text-muted-foreground mb-3">
                  اسمح للعملاء بمسح الرمز للوصول السريع لصفحة الحجز
                </p>
                <Button variant="outline" size="sm">
                  <QrCode className="w-4 h-4 mr-2" />
                  تحميل رمز QR
                </Button>
              </div>
            </div>

            {/* Edit Button */}
            {!isEditing && (
              <Button 
                onClick={() => setIsEditing(true)}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                <Globe className="w-4 h-4 mr-2" />
                تعديل الدومين الفرعي
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Edit Subdomain Card (shown when editing) */}
        {isEditing && (
          <Card className="border-2 border-blue-500 shadow-lg">
            <CardHeader>
              <CardTitle className="text-blue-600">تعديل الدومين الفرعي</CardTitle>
              <CardDescription>
                اختر دومين فرعي جديد لصالونك (3-63 حرف، حروف صغيرة وأرقام وشرطات فقط)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Warning Alert */}
              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  <strong>تنبيه:</strong> تغيير الدومين الفرعي سيؤثر على جميع الروابط المشاركة مع العملاء. 
                  تأكد من تحديث الروابط في جميع المواد التسويقية.
                </AlertDescription>
              </Alert>

              {/* Subdomain Input */}
              <div>
                <Label htmlFor="new-subdomain">الدومين الفرعي الجديد</Label>
                <div className="flex gap-2 mt-2">
                  <div className="flex-1 relative">
                    <Input
                      id="new-subdomain"
                      value={newSubdomain}
                      onChange={(e) => handleSubdomainChange(e.target.value)}
                      placeholder="my-salon"
                      className="font-mono"
                    />
                    {checking && (
                      <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-600" />
                    )}
                    {!checking && available === true && newSubdomain !== subdomain && (
                      <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-600" />
                    )}
                    {!checking && available === false && (
                      <XCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-600" />
                    )}
                  </div>
                  <div className="flex items-center px-3 bg-slate-100 rounded-md border text-sm text-muted-foreground">
                    .stylora.no
                  </div>
                </div>
                
                {/* Availability Status */}
                {!checking && available === true && newSubdomain !== subdomain && (
                  <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    متاح! يمكنك استخدام هذا الدومين
                  </p>
                )}
                {!checking && available === false && (
                  <p className="text-sm text-red-600 mt-2 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    غير متاح، الدومين مستخدم بالفعل
                  </p>
                )}
                {newSubdomain.length > 0 && newSubdomain.length < 3 && (
                  <p className="text-sm text-orange-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    يجب أن يكون 3 أحرف على الأقل
                  </p>
                )}
              </div>

              {/* Preview */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <p className="text-sm text-muted-foreground mb-1">معاينة الرابط الجديد</p>
                <p className="font-mono text-blue-600 font-semibold">
                  https://{newSubdomain || "subdomain"}.stylora.no/book
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!available || newSubdomain.length < 3 || newSubdomain === subdomain}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  <Check className="w-4 h-4 mr-2" />
                  حفظ التغييرات
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  className="flex-1"
                >
                  إلغاء
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">قواعد الدومين الفرعي</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <span>من 3 إلى 63 حرف</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <span>حروف صغيرة فقط (a-z)</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <span>أرقام (0-9) وشرطات (-)</span>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <span>لا يبدأ أو ينتهي بشرطة</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">نصائح مهمة</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <p>• اختر دومين سهل التذكر والكتابة</p>
              <p>• استخدم اسم صالونك أو موقعك</p>
              <p>• تجنب الأرقام الكثيرة</p>
              <p>• حدّث روابطك بعد التغيير</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
