"use client";

import { useState, useEffect } from "react";
import { FileSpreadsheet, Loader2, ExternalLink, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface ExportDialogProps {
  disabled?: boolean;
}

type DatePreset = "3" | "6" | "12" | "all";

export function ExportDialog({ disabled }: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>("12");
  const [hasGoogleAuth, setHasGoogleAuth] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    url: string;
    monthsIncluded: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check Google auth status when dialog opens
  useEffect(() => {
    if (open) {
      checkGoogleAuth();
    }
  }, [open]);

  // Check URL params for OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "true") {
      setOpen(true);
      setHasGoogleAuth(true);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    const googleError = params.get("google_error");
    if (googleError) {
      setOpen(true);
      setError(`Google connection failed: ${googleError}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function checkGoogleAuth() {
    setIsCheckingAuth(true);
    setError(null);
    try {
      const res = await fetch("/api/export/sheets");
      if (res.ok) {
        const data = await res.json();
        setHasGoogleAuth(data.hasGoogleAuth);
      }
    } catch (err) {
      console.error("Failed to check Google auth:", err);
    } finally {
      setIsCheckingAuth(false);
    }
  }

  async function connectGoogle() {
    setIsConnectingGoogle(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/google");
      if (res.ok) {
        const data = await res.json();
        // Redirect to Google OAuth
        window.location.href = data.authUrl;
      } else {
        throw new Error("Failed to initiate Google OAuth");
      }
    } catch (err) {
      setError("Failed to connect Google account");
      setIsConnectingGoogle(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    setError(null);
    setExportResult(null);

    try {
      const preset = datePreset === "all" ? 0 : parseInt(datePreset);
      const res = await fetch("/api/export/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Export failed");
      }

      const data = await res.json();
      setExportResult({
        url: data.spreadsheetUrl,
        monthsIncluded: data.monthsIncluded,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileSpreadsheet className="h-4 w-4 mr-1" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Financial Statement</DialogTitle>
          <DialogDescription>
            Generate a professional financial statement in Google Sheets with
            income, expenses, and net savings by month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Success State */}
          {exportResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-2 text-green-800 font-medium">
                  <FileSpreadsheet className="h-5 w-5" />
                  Spreadsheet Created!
                </div>
                <p className="text-sm text-green-700 mt-1">
                  Your financial statement with {exportResult.monthsIncluded} months of data is ready.
                </p>
              </div>
              <Button asChild className="w-full">
                <a
                  href={exportResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Google Sheets
                </a>
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setExportResult(null);
                  setDatePreset("12");
                }}
              >
                Create Another Export
              </Button>
            </div>
          )}

          {/* Export Form */}
          {!exportResult && (
            <>
              {/* Date Range Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Date Range</Label>
                <RadioGroup
                  value={datePreset}
                  onValueChange={(v) => setDatePreset(v as DatePreset)}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="3" id="3mo" />
                    <Label htmlFor="3mo" className="text-sm font-normal cursor-pointer">
                      Last 3 months
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="6" id="6mo" />
                    <Label htmlFor="6mo" className="text-sm font-normal cursor-pointer">
                      Last 6 months
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="12" id="12mo" />
                    <Label htmlFor="12mo" className="text-sm font-normal cursor-pointer">
                      Last 12 months
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="all" />
                    <Label htmlFor="all" className="text-sm font-normal cursor-pointer">
                      All available data
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Google Connection */}
              {isCheckingAuth ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking Google connection...
                </div>
              ) : !hasGoogleAuth ? (
                <div className="space-y-3">
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Link2 className="h-4 w-4" />
                      Connect Google Account
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      Required to create spreadsheets in your Google Drive.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={connectGoogle}
                      disabled={isConnectingGoogle}
                    >
                      {isConnectingGoogle ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>Connect Google</>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="flex items-center gap-2 text-sm text-green-800">
                    <Link2 className="h-4 w-4" />
                    Google account connected
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {/* Export Button */}
              <Button
                className="w-full"
                onClick={handleExport}
                disabled={!hasGoogleAuth || isExporting}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Spreadsheet...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Export to Google Sheets
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
