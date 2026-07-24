/**
 * IngestAnOdds — Owner-only page for pasting Action Network "All Markets" HTML
 * and ingesting Open + DK NJ odds for all games on a given date.
 *
 * Instructions:
 *   1. Go to https://www.actionnetwork.com/ncaab/odds?oddsType=combined
 *   2. Select "All Markets" from the market dropdown
 *   3. Select-all and copy the full page HTML (or just the <tbody> of the odds table)
 *   4. Paste it into the textarea below and click "Ingest"
 *
 * Access: owner role only — non-owners are immediately redirected to /dashboard.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, AlertCircle, ClipboardPaste } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayEst(): string {
  const now = new Date();
  // Use ET offset: UTC-5 (EST) or UTC-4 (EDT)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const estMs = utcMs - 5 * 3600000; // use EST (UTC-5) as conservative default
  const d = new Date(estMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IngestAnOdds() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading, isOwner } = useAppAuth();

  const [html, setHtml] = useState("");
  const [gameDate, setGameDate] = useState(todayEst());
  const [sport, setSport] = useState<"NBA" | "NHL">("NBA");

  const ingestMutation = trpc.games.ingestAnHtml.useMutation({
    onSuccess: (data) => {
      if (data.errors.length > 0) {
        toast.warning(
          `Ingested ${data.updated} games — ${data.skipped} skipped. See details below.`
        );
      } else {
        toast.success(`Successfully ingested odds for ${data.updated} games!`);
      }
    },
    onError: (err) => {
      toast.error(`Ingestion failed: ${err.message}`);
    },
  });

  // Auth guard — MUST be useEffect, never render body (render-phase navigate crashes React 19)
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      console.warn(`[IngestAnOdds] Unauthorized: user=${appUser?.username ?? "unauthenticated"} isOwner=${isOwner} → redirecting`);
      navigate(appUser ? "/feed/model/mlb" : "/");
    }
  }, [authLoading, appUser, isOwner, navigate]);

  const handleIngest = () => {
    if (!html.trim()) {
      toast.error("Please paste the Action Network HTML first.");
      return;
    }
    if (!gameDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      toast.error("Invalid date format. Use YYYY-MM-DD.");
      return;
    }
    ingestMutation.mutate({ html, gameDate, sport });
  };

  const result = ingestMutation.data;
  const isLoading = ingestMutation.isPending;

  return (
    <AdminShell active="ingest">
      <div className="admin-container py-6 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Ingest AN Odds</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Action Network — All Markets (Open + DK NJ)
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            Owner Only
          </Badge>
        </div>

        {/* Instructions */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-primary" />
              Instructions
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Go to{" "}
                <a
                  href="https://www.actionnetwork.com/ncaab/odds?oddsType=combined"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  actionnetwork.com/ncaab/odds?oddsType=combined
                </a>
              </li>
              <li>
                Select <strong>All Markets</strong> from the market type dropdown
              </li>
              <li>
                Right-click the odds table → <strong>Inspect</strong> → select the{" "}
                <code className="bg-muted px-1 rounded text-xs">&lt;tbody&gt;</code> element →{" "}
                <strong>Copy → Copy outerHTML</strong>
              </li>
              <li>Paste the HTML into the textarea below</li>
              <li>Confirm the date and sport, then click <strong>Ingest</strong></li>
            </ol>
          </CardContent>
        </Card>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="gameDate" className="text-sm font-medium">
              Game Date
            </Label>
            <Input
              id="gameDate"
              type="date"
              value={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Sport</Label>
            <Select
              value={sport}
              onValueChange={(v) => setSport(v as "NBA" | "NHL")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NBA">NBA</SelectItem>
                <SelectItem value="NHL">NHL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* HTML Paste Area */}
        <div className="space-y-1.5">
          <Label htmlFor="html-paste" className="text-sm font-medium">
            Action Network HTML
          </Label>
          <Textarea
            id="html-paste"
            placeholder="Paste the Action Network All Markets <tbody> HTML here..."
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            className="font-mono text-xs min-h-[200px] resize-y bg-muted border-border"
          />
          {html && (
            <p className="text-xs text-muted-foreground">
              {html.length.toLocaleString()} characters pasted
            </p>
          )}
        </div>

        {/* Ingest Button */}
        <Button
          onClick={handleIngest}
          disabled={isLoading || !html.trim()}
          className="w-full font-semibold"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Ingesting...
            </>
          ) : (
            <>
              <ClipboardPaste className="h-4 w-4 mr-2" />
              Ingest AN Odds
            </>
          )}
        </Button>

        {/* Result */}
        {result && (
          <Card
            className={`border-2 ${
              result.errors.length === 0
                ? "border-primary bg-primary"
                : "border-border bg-card"
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                {result.errors.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-foreground" />
                )}
                Ingestion Result
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Updated:</span>
                  <Badge className="bg-primary text-primary-foreground border-primary">
                    {result.updated}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Skipped:</span>
                  <Badge
                    className={
                      result.skipped > 0
                        ? "bg-card text-foreground border-border"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {result.skipped}
                  </Badge>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">
                    Errors ({result.errors.length}):
                  </p>
                  <div className="bg-muted rounded p-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs font-mono text-foreground">
                        {e}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Parser Warnings ({result.warnings.length}):
                  </p>
                  <div className="bg-muted rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <p key={i} className="text-xs font-mono text-muted-foreground">
                        {w}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
