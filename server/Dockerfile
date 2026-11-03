# syntax=docker/dockerfile:1
# Contexto de build = raiz do repositório (monorepo Railway).
# Local:  docker build -f server/Dockerfile .   (na raiz do repo)
# Railway: railway up + variável RAILWAY_DOCKERFILE_PATH=server/Dockerfile

# ---------- build ----------
FROM rust:1.98-bookworm AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/crates crates
# migrations são embutidas no binário via sqlx::migrate! (path relativo crates/→migrations/)
COPY server/migrations migrations
RUN cargo build --release --locked -p clarituz-api

# ---------- runtime ----------
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY --from=builder /app/target/release/clarituz-api /usr/local/bin/clarituz-api

# migrations são embutidas no binário (sqlx::migrate!) e aplicadas no boot
ENV RUST_LOG=info,tower_http=debug,sqlx=warn
CMD ["clarituz-api", "serve"]
