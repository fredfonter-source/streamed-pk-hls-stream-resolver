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

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/main.js"]
