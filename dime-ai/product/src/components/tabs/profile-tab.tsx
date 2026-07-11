"use client";

import { useDimeApp, effectiveCredits, effectiveTier } from "@/lib/store";
import { Avatar } from "@/components/avatar";
import { useTheme } from "@/lib/theme";
import { fmt } from "@/lib/format";
import { MEMBERSHIP, CONVERSATIONS } from "@/lib/data/seed";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { DiscordIcon, ChevronRightIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";

export function ProfileTab() {
  const { state, dispatch } = useDimeApp();
  const { theme, setTheme, oddsFormat, setOddsFormat } = useTheme();
  const showToast = useToast();

  const tier = effectiveTier(state.scenario, state.credits);
  const n = effectiveCredits(state.scenario, state.credits);
  const usageEstimate =
    tier === "unlimited" ? "No usage limits on your plan" : `≈ ${Math.floor(n / 40)} analyses remaining`;

  const planStatusLine = state.membershipCanceled
    ? `${MEMBERSHIP.planName} · Ends ${MEMBERSHIP.renewDate}`
    : `${MEMBERSHIP.planName} · Active`;
  const renewLine = state.membershipCanceled ? `Cancels ${MEMBERSHIP.renewDate}` : `Renews ${MEMBERSHIP.renewDate}`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[680px] mx-auto px-4 py-6 flex flex-col gap-6">
        <div className="flex items-center gap-3.5">
          <Avatar size={64} alt={`${state.displayName} profile`} className="flex-none" />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <h1 className="text-[21px] font-bold tracking-tight text-text-1 m-0 truncate">{state.displayName}</h1>
            <span className="text-[13px] text-text-2">@prez</span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-text-2 mt-0.5">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-mint" />
              {planStatusLine}
            </span>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: "SET_EDIT_DRAFT", draft: state.displayName, opening: true })}
            className="flex-none h-9 px-4 rounded-full border border-border-strong text-[13px] font-semibold text-text-1 active:bg-surface-2"
          >
            Edit
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "membership" })}
            className="rounded-2xl border border-border bg-surface p-3.5 text-left active:bg-surface-2"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3 mb-1">Membership</div>
            <div className="text-[16px] font-semibold text-text-1">{MEMBERSHIP.planName}</div>
            <div className="text-[12px] text-text-3 mt-0.5">{renewLine}</div>
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "credits" })}
            className="rounded-2xl border border-border bg-surface p-3.5 text-left active:bg-surface-2"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3 mb-1">Credits</div>
            <div className="text-[16px] font-semibold text-text-1 tabular-nums-font">{fmt(n)}</div>
            <div className="text-[12px] text-text-3 mt-0.5">{usageEstimate}</div>
          </button>
        </div>

        <Section title="Personalization">
          <Row label="Theme">
            <SegmentedControl
              ariaLabel="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "mint", label: "Mint" },
              ]}
            />
          </Row>
          <Row label="Odds format">
            <SegmentedControl
              ariaLabel="Odds format"
              value={oddsFormat}
              onChange={setOddsFormat}
              options={[
                { value: "american", label: "American" },
                { value: "decimal", label: "Decimal" },
              ]}
            />
          </Row>
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-text-1">Edge alerts</div>
              <div className="text-[12px] text-text-3 mt-0.5">
                Alerts when a tracked line or model edge moves materially
              </div>
            </div>
            <Switch checked={state.notifsOn} onChange={() => dispatch({ type: "TOGGLE_NOTIFS" })} label="Edge alerts" />
          </div>
        </Section>

        <Section title="Connected accounts">
          <div className="flex items-center gap-3 py-3">
            <DiscordIcon size={20} className="text-text-2 flex-none" />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-text-1">Discord</div>
              <div className="text-[12px] text-text-3 truncate">
                {state.discordConnected ? "prez#0421" : "Link your account for community picks"}
              </div>
            </div>
            <button
              type="button"
              aria-label={
                state.discordConnected
                  ? "Discord connected as prez#0421. Tap to disconnect."
                  : "Connect Discord"
              }
              onClick={() => {
                dispatch({ type: "TOGGLE_DISCORD" });
                showToast(state.discordConnected ? "Discord disconnected" : "Discord connected as prez#0421");
              }}
              className="flex-none flex items-center gap-1.5"
            >
              {state.discordConnected ? (
                <>
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-mint" />
                  <span className="text-[13px] text-text-2">Connected</span>
                </>
              ) : (
                <span className="text-[13px] font-semibold text-mint">Connect</span>
              )}
            </button>
          </div>
        </Section>

        <Section title="Activity">
          <RowButton onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "history" })}>
            <span className="text-[14px] font-medium text-text-1">Recent conversations</span>
            <span className="ml-auto flex items-center gap-1 text-text-3">
              <span className="text-[13px] tabular-nums-font">{CONVERSATIONS.length}</span>
              <ChevronRightIcon size={14} />
            </span>
          </RowButton>
          <RowButton onClick={() => showToast("Saved analysis is coming soon")}>
            <span className="text-[14px] font-medium text-text-1">Saved analysis</span>
            <span className="ml-auto flex items-center gap-1 text-text-3">
              <span className="text-[13px] tabular-nums-font">{state.savedCount}</span>
              <ChevronRightIcon size={14} />
            </span>
          </RowButton>
        </Section>

        <Section title="Account">
          <RowButton onClick={() => dispatch({ type: "SET_EDIT_DRAFT", draft: state.displayName, opening: true })}>
            <span className="text-[14px] font-medium text-text-1">Edit profile</span>
            <ChevronRightIcon size={14} className="ml-auto text-text-3" />
          </RowButton>
          <RowButton onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "membership" })}>
            <span className="text-[14px] font-medium text-text-1">Manage membership</span>
            <ChevronRightIcon size={14} className="ml-auto text-text-3" />
          </RowButton>
          <RowButton onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "logout" })}>
            <span className="text-[14px] font-medium text-text-1">Log out</span>
          </RowButton>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-3 px-0.5">{title}</h2>
      <div className="rounded-2xl border border-border bg-surface px-3.5 divide-y divide-border">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-[14px] font-medium text-text-1">{label}</span>
      {children}
    </div>
  );
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 py-3.5 min-h-11 -mx-3.5 px-3.5 active:bg-surface-2">
      {children}
    </button>
  );
}
