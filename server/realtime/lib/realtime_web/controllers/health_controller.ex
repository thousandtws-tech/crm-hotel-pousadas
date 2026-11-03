defmodule RealtimeWeb.HealthController do
  @moduledoc "Health check para load balancer/Railway."

  use RealtimeWeb, :controller

  def show(conn, _params) do
    json(conn, %{status: "ok", service: "realtime"})
  end
end
