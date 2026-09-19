# ---------- build stage ----------
FROM node:20-slim AS build

WORKDIR /app

# install build deps
COPY package.json package-lock.json ./
RUN npm ci

# copy source & compile
COPY tsconfig.json tsconfig.client.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install curl-impersonate (spoofs Chrome TLS JA3/JA4 fingerprint).
# The CDN (*.strmd.st) fingerprints Client Hello; plain curl is rejected with 403.
# Detect architecture at build time and download the correct binary.
RUN ARCH="$(dpkg --print-architecture)" && \
    case "$ARCH" in \
      amd64)  CI_ARCH="x86_64-linux-gnu" ;; \
      arm64)  CI_ARCH="aarch64-linux-gnu" ;; \
      *)      echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac && \
    curl -sSL -o /tmp/ci.tar.gz \
      "https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.2/curl-impersonate-v2.2.2.${CI_ARCH}.tar.gz" && \
    tar xzf /tmp/ci.tar.gz -C /tmp && \
    # The tarball contains curl-impersonate-chrome and wrapper scripts.
    # Copy the main binary as curl-impersonate.
    cp /tmp/curl-impersonate-chrome /usr/local/bin/curl-impersonate && \
    chmod +x /usr/local/bin/curl-impersonate && \
    rm -rf /tmp/ci.tar.gz /tmp/curl-impersonate*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/main.js"]
