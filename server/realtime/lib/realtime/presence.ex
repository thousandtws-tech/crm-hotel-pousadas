defmodule Realtime.Presence do
  @moduledoc """
  Presença distribuída (quem está online na recepção/admin).

  Sobe junto com o app; o `PresencaChannel` faz `track/3` por socket
  com metadados do funcionário vindo do JWT.
  """

  use Phoenix.Presence,
    otp_app: :realtime,
    pubsub_server: Realtime.PubSub
end
