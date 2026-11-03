defmodule RealtimeWeb.SiteSocket do
  @moduledoc """
  Socket público do site (`client/web`) — sem autenticação.

  Expõe apenas o tópico `site:deltas`, que recebe somente deltas de
  tabelas da whitelist pública (acomodações/quartos/CMS). O payload do
  delta é {tabela,acao,id} — nunca dado de linha.
  """

  use Phoenix.Socket

  channel "site:deltas", RealtimeWeb.SiteChannel

  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
