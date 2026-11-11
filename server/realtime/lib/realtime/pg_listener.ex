defmodule Realtime.PgListener do
  @moduledoc """
  Relay PostgreSQL → Phoenix PubSub.

  ```text
  triggers notify_delta ──▶ LISTEN clarituz_delta ──┐
                                                   ├─▶ Phoenix.PubSub
  trigger trg_aviso_*     ──▶ LISTEN clarituz_aviso ─┘        │
                                            channels ◀───────┘
  ```

  * `delta` (`{tabela,acao,id}`) vai para os tópicos `deltas` e
    `delta:<tabela>`; tabelas da whitelist pública também vão para
    `site:deltas` (canal do site, sem autenticação).
  * `aviso` (payload completo do aviso persistido) vai para `avisos` —
    o `AvisoChannel` filtra por `ate_nivel` no `handle_out`.

  Resiliência: o listener roda monitorado (não linkado); quedas de
  conexão com o banco disparam reconexão com backoff 1s→30s sem
  derrubar o endpoint — padrão hub de mensageria.
  """

  use GenServer
  require Logger

  @channels ~w[clarituz_delta clarituz_aviso]

  # Tabelas cujos deltas são seguros de republicar para o site público —
  # mesma whitelist do SSE público (`/publico/stream` na API Rust);
  # o payload é apenas {tabela,acao,id}, nunca dado de linha.
  @site_tables ~w[acomodacao acomodacao_cms acomodacao_midia cms_site site_midia]

  @max_backoff 30_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    {:ok, %{listener: nil, monitor: nil, backoff: 1_000}, {:continue, :connect}}
  end

  @impl true
  def handle_continue(:connect, state), do: {:noreply, connect(state)}

  @impl true
  def handle_info(:reconnect, state), do: {:noreply, connect(state)}

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{monitor: ref} = state) do
    Logger.warning("pg listener caiu (#{inspect(reason)}); reconectando em #{state.backoff}ms")

    Process.send_after(self(), :reconnect, state.backoff)

    {:noreply,
     %{state | listener: nil, monitor: nil, backoff: min(state.backoff * 2, @max_backoff)}}
  end

  def handle_info({:notification, _pid, _ref, "clarituz_delta", payload}, state) do
    with {:ok, %{"tabela" => tabela} = delta} <- Jason.decode(payload) do
      broadcast("deltas", "delta", delta)
      broadcast("delta:" <> tabela, "delta", delta)
      if tabela in @site_tables, do: broadcast("site:deltas", "delta", delta)
    else
      _ -> Logger.warning("delta com payload inválido: #{inspect(payload)}")
    end

    {:noreply, state}
  end

  def handle_info({:notification, _pid, _ref, "clarituz_aviso", payload}, state) do
    case Jason.decode(payload) do
      {:ok, aviso} -> broadcast("avisos", "aviso", aviso)
      _ -> Logger.warning("aviso com payload inválido: #{inspect(payload)}")
    end

    {:noreply, state}
  end

  # heartbeat/keep-alive e mensagens fora do protocolo — ignorar
  def handle_info(_msg, state), do: {:noreply, state}

  defp connect(%{listener: pid} = state) when is_pid(pid), do: state

  defp connect(state) do
    case Postgrex.Notifications.start_link(db_opts()) do
      {:ok, pid} ->
        Enum.each(@channels, &Postgrex.Notifications.listen(pid, &1))
        Logger.info("realtime: LISTEN #{Enum.join(@channels, ", ")}")
        %{state | listener: pid, monitor: Process.monitor(pid), backoff: 1_000}

      {:error, reason} ->
        Logger.warning(
          "pg listener: falha ao conectar (#{inspect(reason)}); retry em #{state.backoff}ms"
        )

        Process.send_after(self(), :reconnect, state.backoff)
        %{state | backoff: min(state.backoff * 2, @max_backoff)}
    end
  end

  defp broadcast(topic, event, payload) do
    RealtimeWeb.Endpoint.broadcast(topic, event, payload)
  end

  defp db_opts do
    url =
      Application.get_env(:realtime, :database_url) ||
        raise "DATABASE_URL não configurada"

    uri = URI.parse(url)
    {user, pass} = split_userinfo(uri.userinfo)
    ssl = uri.query != nil and String.contains?(uri.query, "sslmode=require")

    [
      hostname: uri.host,
      port: uri.port || 5432,
      username: user,
      password: pass,
      database: String.trim_leading(uri.path || "/", "/"),
      ssl: ssl,
      auto_reconnect: false,
      parameters: [application_name: "clarituz-realtime"]
    ]
  end

  defp split_userinfo(nil), do: {nil, nil}

  defp split_userinfo(info) do
    case String.split(info, ":", parts: 2) do
      [u, p] -> {URI.decode(u), URI.decode(p)}
      [u] -> {URI.decode(u), nil}
    end
  end
end
