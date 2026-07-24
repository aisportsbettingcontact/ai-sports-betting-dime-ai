import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.title = "Page not found — dıme";
  }, []);

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black">
      <Card className="w-full max-w-lg mx-4 shadow-lg border-0 bg-black">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full animate-pulse" style={{ background: "var(--brand-mint-surface)" }} />
              <AlertCircle className="relative h-16 w-16" style={{ color: "var(--primary)" }} aria-hidden="true" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white mb-2">404</h1>

          <h2 className="text-xl font-semibold text-white mb-4">
            Page not found
          </h2>

          <p className="text-white mb-8 leading-relaxed">
            This page doesn't exist. It may have been moved or deleted.
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="bg-[#45E0A8] text-black px-6 py-2.5 rounded-lg hover:opacity-85 transition-opacity duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            >
              <Home className="w-4 h-4 mr-2" />
              Go home
            </Button>
          </div>

          {/* Useful destinations instead of a dead end */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <a
              href="/feed/model/mlb"
              className="text-white underline hover:text-[#45E0A8] transition-colors"
            >
              Projections board
            </a>
            <a
              href="/#pricing"
              className="text-white underline hover:text-[#45E0A8] transition-colors"
            >
              Pricing
            </a>
            <a
              href="/login"
              className="text-white underline hover:text-[#45E0A8] transition-colors"
            >
              Log in
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
