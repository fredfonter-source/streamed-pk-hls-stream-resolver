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
      ca-certificates wget xz-utils && \
    rm -rf /var/lib/apt/lists/*

# Install static curl-impersonate binary (spoofs Chrome TLS JA3 fingerprint).
# The CDN (*.strmd.st) fingerprints Client Hello; plain curl is rejected with 403.
RUN wget -qO /tmp/curl-impersonate.tar.xz \
      "https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.2/curl-impersonate-v2.2.2.x86_64-linux-gnu.tar.xz" && \
    tar xJf /tmp/curl-impersonate.tar.xz -C /tmp && \
    cp /tmp/curl-impersonate /usr/local/bin/curl-impersonate && \
    chmod +x /usr/local/bin/curl-impersonate && \
    rm -rf /tmp/curl-impersonate*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/main.js"]
