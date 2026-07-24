/**
 * DeviceActivityPanel — the "Engagement composition" panel on the Overview tab of
 * the owner-only Customer Profiling Cockpit, fed by the owner-gated
 * analytics.overview proxy. Answers two questions side-by-side: WHERE users engage
 * (device-mix donut, distinct users) and WHICH features they use (top-actions
 * horizontal bar, by volume). The KPI tiles, action-total tiles and Power-Users
 * leaderboard that once lived here now live in their own panels — this card is
 * composition only.
 *
 * Honest states (owner directive): renders a centered "Not measured" card with the
 * exact server reason when the pipeline is off; a quiet "No composition data yet."
 * when measured but both reads are empty; and a small per-half "No … yet." when
 * only one read is empty — never a fabricated slice or bar. A real measured 0
 * renders; an unmeasured value never does. Owner-only (the query is ownerProcedure).
 *
 * Design: Dime brand law — semantic tokens only, mint is the ONLY hue. The device
 * donut is a single-hue mint-opacity ramp (rank by intensity, NOT a rainbow); the
 * action bars are mint. Mono uppercase micro-labels, tabular numerals, 320ms motion
 * gated on reduced-motion (chartAnim). Charts are responsive; the page never scrolls
 * sideways.
 */
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import SectionHeader from "@/pages/admin/SectionHeader";
import {
  AXIS_TICK,
  CARD_BG,
  GRID_COLOR,
  SIGNAL_SERIES,
  chartAnim,
  mintAlpha,
  mintRamp,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

/** Data-state labels — never a fabricated 0 (owner directive). */
const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

const DEVICE_CONFIG = {
  users: { label: "Users", color: SIGNAL_SERIES },
} satisfies ChartConfig;

const ACTIONS_CONFIG = {
  count: { label: "Actions", color: SIGNAL_SERIES },
} satisfies ChartConfig;

/** Shared micro-label styling for each read's heading. */
const MICRO =
  "text-[10px] sm:text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground";

export default function DeviceActivityPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const mix = data?.deviceMix ?? [];
  const topActions = data?.topActions ?? [];

  const ramp = mintRamp(mix.length);
  const totalUsers = mix.reduce((sum, m) => sum + m.users, 0);
  const bothEmpty =
    !!data && !notOk && mix.length === 0 && topActions.length === 0;

  return (
    <div className="mb-6 space-y-3">
      <SectionHeader title="Engagement composition" loading={isLoading} />

      {notOk ? (
        /* Honest state — never a fabricated composition. Exact server reason. */
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-center">
          <div className="text-sm font-semibold text-muted-foreground">
            {STATE_LABEL[data!.state] ?? "Not measured"}
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ??
              "The engagement-composition pipeline has produced no data yet."}
          </div>
        </div>
      ) : bothEmpty ? (
        <div className="bg-card border border-border rounded-lg px-4 py-6 text-center">
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            No composition data yet.
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* WHERE — device-mix donut (single-hue mint ramp, distinct users). */}
            <div className="min-w-0">
              <div className={`${MICRO} mb-2`}>Device mix · distinct users</div>
              {!notOk && mix.length > 0 ? (
                <>
                  <div className="relative">
                    <ChartContainer
                      config={DEVICE_CONFIG}
                      className="h-[220px] w-full"
                    >
                      <PieChart>
                        <Pie
                          data={mix}
                          dataKey="users"
                          nameKey="deviceType"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={1}
                          stroke={CARD_BG}
                          strokeWidth={2}
                          {...chartAnim(reduced)}
                        >
                          {mix.map((m, i) => (
                            <Cell key={m.deviceType} fill={ramp[i]} />
                          ))}
                        </Pie>
                        <ChartTooltip
                          content={<ChartTooltipContent nameKey="deviceType" />}
                        />
                      </PieChart>
                    </ChartContainer>
                    {/* Center overlay — total distinct users. */}
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold font-mono tabular-nums text-foreground leading-none">
                        {totalUsers.toLocaleString()}
                      </span>
                      <span className="mt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Users
                      </span>
                    </div>
                  </div>

                  {/* Tiny legend — deviceType · users · actions. */}
                  <ul className="mt-3 space-y-1">
                    {mix.map((m, i) => (
                      <li
                        key={m.deviceType}
                        className="flex items-center gap-2 text-[10px] sm:text-xs"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: ramp[i] }}
                        />
                        <span className="flex-1 min-w-0 truncate font-mono capitalize text-foreground">
                          {m.deviceType}
                        </span>
                        <span className="w-12 text-right font-mono tabular-nums text-foreground">
                          {m.users.toLocaleString()}
                        </span>
                        <span className="w-14 text-right font-mono tabular-nums text-muted-foreground">
                          {m.actions.toLocaleString()} act
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                !isLoading && (
                  <div className="py-8 text-center text-[10px] sm:text-xs text-muted-foreground">
                    No device mix yet.
                  </div>
                )
              )}
            </div>

            {/* WHICH — top-actions horizontal bar (by volume, mint). */}
            <div className="min-w-0">
              <div className={`${MICRO} mb-2`}>Top actions · by volume</div>
              {topActions.length > 0 ? (
                <ChartContainer
                  config={ACTIONS_CONFIG}
                  className="h-[220px] w-full"
                >
                  <BarChart
                    data={topActions}
                    layout="vertical"
                    margin={{ left: 8, right: 24 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      stroke={GRID_COLOR}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: mintAlpha(0.06) }}
                    />
                    <Bar
                      dataKey="count"
                      fill={SIGNAL_SERIES}
                      radius={[0, 3, 3, 0]}
                      {...chartAnim(reduced)}
                    >
                      <LabelList
                        dataKey="count"
                        position="right"
                        fontSize={10}
                        className="fill-foreground"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                !isLoading && (
                  <div className="py-8 text-center text-[10px] sm:text-xs text-muted-foreground">
                    No top actions yet.
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
