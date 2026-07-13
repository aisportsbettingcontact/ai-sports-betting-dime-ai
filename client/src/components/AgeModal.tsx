// AgeModal - Age & Responsibility Notice modal
// Design: AI Sports Betting dark theme - centered modal with warning icon

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgeModalProps {
  onAccept: () => void;
  onClose: () => void;
}

export function AgeModal({ onAccept, onClose }: AgeModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-white flex-shrink-0" />
          <h2 className="text-base font-bold text-foreground">Age & responsibility notice</h2>
        </div>

        {/* Body */}
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          <span className="text-foreground font-semibold">Dime</span> provides sports betting
          analysis and data for <span className="italic">informational purposes only</span>.
        </p>

        <ul className="space-y-1.5 mb-4">
          {[
            "You must be 21+ years old to use this service",
            "We do not facilitate wagering or accept bets",
            "All odds data is for analysis only",
            "Gamble responsibly — never bet more than you can afford",
            "If you need help: 1-800-GAMBLER",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
          By continuing, you confirm you meet the age requirements and understand this is an
          analytical tool, not a gambling platform.
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={onAccept}
            className="flex-1 bg-primary text-primary-foreground font-semibold text-sm"
          >
            I understand &amp; accept
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="px-4 text-sm border-border text-muted-foreground hover:text-foreground"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
