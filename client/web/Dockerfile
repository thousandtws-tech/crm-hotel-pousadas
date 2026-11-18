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
# SSR (Angular outputMode=server): Node serve os estáticos de dist/browser
# com cache longo e renderiza o HTML por rota via server.mjs — o bundle é
# self-contained (express incluído), sem node_modules no runtime.
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist/web ./dist/web
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/web/server/server.mjs"]
