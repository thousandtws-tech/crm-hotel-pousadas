# syntax=docker/dockerfile:1
# Contexto de build = raiz do repositório (monorepo Railway).
# Local:  docker build -f client/admin/Dockerfile .   (na raiz do repo)
# Railway: railway up + variável RAILWAY_DOCKERFILE_PATH=client/admin/Dockerfile

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY client/admin/package.json client/admin/package-lock.json ./
RUN npm ci
COPY client/admin/ .
RUN npm run build

# ---------- runtime ----------
FROM nginx:alpine
# entrypoint do nginx:alpine aplica envsubst nos *.template e gera conf.d/*.conf
COPY client/admin/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist/admin/browser /usr/share/nginx/html
ENV PORT=80
