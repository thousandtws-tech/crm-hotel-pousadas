# ---------------------------------------------------------------------------
# Realtime hub — Elixir/Phoenix (multi-stage, release OTP)
# Contexto de build = raiz do repositório (monorepo Railway).
# Local:  docker build -f server/realtime/Dockerfile .   (na raiz do repo)
# Railway: railway up + variável RAILWAY_DOCKERFILE_PATH=server/realtime/Dockerfile
# ---------------------------------------------------------------------------

ARG ELIXIR_VERSION=1.20.3
ARG OTP_VERSION=29.0.5
ARG DEBIAN_VERSION=bookworm-20260824-slim

# ---------- build ----------
FROM hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION} AS build

ENV MIX_ENV=prod

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

COPY server/realtime/mix.exs server/realtime/mix.lock ./
RUN mix deps.get --only prod && mix deps.compile

COPY server/realtime/config config
COPY server/realtime/lib lib

RUN mix compile && mix release

# ---------- runner ----------
FROM debian:${DEBIAN_VERSION}

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8 \
    PHX_SERVER=true

WORKDIR /app

RUN useradd -m -u 1000 realtime
USER realtime

COPY --from=build --chown=realtime:realtime /app/_build/prod/rel/realtime ./

EXPOSE 4000

CMD ["bin/realtime", "start"]
