# syntax=docker/dockerfile:1

# ---------- build ----------
FROM rust:1.98-bookworm AS builder
WORKDIR /app
COPY . .
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
