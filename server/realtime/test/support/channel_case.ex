defmodule RealtimeWeb.ChannelCase do
  @moduledoc """
  Case para testes de channel — o app sobe com endpoint e pubsub;
  cada teste cria seu próprio socket autenticado.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      @endpoint RealtimeWeb.Endpoint
    end
  end
end
