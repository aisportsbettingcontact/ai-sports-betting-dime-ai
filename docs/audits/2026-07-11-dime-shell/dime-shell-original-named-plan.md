null
Use this development-preview URL:

[http://127.0.0.1:5173/chat?preview=1](http://127.0.0.1:5173/chat?preview=1)

It now bypasses login only during local Vite development. Production `/chat` remains authenticated. TypeScript and all 61 relevant tests pass.
null
null
null
null
# Context from my IDE setup:

## Open tabs:
- DimeChatPage.tsx: client/src/pages/dime-chat/DimeChatPage.tsx
- pasted-text.txt: /Users/danielwalker/.codex/attachments/097b2347-8ced-4b46-bb8d-374f84adfffc/pasted-text.txt

## My request for Codex:
Are you pushing to the local environment or to github?

Local environment only. Nothing has been committed, pushed to GitHub, deployed, or sent to CI. The preview URL serves your current uncommitted workspace changes.
null
null
null
null
# Context from my IDE setup:

## Open tabs:
- DimeChatPage.tsx: client/src/pages/dime-chat/DimeChatPage.tsx
- pasted-text.txt: /Users/danielwalker/.codex/attachments/097b2347-8ced-4b46-bb8d-374f84adfffc/pasted-text.txt

## My request for Codex:
And what folder are you pushing to?

The local workspace folder is:

`/Users/danielwalker/Developer/ai-sports-betting-dime-ai`

I’m editing files there directly—not pushing them to another folder. The chat work is mainly under:

`client/src/pages/dime-chat/`
null
null
null
null
# Context from my IDE setup:

## Open tabs:
- DimeChatPage.tsx: client/src/pages/dime-chat/DimeChatPage.tsx
- pasted-text.txt: /Users/danielwalker/.codex/attachments/097b2347-8ced-4b46-bb8d-374f84adfffc/pasted-text.txt

# Files mentioned by the user:

## # GPT-5.6 SOL — UNIFIED TABLET/DESKTOP APP SHELL FOR `/chat` (URL-DRIVEN PANES)…: /Users/danielwalker/.codex/attachments/d0163865-c78e-466a-962c-45dabcc60966/pasted-text.txt

## My request for Codex:
Non-negotiables for 5.6 Sol 
RULE #1: MAXIMUM INCORPORATION OF 
/apple-design
 and 
/ui-ux-pro-max
 
RULE #2: USE TEAM LOGOS AND COUNTRY FLAGS BUT DO NOT ADD OR INTEGRATE ANY BORDERING, FRAMING, OR CUSTOMIZATIONS OF ANY SORT TO THEM. 
RULE #3: DO NOT ADD OR  INVENT ANYTHING OUTSIDE OF THE PARAMETERS AND INSTRUCTIONS OF THE PROMPT AND BLUEPRINT
RULE #4: ONLY FOCUS ON TABLET AND DESKTOP DEVICE SIZES, SCREENS, ASPECT RATIOS, AND PIXEL DIMENSIONS IN THIS SPECIFIC NEXT SCOPE AND SET OF TASKS. 

I’ll apply the attached scope exactly, limited to tablet and desktop. The named `/apple-design` and `/ui-ux-pro-max` skills are not installed in this session, so I’m using the available `frontend-design` skill as the closest repo-native design standard; I will not invent substitutes beyond the blueprint. I’m reading the full prompt and current shell before changing anything.
null
The attached blueprint requires a seam map and implementation plan, then an explicit approval pause. I’m following that workflow now: no shell code will be changed in this pass. The frontend-design discipline narrows the design move to one thing only—URL-driven continuity—while preserving every frozen surface, logo, and flag exactly.
null
null
The first pass confirms the blueprint’s central diagnosis: URLs are already canonical for projections, but splits still emits uppercase undated paths; `/chat` currently owns the frozen sidebar locally; and authenticated product routes are mounted independently in `App.tsx`. I’m now tracing the harder seams—login success, splits date capability, embedded chrome, and logo/flag DOM—before fixing the architecture on paper.
null
null
null
null
null
null
null
null
null
null
null
Planning pass complete. No implementation changes were made in this pass, per the blueprint’s approval gate.

The named `/apple-design` and `/ui-ux-pro-max` skills are unavailable. I applied the installed `frontend-design` discipline instead: the sole signature interaction is continuous URL-driven pane switching; no new visual language, decoration, or surface is proposed.

## Seam map

| Seam | Current behavior | Target/change class |
|---|---|---|
| [feedRoutes.ts](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/lib/feedRoutes.ts:20) | Feed paths are lowercase and dated; splits paths are uppercase and undated. | Add symmetric dated splits builder/parser. Preserve `todayUTC()` rollover. |
| [feedRoutes.test.ts](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/lib/feedRoutes.test.ts:10) | Tests encode `/betting-splits/MLB`. | Add dated lowercase construction, combined/split parsing, invalid-date handling, and legacy canonicalization coverage. |
| [App.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/App.tsx:188) | Each protected product route mounts independently. | Route all four product surfaces through one viewport-conditional boundary. Other routes remain untouched. |
| [App.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/App.tsx:126) | Local `/chat?preview=1` bypass exists for visual review. | Preserve it as development-only; production authentication remains mandatory. |
| [DimeChatPage.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/dime-chat/DimeChatPage.tsx:72) | Sidebar targets are partly hardcoded and New Chat is permanently active. | Build targets through canonical helpers and derive active state exclusively from the URL. |
| [DimeChatPage.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/dime-chat/DimeChatPage.tsx:210) | Frozen sidebar and drawer are owned by the chat page. | Retain them as the unified shell chrome rather than recreating a second sidebar. |
| [DimeChatPage.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/dime-chat/DimeChatPage.tsx:736) | `<1024` uses the existing drawer; `≥1024` uses the persistent sidebar. | Preserve this behavior. At `768–1023`, drawer navigation swaps shell panes and closes. |
| [DimeChatPage.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/dime-chat/DimeChatPage.tsx:1289) | Only the chat main pane renders beside the sidebar. | Add a stacked pane host. Chat remains mounted but becomes hidden/inert when another URL is active. |
| [DimeModelFeed.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/DimeModelFeed.tsx:250) | Already parses combined/split feed URLs, self-canonicalizes dateless paths, and updates URLs on date changes. | Reuse unchanged URL behavior. Add only an `embeddedInShell` chrome-suppression signal. |
| [DimeModelFeed.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/DimeModelFeed.tsx:373) | `dmf-nav` duplicates shell navigation. | Hide only `dmf-nav` when embedded; retain top bar, theme control, and feed design. |
| [BettingSplits.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/BettingSplits.tsx:178) | Sport comes from the route; date starts locally at today; sport changes replace an undated URL. | Accept parsed route date, update dated URL on sport/date changes, and preserve its existing header wholesale. |
| [BettingSplits.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/BettingSplits.tsx:250) | `games.list` requests a sport-wide rolling window, then filters by local date. Server date sync can overwrite local selection. | Use the existing exact `gameDate` input for URL-selected dates and `getAvailableDates` for the calendar. Do not invent a backend endpoint. |
| [BetTracker.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/BetTracker.tsx:1548) | Own auth/access checks and internal state; full-height standalone page. | Embed wholesale in the pane host. No redesign or chrome suppression is authorized. |
| [Home.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/pages/Home.tsx:102) | Default login destination is `/feed/model/mlb`. | Default to `/chat` at `≥768`; retain today’s destination below 768. Explicit safe `returnPath` deep links remain respected. |
| [RequireAuth.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/components/RequireAuth.tsx:92) | Protects each surface independently. | Protect the unified product boundary once; no authentication weakening. |
| [GlobalMobileOwnerTabs.tsx](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/client/src/features/mobileOwnerTabs/GlobalMobileOwnerTabs.tsx:71) | Already uses strict `<768`. | Leave untouched; it establishes the exact mobile/shell boundary. |
| [server/routers.ts](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/server/routers.ts:304) | `games.list` already accepts optional `{sport, gameDate}`. | No server change. Existing exact-date capability is sufficient. |
| [server/_core/index.ts](/Users/danielwalker/Developer/ai-sports-betting-dime-ai/server/_core/index.ts:745) | `/splits` sends an intermediate 308 to uppercase undated `/betting-splits/MLB`. | Server is explicitly out of scope; the client performs the final canonical replacement. |

## Planned architecture

New module: `client/src/pages/dime-shell/`

```tsx
<ProductSurfaceBoundary>
  {viewport >= 768 ? (
    <RequireAuth>
      <DimeAppShell route={parseProductLocation(location)} />
    </RequireAuth>
  ) : (
    <StandaloneProductRoutes />
  )}
</ProductSurfaceBoundary>
```

`DimeAppShell` will use the existing `DimeChatPage` shell rather than cloning its frozen sidebar:

```tsx
<DimeChatPage
  shellMode
  activePane={paneFromUrl}
  embeddedPane={
    pane === "feed" ? <DimeModelFeed embeddedInShell ... /> :
    pane === "splits" ? <BettingSplits ... /> :
    pane === "tracker" ? <BetTracker /> :
    null
  }
/>
```

Inside `DimeChatPage`:

- Sidebar/drawer remains structurally unchanged.
- Chat pane stays mounted during every desktop/tablet pane switch.
- Hidden panes become `inert`, `aria-hidden`, and non-interactive.
- Other lazy panes may unmount after exit.
- Pane layers share one grid cell, preventing layout shift.
- Wouter remains the sole navigation state owner.
- New Chat always resets chat, navigates to `/chat`, and closes the tablet drawer.
- Sidebar active state uses parsed `location`, not local click state.

## Canonical splits API

```ts
bettingSplitsPath(
  sport: "MLB" | "NHL" | "NBA" = "MLB",
  isoDate?: string,
): string

parseBettingSplitsPath(
  sportSegment?: string,
  dateSegment?: string,
): { sport: SplitsSport; isoDate: string | null } | null
```

Examples:

| Input | Canonical result |
|---|---|
| Default | `/betting-splits/mlb-07-11-2026` |
| NHL + date | `/betting-splits/nhl-07-11-2026` |
| `/betting-splits/MLB` | replace → dated lowercase MLB |
| `/betting-splits/mlb` | replace → dated lowercase MLB |
| `/betting-splits/mlb/07-11-2026` | replace → combined canonical slug |
| `/betting-splits` | replace → dated lowercase MLB |
| `/splits` | existing redirect, followed by client canonicalization |
| Invalid sport/date | replace → today’s dated MLB route |

## Motion, focus, and scroll

- Pane transition: `160ms cubic-bezier(0.16,1,0.3,1)`.
- Properties: opacity plus at most `translateY(4px)`.
- Rapid navigation interrupts from current presentation values.
- Reduced motion changes panes instantly.
- Sidebar feedback remains pointer-down driven.
- Each pane gets an invisible, semantic `<h1 tabIndex={-1}>`; focus moves there after URL-driven activation.
- Scroll positions are stored by pane key and restored in `useLayoutEffect`.
- Chat uses its existing internal scroll policy and stays mounted, preserving SSE, conversation, draft, and composer state.
- Navigation uses Wouter only—no `window.location`, document reload, or local active-tab state.
- Lazy chunks remain separate. Navigation is wrapped in `startTransition`; the outgoing pane remains visible while an uncached pane chunk resolves.

## Rule 2 audit finding

The shell itself will introduce zero wrappers, styles, or mutations around logos and flags.

However, the repository already contains treatments that conflict literally with the “raw logo” wording:

- `DimeModelFeed` wraps crests in `.dmf-crest`, which currently has circular framing.
- `BettingSplits.TeamBadge` currently uses a rounded background wrapper and image filters.
- `BetTracker` contains existing logo sizing and one existing drop-shadow.

The same prompt also says embedded pages render “exactly as the product renders them today,” allows only chrome suppression/parameter plumbing, and requires a byte-identical DOM assertion. Therefore, the plan treats Rule 2 as a strict **zero-diff rule**: the shell will not add, remove, restyle, resize, recolor, or rewrap any existing crest, logo, flag, or fallback. A retroactive raw-logo cleanup would contradict the approved modification boundaries and is not included.

## Expected files

- `client/src/App.tsx`
- `client/src/pages/dime-shell/DimeAppShell.tsx`
- `client/src/pages/dime-shell/breakpoints.ts`
- `client/src/pages/dime-shell/productRoute.ts`
- Shell-focused unit tests/CSS with `derived:` citations
- `client/src/pages/dime-chat/DimeChatPage.tsx`
- `client/src/pages/dime-chat/conversation.css`
- `client/src/lib/feedRoutes.ts`
- `client/src/lib/feedRoutes.test.ts`
- `client/src/pages/DimeModelFeed.tsx`
- `client/src/pages/BettingSplits.tsx`
- `client/src/pages/BetTracker.tsx` only if a nonvisual embedding prop is required
- `client/src/pages/Home.tsx`

No server, mobile-owner-tab, logo registry, asset, landing, checkout, admin, deployment, or CI files.

## Primary risks

- Chat must remain mounted without leaving hidden focusable descendants active.
- The shell’s inner scroll container changes sticky-position context for embedded headers.
- A resize across 768 intentionally changes shell ownership; URL state survives, but unpersisted component-local state on non-chat panes may reset.
- Exact-date splits queries must retain calendar availability through the existing `getAvailableDates` endpoint.
- Current full-page server `/splits` redirects remain a two-hop canonicalization because server code is forbidden.
- The existing dirty worktree—including the completed chat work and local preview route—must be preserved carefully.

## Validation plan

- `pnpm check`
- `pnpm build` with before/after gzip table for chat, feed, splits, tracker, shell, and shared Motion
- Full Vitest plus:
  - dated splits builders/parsers
  - legacy redirect symmetry
  - URL-to-pane identity
  - breakpoint helper
  - active sidebar derivation
- In-app Browser Playwright protocol at 768/1024/1440 in both themes:
  - exact URLs, no reload
  - back/forward/refresh/deep links
  - chat stream and draft survive pane switches
  - URL-driven sidebar state
  - focus transfer
  - reduced motion
  - pane scroll restoration
  - `dmf-nav` hidden only inside shell
  - logo/flag DOM unchanged
- At 375:
  - no shell DOM
  - existing standalone routes
  - unchanged mobile chat and owner tabs

Implementation is paused pending explicit founder approval, as required by Step 3.


