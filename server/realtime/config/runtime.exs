import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/realtime start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :realtime, RealtimeWeb.Endpoint, server: true
end

config :realtime, RealtimeWeb.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# ---------------------------------------------------------------------------
# Hub realtime — segredos e upstream
# ---------------------------------------------------------------------------

# JWT_SECRET precisa ser o MESMO da clarituz-api (HS256 compartilhado).
# Dev/test têm default local; em prod a ausência é fatal.
jwt_secret =
  System.get_env("JWT_SECRET") ||
    if config_env() == :prod do
      raise "environment variable JWT_SECRET is missing — o mesmo segredo da API"
    else
      "clarituz-dev-jwt-secret-change-me-0123456789"
    end

# DATABASE_URL — listener PG (LISTEN clarituz_delta/clarituz_aviso).
database_url =
  System.get_env("DATABASE_URL") ||
    if config_env() == :prod do
      raise "environment variable DATABASE_URL is missing"
    else
      "postgres://clarituz:clarituz@localhost:5432/clarituz"
    end

# Token compartilhado do endpoint de ingest (serviços → hub).
ingest_token =
  System.get_env("INGEST_TOKEN") ||
    if config_env() == :prod do
      raise "environment variable INGEST_TOKEN is missing"
    else
      "dev-ingest-token"
    end

# Origens permitidas no handshake WebSocket (browser do admin/site).
# Em prod, ex.: CHECK_ORIGIN="https://admin-xxx.up.railway.app,https://web-xxx.up.railway.app"
check_origin =
  case System.get_env("CHECK_ORIGIN") do
    nil ->
      if(config_env() == :prod,
        do: raise("environment variable CHECK_ORIGIN is missing"),
        else: false
      )

    "*" ->
      false

    list ->
      list |> String.split(",", trim: true) |> Enum.map(&String.trim/1)
  end

config :realtime,
  jwt_secret: jwt_secret,
  database_url: database_url,
  ingest_token: ingest_token

config :realtime, RealtimeWeb.Endpoint, check_origin: check_origin

if config_env() == :prod do
  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :realtime, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :realtime, RealtimeWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://bandit.hexdocs.pm/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :realtime, RealtimeWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://plug.hexdocs.pm/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :realtime, RealtimeWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
