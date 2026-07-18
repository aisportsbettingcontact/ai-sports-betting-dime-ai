/**
 * MobileProps — MLB strikeout props (K-Props).
 * One card per pitcher prop: name, matchup + time as the quiet second line,
 * then a row of stat blocks — LINE / BOOK / MODEL K / EDGE.
 *
 * Data (all public tRPC):
 *   - games.getCurrentDate → effectiveDate (server-authoritative slate date)
 *   - games.list { sport: "MLB", gameDate } → today's slate
 *   - strikeoutProps.getByGames { gameIds } → propsByGame record
 * Nothing is rendered that isn't in those payloads.
 *
 * Brand law (design-system/dime-ai/MASTER.md): Familjen Grotesk for all
 * content, IBM Plex Mono only for 10px micro-labels, mint ONLY where the
 * model verdict says EDGE, var(--dime-*) tokens for both themes.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { MobileDataState } from "../components/MobileDataState";
import { Target } from "lucide-react";

// ─── Formatting helpers (mirror MlbPropsCard.tsx semantics) ──────────────────

function fmtNum(val: string | null | undefined, decimals = 1): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function fmtOdds(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseInt(val, 10);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : String(n);
}

function nickname(abbrev: string | null | undefined): string {
  if (!abbrev) return "TBD";
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.nickname ?? abbrev;
}

/** "13:35" → "1:35 PM ET" — same house format as the feed and splits pages. */
function formatStartTime(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  if (isNaN(h) || isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix} ET`;
}

/** MLB static CDN headshot by MLBAM id — same URL the results pages use. */
function mlbPhoto(id: number | null | undefined): string | null {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_360,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
}

// ─── Local styles (Dime tokens; light + dark via :root / html.dark) ──────────

const sans = "var(--dime-font-sans)";

const microLabel: React.CSSProperties = {
  fontFamily: "var(--dime-font-mono)",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  // secondary, not muted: dark-mode muted (#6a6a78) is under 4.5:1 on the card
  color: "var(--dime-text-secondary)",
  whiteSpace: "nowrap",
};

const statValue: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 17,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.2,
  color: "var(--dime-text-primary)",
  whiteSpace: "nowrap",
};

// ─── Card view-model ──────────────────────────────────────────────────────────

interface KPropCard {
  key: number;
  pitcherName: string;
  /** MLBAM player id for the MLB static CDN headshot (null → monogram) */
  mlbamId: number | null;
  /** Quiet second line: hand · Own vs Opp · time */
  subline: string;
  /** Book line (fallback: model line) for the o/u block */
  line: string;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  kProj: string | null;
  /** Best-side edge in percentage points, if the model produced one */
  edgePp: number | null;
  /** 'OVER' | 'UNDER' lean, if present */
  lean: string | null;
  /** Mint signal: verdict === 'EDGE' per the data */
  hasSignal: boolean;
}

function StatBlock({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        alignItems: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <span style={microLabel}>{label}</span>
      {children}
    </div>
  );
}

function PropCard({ card }: { card: KPropCard }) {
  return (
    <article
      aria-label={`${card.pitcherName} strikeout prop`}
      style={{
        background: "var(--dime-surface-card)",
        border: "1px solid var(--dime-border)",
        borderLeft: card.hasSignal
          ? "3px solid var(--dime-mint)"
          : "1px solid var(--dime-border)",
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 44,
      }}
    >
      {/* Headshot + pitcher name + quiet matchup line */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
      >
        {(() => {
          const photo = mlbPhoto(card.mlbamId);
          return (
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                overflow: "hidden",
                flexShrink: 0,
                background: "var(--dime-surface-raised)",
                border: "1px solid var(--dime-border)",
              }}
            >
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={e => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: sans,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--dime-text-secondary)",
                  }}
                >
                  {card.pitcherName
                    .split(/\s+/)
                    .map(w => w[0] ?? "")
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              )}
            </div>
          );
        })()}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: sans,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.1px",
              color: "var(--dime-text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {card.pitcherName}
          </h2>
          <p
            style={{
              margin: 0,
              fontFamily: sans,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--dime-text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {card.subline}
          </p>
        </div>
      </div>

      {/* Stat row: LINE / BOOK / MODEL K / EDGE */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <StatBlock label="Line">
          <span style={statValue}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--dime-text-secondary)",
              }}
            >
              o/u{" "}
            </span>
            {card.line}
          </span>
        </StatBlock>

        <StatBlock label="Book">
          <span style={statValue}>
            {fmtOdds(card.bookOverOdds)}
            <span
              style={{ color: "var(--dime-text-secondary)", fontWeight: 600 }}
            >
              /
            </span>
            {fmtOdds(card.bookUnderOdds)}
          </span>
        </StatBlock>

        <StatBlock label="Model K">
          <span style={statValue}>{fmtNum(card.kProj, 1)}</span>
        </StatBlock>

        <StatBlock
          label={card.lean ? `${card.lean} edge` : "Edge"}
          align="right"
        >
          {card.edgePp != null ? (
            <span
              style={{
                ...statValue,
                color: card.hasSignal
                  ? "var(--dime-mint-text)"
                  : "var(--dime-text-secondary)",
              }}
            >
              {card.edgePp > 0 ? "+" : ""}
              {card.edgePp.toFixed(1)}
              <span style={{ fontSize: 11, fontWeight: 600 }}>pp</span>
            </span>
          ) : (
            <span style={{ ...statValue, color: "var(--dime-text-secondary)" }}>
              —
            </span>
          )}
        </StatBlock>
      </div>
    </article>
  );
}

// ─── Loading skeleton (reduced-motion safe: .animate-pulse is disabled
//     globally under prefers-reduced-motion in dime-mobile.css) ───────────────

function PropCardSkeleton() {
  const bar = (w: number | string, h: number): React.CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 6,
    background: "var(--dime-surface-raised)",
  });
  return (
    <div
      aria-hidden="true"
      className="animate-pulse"
      style={{
        background: "var(--dime-surface-card)",
        border: "1px solid var(--dime-border)",
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={bar("52%", 15)} />
        <div style={bar("72%", 11)} />
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div style={bar(56, 17)} />
        <div style={bar(80, 17)} />
        <div style={bar(36, 17)} />
        <div style={bar(56, 17)} />
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function MobileProps() {
  // Server-authoritative slate date (11:00 UTC rollover), same source the
  // desktop projections pages use.
  const dateQuery = trpc.games.getCurrentDate.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const gameDate = dateQuery.data?.effectiveDate;

  const gamesQuery = trpc.games.list.useQuery(
    { sport: "MLB", gameDate },
    { enabled: !!gameDate, staleTime: 60 * 1000, retry: 2 }
  );

  const gameIds = useMemo(
    () => (gamesQuery.data ?? []).filter(g => g?.id).map(g => g.id),
    [gamesQuery.data]
  );

  const propsQuery = trpc.strikeoutProps.getByGames.useQuery(
    { gameIds },
    {
      enabled: gameIds.length > 0,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );

  const cards = useMemo<KPropCard[]>(() => {
    const games = gamesQuery.data;
    const propsByGame = propsQuery.data?.propsByGame;
    if (!games || !propsByGame) return [];

    const out: KPropCard[] = [];
    for (const game of games) {
      if (!game?.id) continue;
      const rows = propsByGame[game.id];
      if (!rows || rows.length === 0) continue;

      for (const row of rows) {
        const ownAbbrev = row.side === "away" ? game.awayTeam : game.homeTeam;
        const oppAbbrev = row.side === "away" ? game.homeTeam : game.awayTeam;

        const sublineParts: string[] = [];
        if (row.pitcherHand) sublineParts.push(`${row.pitcherHand}HP`);
        sublineParts.push(`${nickname(ownAbbrev)} vs ${nickname(oppAbbrev)}`);
        if (game.startTimeEst && game.startTimeEst !== "TBD") {
          sublineParts.push(formatStartTime(game.startTimeEst));
        }

        const edge = row.bestEdge ? parseFloat(row.bestEdge) : NaN;

        out.push({
          key: row.id,
          pitcherName: row.pitcherName,
          mlbamId: row.mlbamId ?? null,
          subline: sublineParts.join(" · "),
          line: fmtNum(row.bookLine ?? row.kLine, 1),
          bookOverOdds: row.bookOverOdds,
          bookUnderOdds: row.bookUnderOdds,
          kProj: row.kProj,
          edgePp: isNaN(edge) ? null : edge * 100,
          lean: row.bestSide ?? null,
          hasSignal: row.verdict === "EDGE",
        });
      }
    }
    return out;
  }, [gamesQuery.data, propsQuery.data]);

  const isLoading =
    dateQuery.isLoading ||
    gamesQuery.isLoading ||
    (gameIds.length > 0 && propsQuery.isLoading);
  const isError = dateQuery.isError || gamesQuery.isError || propsQuery.isError;
  const isEmpty = !isLoading && !isError && cards.length === 0;

  return (
    <div
      className="flex flex-col h-full min-h-full"
      style={{ background: "var(--dime-bg)", fontFamily: sans }}
    >
      <header
        className="sticky top-0 z-40"
        style={{
          background: "var(--dime-bg)",
          borderBottom: "1px solid var(--dime-border)",
          padding: "12px 16px",
        }}
      >
        <div className="flex items-center justify-between">
          <h1
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.2px",
              color: "var(--dime-text-primary)",
            }}
          >
            MLB K Props
          </h1>
          <Target
            className="w-5 h-5"
            style={{ color: "var(--dime-text-muted)" }}
            aria-hidden="true"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading props..."
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 16,
            }}
          >
            <PropCardSkeleton />
            <PropCardSkeleton />
            <PropCardSkeleton />
          </div>
        ) : (
          <MobileDataState
            isLoading={false}
            isError={isError}
            isEmpty={isEmpty}
            emptyMessage="No MLB K-props posted yet."
            errorMessage="K-props could not be loaded."
            onRetry={() => {
              dateQuery.refetch();
              gamesQuery.refetch();
              if (gameIds.length > 0) propsQuery.refetch();
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
              }}
            >
              {cards.map(card => (
                <PropCard key={card.key} card={card} />
              ))}
            </div>
          </MobileDataState>
        )}
      </div>
    </div>
  );
}
