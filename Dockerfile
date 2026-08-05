# syntax=docker/dockerfile:1.7
#
# VulnSight container image.
#
# Bundles the application together with every scanner it can drive, so a
# comprehensive scan produces real tool output instead of coverage notes. Built
# for both linux/amd64 (development laptops) and linux/arm64 (Oracle Cloud
# Always Free), which is why every tool download resolves its architecture at
# build time rather than hardcoding x86.
#
# Build:  docker build -t vulnsight .
# Run:    docker compose up

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
#
# Isolated so that application source changes do not invalidate the dependency
# layer, which is by far the slowest part of the build.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


# ---------------------------------------------------------------------------
# Stage 2 — build
#
# Produces the Next.js standalone output: a self-contained server bundle with
# only the runtime dependencies it actually imports.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Playwright's browser download is skipped here; Chromium is installed from the
# Debian repositories in the runtime stage instead. See the note there.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm run build


# ---------------------------------------------------------------------------
# Stage 3 — scanner toolchain
#
# Downloads Nuclei and its templates in a throwaway stage so that curl, unzip
# and the build cache never reach the final image.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS tools

ARG NUCLEI_VERSION=3.3.7
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git \
    && rm -rf /var/lib/apt/lists/*

# Nuclei publishes per-architecture archives; TARGETARCH is supplied by
# BuildKit and is already "amd64" or "arm64", matching their naming.
RUN set -eux; \
    url="https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip"; \
    curl -fsSL "$url" -o /tmp/nuclei.zip; \
    unzip -q /tmp/nuclei.zip -d /tmp/nuclei; \
    install -m 0755 /tmp/nuclei/nuclei /usr/local/bin/nuclei; \
    rm -rf /tmp/nuclei /tmp/nuclei.zip

# Bake the template set into the image so a fresh container can scan
# immediately, without waiting on a first-run download.
RUN git clone --depth 1 \
      https://github.com/projectdiscovery/nuclei-templates.git \
      /opt/nuclei-templates \
    && rm -rf /opt/nuclei-templates/.git


# ---------------------------------------------------------------------------
# Stage 4 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Scanner configuration. These paths are baked in so the application finds its
# tools without any host-specific setup.
ENV NMAP_PATH=/usr/bin/nmap
ENV NUCLEI_PATH=/usr/local/bin/nuclei
ENV NUCLEI_TEMPLATES=/opt/nuclei-templates
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      # Scanner
      nmap \
      # Chromium and the shared libraries Playwright needs to launch it.
      # Debian's chromium package is used rather than Playwright's bundled
      # download because Playwright does not publish arm64 browser builds,
      # and Oracle's free tier is arm64.
      chromium \
      fonts-liberation \
      fonts-noto-color-emoji \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
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
      # Health checks and TLS trust
      curl \
      ca-certificates \
    ; \
    rm -rf /var/lib/apt/lists/*

# Nuclei binary and templates from the tools stage.
COPY --from=tools /usr/local/bin/nuclei /usr/local/bin/nuclei
COPY --from=tools /opt/nuclei-templates /opt/nuclei-templates

# Next.js standalone output. `server.js` and a pruned node_modules come from
# the build; static assets are copied separately as Next expects.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# The PDF generator embeds the brand typefaces, reading them from disk at
# runtime. They are not part of the Next bundle, so without this every PDF
# export would throw ENOENT in production while working fine in development.
COPY --from=builder /app/assets ./assets

# Playwright is declared in `serverExternalPackages`, so Next deliberately
# leaves it out of the standalone bundle — it resolves its browser driver from
# its own package directory at runtime and breaks when bundled. That exclusion
# also means nothing copies it, so it must be installed here, otherwise the
# import fails with "Failed to load external module playwright".
#
# Installed with npm rather than copied from the pnpm stage: pnpm keeps real
# packages in `node_modules/.pnpm/` and exposes them as symlinks, so a direct
# COPY finds no top-level `playwright-core` (a transitive dependency) and
# would carry dangling links even for the packages it did find.
#
# The version is pinned to match package.json. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
# is already set above, so this installs the library only — Chromium comes from
# the Debian package installed earlier.
ARG PLAYWRIGHT_VERSION=1.62.0
RUN set -eux; \
    # Install into an empty directory. Running npm directly in /app makes it
    # try to reconcile the pnpm-generated tree that arrived with the standalone
    # bundle, which crashes npm outright ("Cannot read properties of null").
    mkdir -p /tmp/pw; \
    cd /tmp/pw; \
    npm init -y >/dev/null; \
    npm install --no-audit --no-fund --omit=dev "playwright@${PLAYWRIGHT_VERSION}"; \
    # Move only the two packages the scanner imports into the app's tree.
    #
    # The existing directories MUST be removed first. Next.js emits empty stub
    # folders for `serverExternalPackages` into the standalone output, and
    # `cp -R src dst` copies *into* an existing dst rather than replacing it —
    # producing a half-merged install that is missing `browsers.json` and fails
    # at runtime with "Cannot find module .../browsers.json".
    mkdir -p /app/node_modules; \
    rm -rf /app/node_modules/playwright /app/node_modules/playwright-core; \
    cp -R /tmp/pw/node_modules/playwright /app/node_modules/playwright; \
    cp -R /tmp/pw/node_modules/playwright-core /app/node_modules/playwright-core; \
    rm -rf /tmp/pw /root/.npm; \
    # Fail the build now rather than at runtime. `browsers.json` is checked
    # specifically because its absence was the exact symptom of the stub-merge
    # bug above, and a bare directory test would not have caught it.
    test -f /app/node_modules/playwright/index.js; \
    test -f /app/node_modules/playwright-core/browsers.json; \
    # Strongest possible gate: resolve the module exactly the way the
    # application does at runtime (createRequire from /app), not merely via a
    # bare require which can succeed under different resolution rules.
    cd /app && node -e "const{createRequire}=require('node:module');const r=createRequire('/app/noop.js');if(typeof r('playwright').chromium.launch!=='function')throw new Error('playwright resolved but chromium.launch missing');console.log('playwright runtime resolution OK')" && cd /

# Run as an unprivileged user. The node image already provides uid/gid 1000
# as `node`; templates are made readable so Nuclei can load them.
RUN chown -R node:node /app /opt/nuclei-templates

USER node

EXPOSE 3000

# Reports which scanners are actually usable, so an unhealthy container is one
# that cannot scan — not merely one that failed to serve a page.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
