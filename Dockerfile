# Railway backend image — Node 22 (Express/tRPC/SSE) + Debian Python 3.11.
#
# Why Docker instead of Nixpacks: the model runners spawn Python with
# hardcoded Debian paths — /usr/bin/python3 (mlbModelRunner), /usr/bin/python3.11
# (nhlModelEngine). Debian bookworm ships Python 3.11 at exactly those paths;
# Nixpacks (nix store paths) does not, which is the source of the historical
# `spawn /usr/bin/python3 ENOENT` failure on Railway (see server/cron/cronRoutes.ts).
FROM node:22-bookworm-slim

# apt python packages land in /usr/lib/python3/dist-packages, which Debian's system
# python3 already searches by default (no PYTHONPATH override needed — see
# mlbModelRunner.ts's spawn env construction). Third-party imports across
# server/*.py: numpy, pandas, scipy, requests.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-numpy \
      python3-pandas \
      python3-scipy \
      python3-requests \
      ca-certificates \
      # Debian Chromium for the Playwright-based scraper (server/wc2026/
      # espnPageScraper.ts imports "playwright" directly). pnpm's script allowlist only
      # covers puppeteer (package.json pnpm.onlyBuiltDependencies), so Playwright's own
      # postinstall browser download never runs here — apt chromium is the smallest
      # reliable substitute: it reuses the shared libs installed below (no second copy
      # of the same dependency closure) and lands at a fixed, version-independent path
      # (/usr/bin/chromium) that its PLAYWRIGHT_CHROMIUM_PATH resolution
      # can target directly via an explicit `executablePath`, unlike Playwright's own
      # download which nests under a version-numbered ms-playwright/chromium-<rev>/
      # directory that shifts on every Playwright bump. It falls back to
      # Playwright's own self-managed browser resolution when this env var is unset
      # and no apt/ms-playwright binary is found on disk, which is what keeps local
      # dev working without it.
      chromium \
      # Shared libs below cover both the apt chromium binary above and puppeteer's
      # own downloaded browser (.npmrc allow-build=puppeteer runs its postinstall
      # download at install time), even though no server/*.ts currently imports puppeteer.
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# package.json pins packageManager: pnpm@x — corepack activates that version.
RUN corepack enable

# patches/ and .npmrc must be present before install — package.json declares
# pnpm patchedDependencies (patches/wouter@*.patch) and install fails without them.
COPY package.json pnpm-lock.yaml .npmrc ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
# Builds the client into dist/public AND bundles the server into dist/index.js.
# The server also serves the client build as a fallback origin, so the Railway
# domain works standalone even though Vercel is the primary frontend host.
RUN pnpm run build

ENV NODE_ENV=production
# Matches the apt-installed chromium binary above. espnPageScraper.ts's fallback candidate
# chain otherwise only checks Manus-sandbox ms-playwright cache paths (/home/ubuntu/...)
# and a bare /usr/bin/chromium guess — setting this explicitly makes the resolution
# deterministic instead of depending on that fallback ordering.
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "dist/index.js"]
