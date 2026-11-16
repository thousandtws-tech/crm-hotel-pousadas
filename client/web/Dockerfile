# syntax=docker/dockerfile:1
# Contexto de build = raiz do repositório (monorepo Railway).
# Local:  docker build -f client/web/Dockerfile .   (na raiz do repo)
# Railway: railway up + variável RAILWAY_DOCKERFILE_PATH=client/web/Dockerfile

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY client/web/package.json client/web/package-lock.json ./
# npm ci do npm 10 (node:22-alpine) não valida a resolução aninhada dos
# bindings wasm opcionais (@emnapi/*) — npm install usa o mesmo lockfile.
RUN npm install --no-audit --no-fund
COPY client/web/ .
RUN npm run build

# ---------- runtime ----------
FROM nginx:alpine
# entrypoint do nginx:alpine aplica envsubst nos *.template e gera conf.d/*.conf
COPY client/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist/web/browser /usr/share/nginx/html
ENV PORT=80
