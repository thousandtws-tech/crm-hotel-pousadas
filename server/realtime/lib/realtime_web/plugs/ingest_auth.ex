defmodule RealtimeWeb.Plugs.IngestAuth do
  @moduledoc """
  Autenticação do endpoint de ingest: header `X-Ingest-Token`
  comparado em tempo constante com `INGEST_TOKEN` do ambiente.
  """

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    expected = Application.get_env(:realtime, :ingest_token)

    with [token] <- get_req_header(conn, "x-ingest-token"),
         true <-
           is_binary(expected) and byte_size(token) == byte_size(expected) and
             Plug.Crypto.secure_compare(token, expected) do
      conn
    else
      _ ->
        conn
        |> send_resp(401, ~s({"error":"ingest token invalido"}))
        |> halt()
    end
  end
end
