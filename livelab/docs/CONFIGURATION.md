# LiveLab Configuration

## VS Code settings (`livelab.*`)

| Setting | Default | Meaning |
|---|---|---|
| `livelab.defaultUrl` | `http://localhost:3000` | URL suggested when opening LiveLab |
| `livelab.autoDetectServer` | `true` | Detect Vite/Next/Astro/Remix/Nuxt/SvelteKit/npm dev scripts |
| `livelab.allowedHosts` | `["localhost","127.0.0.1"]` | Hosts sessions may navigate to (exact hostnames; loopback always allowed) |
| `livelab.defaultDevices` | `["iphone-16","desktop-1440"]` | Presets opened by default |
| `livelab.managedScripts` | `["dev","start","test","test:e2e","lint","typecheck","build"]` | npm scripts LiveLab may run; everything else is rejected |
| `livelab.browser` | `chromium` | Interactive live engine (WebKit = separate verification pass) |
| `livelab.syncNavigation` | `true` | Mirror navigation/reload/back/forward across devices |
| `livelab.syncScroll` | `false` | Mirror scroll percentage across devices |
| `livelab.syncInteraction` | `false` | Mirror clicks via stable locators (coordinate replay only as logged fallback) |
| `livelab.watch.enabled` | `true` | Allow the agent watch pipeline |
| `livelab.watch.quietWindowMs` | `500` | Settle quiet window |
| `livelab.watch.maxSettleMs` | `10000` | Settle timeout |
| `livelab.artifactsDirectory` | `.livelab/artifacts` | Evidence root (always inside `.livelab/`) |
| `livelab.redactHeaders` | `["authorization","cookie","set-cookie","x-api-key"]` | Headers replaced with `[REDACTED]` |
| `livelab.redactQueryParameters` | `["token","key","api_key","access_token"]` | Query params replaced with `[REDACTED]` |
| `livelab.console.maxEntries` | `500` | Console ring size per session |
| `livelab.network.maxEntries` | `1000` | Network ring size per session |
| `livelab.frameRate` | `10` | Max screencast fps per device (1–30) |

## Workspace file: `.livelab/config.json`

Versioned (`"version": 1`), schema-validated; invalid files fall back to defaults with a logged warning. JSON-schema completion: point `$schema` at `livelab/schemas/livelab-config.schema.json`.

```jsonc
{
  "$schema": "../livelab/schemas/livelab-config.schema.json",
  "version": 1,
  "routes": ["/", "/pricing", "/checkout"],          // checked by smoke + watch
  "devices": [                                        // workspace presets (string = built-in id)
    "iphone-16",
    { "id": "kiosk", "label": "Kiosk", "kind": "desktop", "width": 1080, "height": 1920 }
  ],
  "scripts": ["storybook"],                           // extra allowlisted npm scripts
  "smoke": {
    "assertions": [
      { "id": "cta", "kind": "elementVisible", "selector": "[data-testid=cta]", "description": "CTA visible" },
      { "id": "no-modal", "kind": "noSelector", "selector": ".error-modal" }
    ],
    "ignoreConsole": ["third-party-widget noise"],
    "ignoreRequests": ["analytics.example"],
    "overflowTolerancePx": 0
  },
  "auth": { "storageStatePath": "e2e/.auth/state.json" },  // user-owned Playwright storage state
  "visual": { "threshold": 0.15, "maxDiffPixelRatio": 0.002 },
  "headers": { "x-preview": "livelab" },              // extra request headers per session
  "env": {},                                          // environment-safe test values
  "watch": {
    "include": ["src/**", "app/**", "pages/**", "components/**", "public/**", "styles/**", "index.html"],
    "exclude": ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.livelab/**", "**/.next/**"],
    "quietWindowMs": 500,
    "maxSettleMs": 10000,
    "fullPageScreenshot": false,
    "visualCompare": false
  }
}
```

## Generated state under `.livelab/`

| Path | Contents | Committed? |
|---|---|---|
| `runtime.json` / `runtime.lock` | discovery record (port/token/pid) + lock | never (0600 + generated .gitignore) |
| `artifacts/` | screenshots, traces, DOM/a11y snapshots, visual actual/diff | no |
| `reports/` | smoke + change reports (JSON) | no |
| `baselines/` | approved visual baselines + metadata | your choice (ignored by default; remove the line in `.livelab/.gitignore` to track) |
| `logs/runtime.jsonl` | structured runtime log (redacted, size-capped) | no |

## Runtime flags (daemon)

`node daemon.cjs --workspace <dir> [--owner extension|headless] [--trusted] [--parent-pid N] [--port N] [--allowed-hosts a,b] [--managed-scripts a,b] [--redact-headers a,b] [--redact-query-params a,b] [--console-max N] [--network-max N] [--max-fps N]`

Environment: `PLAYWRIGHT_BROWSERS_PATH` (browser discovery), `LIVELAB_CHROMIUM_PATH` (explicit Chromium executable fallback), `LIVELAB_DEBUG=1` (debug logs).
