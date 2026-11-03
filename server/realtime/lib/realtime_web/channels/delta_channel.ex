defmodule RealtimeWeb.DeltaChannel do
  @moduledoc """
  Deltas das tabelas (lane de dados — substitui o SSE `delta`).

  Tópicos:
  * `deltas`        — todas as mudanças (equivalente ao SSE antigo);
  * `delta:<tabela>` — assinatura granular por tabela (cliente recebe só
                      o que usa → menos tráfego e menos work no browser).
  """

  use Phoenix.Channel

  @tabela_re ~r/^[a-z0-9_]{1,63}$/

  @impl true
  def join("deltas", _params, socket), do: {:ok, socket}

  def join("delta:" <> tabela, _params, socket) do
    if Regex.match?(@tabela_re, tabela) do
      {:ok, socket}
    else
      {:error, %{reason: "tabela inválida"}}
    end
  end
end
