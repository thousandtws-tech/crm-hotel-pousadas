defmodule RealtimeWeb.IngestController do
  @moduledoc """
  Porta de entrada do hub para serviços internos (API Rust, MAR IA,
  agente de impressão…): `POST /api/ingest` com `X-Ingest-Token`.

  Body:

  ```json
  {
    "topic": "avisos",
    "event": "aviso",
    "payload": { "tipo": "info", "titulo": "...", "mensagem": "...", "ate_nivel": 3 }
  }
  ```

  Qualquer serviço publica num tópico permitido sem passar pelo banco —
  é o que faz do Phoenix a central realtime, não só um relay de NOTIFY.
  """

  use RealtimeWeb, :controller

  @allowed_topics ~w[deltas avisos site:deltas presenca]
  @max_payload_bytes 7_000

  def create(conn, %{"topic" => topic, "event" => event, "payload" => payload})
      when is_binary(topic) and is_binary(event) and is_map(payload) do
    with :ok <- check_topic(topic),
         :ok <- check_event(event),
         :ok <- check_size(payload) do
      RealtimeWeb.Endpoint.broadcast(topic, event, payload)
      send_resp(conn, 202, ~s({"status":"accepted"}))
    else
      {:error, status, msg} -> send_resp(conn, status, msg)
    end
  end

  def create(conn, _params) do
    send_resp(conn, 422, ~s({"error":"esperado {topic,event,payload}"}))
  end

  defp check_topic(topic) do
    if topic in @allowed_topics or String.starts_with?(topic, "ext:") do
      :ok
    else
      {:error, 403, ~s({"error":"topico nao permitido"})}
    end
  end

  defp check_event(event) do
    if Regex.match?(~r/^[a-z0-9_]{1,50}$/, event) do
      :ok
    else
      {:error, 422, ~s({"error":"evento invalido"})}
    end
  end

  defp check_size(payload) do
    if byte_size(Jason.encode!(payload)) <= @max_payload_bytes do
      :ok
    else
      {:error, 413, ~s({"error":"payload muito grande"})}
    end
  end
end
