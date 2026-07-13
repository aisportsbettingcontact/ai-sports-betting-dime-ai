/**
 * AppLoadingShell — Branded loading state shown while lazy chunks load.
 *
 * This component is shown by the Suspense fallback in App.tsx while any
 * lazy-loaded page chunk is being fetched. It matches the HTML loading shell
 * in index.html so there is zero visual jump between the static HTML state
 * and the React-hydrated state.
 *
 * Design: dark background, centered logo icon + spinner — identical to the
 * HTML shell so the user sees a smooth continuous loading experience.
 */
export default function AppLoadingShell() {
  return (
    <div
      id="app-loading-shell"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        zIndex: 9999,
      }}
    >
      {/* Logo icon — matches the HTML shell */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          background: "#45E0A8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
          boxShadow: "none",
        }}
      >
        {/* Bar chart icon — SVG, no external deps */}
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#000000"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      </div>
      {/* CSS spinner — no JS required, renders immediately */}
      <div
        style={{
          width: 24,
          height: 24,
          border: "2px solid #FFFFFF",
          borderTopColor: "#45E0A8",
          borderRadius: "50%",
          animation: "app-shell-spin 0.7s linear infinite",
        }}
      />
      <style>{`
        @keyframes app-shell-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
