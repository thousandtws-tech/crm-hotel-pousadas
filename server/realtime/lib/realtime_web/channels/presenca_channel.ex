defmodule RealtimeWeb.PresencaChannel do
  @moduledoc """
  Presença da equipe — quem está online (recepção vê colegas ativos).

  O cliente recebe `presence_state`/`presence_diff` nativos do
  `phoenix` JS (objeto `Presence` acompanha entradas/saídas).
  """

  use Phoenix.Channel
  alias Realtime.Presence

  @impl true
  def join("presenca", _params, socket) do
    send(self(), :after_join)
    {:ok, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _} =
      Presence.track(socket, socket.assigns.funcionario_id, %{
        nome: socket.assigns.nome,
        nivel: socket.assigns.nivel,
        online_at: DateTime.to_iso8601(DateTime.utc_now())
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end
end
