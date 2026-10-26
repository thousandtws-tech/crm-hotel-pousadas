# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM nginx:alpine
# entrypoint do nginx:alpine aplica envsubst nos *.template e gera conf.d/*.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist/web/browser /usr/share/nginx/html
ENV PORT=80
