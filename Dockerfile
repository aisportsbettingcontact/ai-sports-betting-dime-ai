# Railway backend image — Node 22 (Express/tRPC/SSE) + Debian Python 3.11.
#
# Why Docker instead of Nixpacks: the model runners spawn Python with
# hardcoded Debian paths — /usr/bin/python3 (mlbModelRunner), /usr/bin/python3.11
# (nhlModelEngine), and a PYTHONPATH pointing at dist-packages. Debian bookworm
# ships Python 3.11 at exactly those paths; Nixpacks (nix store paths) does not,
# which is the source of the historical `spawn /usr/bin/python3 ENOENT` failure
# on Railway (see server/cron/cronRoutes.ts).
FROM node:22-bookworm-slim

# apt python packages land in /usr/lib/python3/dist-packages — already on the
# PYTHONPATH the runners construct. Third-party imports across server/*.py:
# numpy, pandas, scipy, requests.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-numpy \
      python3-pandas \
      python3-scipy \
      python3-requests \
      ca-certificates \
      # Chromium shared libraries for the puppeteer-based scrapers (.npmrc
      # allow-build=puppeteer downloads the browser at install time; these are
      # its runtime deps on Debian bookworm)
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
EXPOSE 3000
CMD ["node", "dist/index.js"]
