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

# ---------- curl-impersonate stage ----------
# Statically-linked curl-impersonate that spoofs Chrome's TLS fingerprint (JA3/JA4).
# The CDN (*.strmd.st) fingerprints TLS Client Hello; plain curl is blocked.
FROM lexiforest/curl-impersonate AS curl-impersonate

# ---------- runtime stage ----------
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy curl-impersonate binary and shared libs from the impersonate stage
COPY --from=curl-impersonate /usr/local/bin/curl-impersonate /usr/local/bin/curl-impersonate
COPY --from=curl-impersonate /usr/local/lib/libcurl-impersonate* /usr/local/lib/
RUN ldconfig

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/main.js"
