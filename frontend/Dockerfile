# ── Stage 1: build the static bundle ─────────────────────────────────────────
FROM node:26-alpine AS build

WORKDIR /app

# Dependencies first, straight from the lockfile (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public/ public/
COPY src/ src/
RUN npm run build

# ── Stage 2: serve with unprivileged nginx (runs as uid 101, no root) ────────
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000
