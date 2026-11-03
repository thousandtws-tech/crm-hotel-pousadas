defmodule RealtimeWeb.UserSocket do
  @moduledoc """
  Socket autenticado da equipe (admin/CRM).

  Conexão: `ws://host/socket?token=<jwt>` — o `phoenix` JS client envia
  o JWT como parâmetro de conexão. As assigns carregam o ator para os
  channels filtrarem por nível.
  """

  use Phoenix.Socket
  require Logger

  channel "deltas", RealtimeWeb.DeltaChannel
  channel "delta:*", RealtimeWeb.DeltaChannel
  channel "avisos", RealtimeWeb.AvisoChannel
  channel "presenca", RealtimeWeb.PresencaChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Realtime.Jwt.verify(token) do
      {:ok, %{"sub" => sub} = claims} ->
        {:ok,
         assign(socket,
           funcionario_id: sub,
           nivel: claims["nivel"] || 3,
           nome: claims["nome"]
         )}

      :error ->
        Logger.debug("socket recusado: token inválido")
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  # Identificação do socket — um canal por funcionário; múltiplas abas
  # do mesmo usuário compartilham o id (Phoenix multiplexa por join ref).
  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.funcionario_id}"
end
