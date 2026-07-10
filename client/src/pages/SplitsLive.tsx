/**
 * SplitsLive — public /splits page (aisportsbettingmodels.com/splits).
 * Renders the live VSiN MLB betting splits view (same component as the
 * mobile Splits tab) on an all-black page, centered at phone width on
 * larger screens. Data is public (games.liveSplits) — no auth required.
 */
import { MobileSplits } from "@/features/mobileOwnerTabs/screens/MobileSplits";

export default function SplitsLive() {
  return (
    <div style={{ minHeight: "100dvh", background: "#000000" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", height: "100dvh" }}>
        <MobileSplits />
      </div>
    </div>
  );
}
