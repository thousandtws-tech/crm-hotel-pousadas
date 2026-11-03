defmodule RealtimeWeb.Router do
  use RealtimeWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :ingest do
    plug RealtimeWeb.Plugs.IngestAuth
  end

  scope "/", RealtimeWeb do
    pipe_through :api

    get "/health", HealthController, :show
  end

  scope "/api", RealtimeWeb do
    pipe_through [:api, :ingest]

    post "/ingest", IngestController, :create
  end
end
