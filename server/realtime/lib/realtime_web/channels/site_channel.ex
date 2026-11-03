defmodule RealtimeWeb.SiteChannel do
  @moduledoc """
  Canal público do site — recebe deltas das tabelas da whitelist
  (acomodações, quartos, CMS) para o site atualizar disponibilidade e
  conteúdo sem refresh. Somente leitura, sem autenticação.
  """

  use Phoenix.Channel

  @impl true
  def join("site:deltas", _params, socket), do: {:ok, socket}
end
