defmodule RealtimeWeb.AvisoChannel do
  @moduledoc """
  Avisos semânticos (toast/inbox) — lane de eventos de domínio.

  O broadcast chega a todos os sockets assinantes; `handle_out/3`
  intercepta por socket e só empurra ao cliente quando
  `socket.assigns.nivel <= ate_nivel` — mesma regra do filtro que o SSE
  fazia no Rust (avisos de admin não chegam à recepção).
  """

  use Phoenix.Channel

  intercept ["aviso"]

  @impl true
  def join("avisos", _params, socket), do: {:ok, socket}

  @impl true
  def handle_out("aviso", %{"ate_nivel" => ate} = payload, socket) do
    if socket.assigns.nivel <= ate do
      push(socket, "aviso", payload)
    end

    {:noreply, socket}
  end
end
